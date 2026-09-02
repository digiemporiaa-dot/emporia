import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  assignLead,
  changeStatus,
  getLead,
  listLeads,
  pipelineCounts,
  seesWholeTeam,
  visibilityFilter,
} from "@/lib/services/crm.service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * The Phase 7 exit criterion: a sales executive cannot see another rep's leads
 * without the team permission.
 *
 * These run through the service layer against a real database, so the guarantee
 * is about the query that actually executes, not about a UI filter.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("lead visibility", () => {
  let prisma: PrismaClient;
  let repA: Actor;
  let repB: Actor;
  let manager: Actor;
  let superAdmin: Actor;
  let noPermission: Actor;

  let userAId = "";
  let userBId = "";
  let sourceId = "";
  const leadIds: Record<string, string> = {};

  function actorFor(userId: string, permissions: string[], roleName: Actor["roleName"]): Actor {
    return {
      userId,
      name: "Test",
      email: "t@example.test",
      type: "STAFF",
      roleName,
      roleId: "r",
      clientId: null,
      permissions: new Set(permissions),
      ip: null,
      userAgent: null,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const role = await prisma.role.findFirstOrThrow({
      where: { name: "SALES_EXECUTIVE" },
      select: { id: true },
    });

    const a = await prisma.user.create({
      data: { email: "vis-rep-a@test.local", name: "Rep A", roleId: role.id, status: "ACTIVE" },
      select: { id: true },
    });
    const b = await prisma.user.create({
      data: { email: "vis-rep-b@test.local", name: "Rep B", roleId: role.id, status: "ACTIVE" },
      select: { id: true },
    });
    userAId = a.id;
    userBId = b.id;

    const source = await prisma.leadSource.findFirstOrThrow({
      where: { slug: "website-form" },
      select: { id: true },
    });
    sourceId = source.id;

    for (const [key, assignee] of [
      ["a1", userAId],
      ["a2", userAId],
      ["b1", userBId],
      ["unassigned", null],
    ] as const) {
      const lead = await prisma.lead.create({
        data: {
          name: `Vis lead ${key}`,
          email: `vis-${key}@test.local`,
          sourceId,
          assignedToId: assignee,
          status: "NEW",
        },
        select: { id: true },
      });
      leadIds[key] = lead.id;
    }

    repA = actorFor(userAId, ["leads.view", "leads.edit"], "SALES_EXECUTIVE");
    repB = actorFor(userBId, ["leads.view", "leads.edit"], "SALES_EXECUTIVE");
    manager = actorFor(userAId, ["leads.view", "leads.view.team", "leads.assign"], "SALES_MANAGER");
    superAdmin = actorFor(userAId, [], "SUPER_ADMIN");
    noPermission = actorFor(userAId, [], "STAFF");
  });

  afterAll(async () => {
    await prisma.leadActivity.deleteMany({ where: { lead: { email: { contains: "@test.local" } } } });
    await prisma.leadAssignment.deleteMany({ where: { lead: { email: { contains: "@test.local" } } } });
    await prisma.lead.deleteMany({ where: { email: { contains: "@test.local" } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@test.local" } } });
    await prisma.$disconnect();
  });

  it("scopes an executive to their own leads", () => {
    expect(visibilityFilter(repA)).toEqual({ assignedToId: userAId });
    expect(seesWholeTeam(repA)).toBe(false);
  });

  it("does not scope a holder of leads.view.team", () => {
    expect(visibilityFilter(manager)).toEqual({});
    expect(seesWholeTeam(manager)).toBe(true);
  });

  it("does not scope a super admin", () => {
    expect(visibilityFilter(superAdmin)).toEqual({});
    expect(seesWholeTeam(superAdmin)).toBe(true);
  });

  it("matches nothing for an actor with no lead permission at all", () => {
    expect(visibilityFilter(noPermission)).toEqual({ id: "__none__" });
  });

  it("THE CRITERION: an executive's list excludes another rep's leads", async () => {
    const result = await listLeads(repA, { perPage: 100 });
    const names = result.rows.map((r) => r.name);

    expect(names).toContain("Vis lead a1");
    expect(names).toContain("Vis lead a2");
    expect(names).not.toContain("Vis lead b1");
    expect(names).not.toContain("Vis lead unassigned");
  });

  it("and the rule is symmetric: Rep B sees only theirs", async () => {
    const result = await listLeads(repB, { perPage: 100 });
    const names = result.rows.map((r) => r.name);

    expect(names).toContain("Vis lead b1");
    expect(names).not.toContain("Vis lead a1");
    expect(names).not.toContain("Vis lead a2");
  });

  it("a manager with the team permission sees all of them", async () => {
    const result = await listLeads(manager, { perPage: 100 });
    const names = result.rows.map((r) => r.name);

    expect(names).toContain("Vis lead a1");
    expect(names).toContain("Vis lead b1");
    expect(names).toContain("Vis lead unassigned");
  });

  it("another rep's lead is indistinguishable from one that does not exist", async () => {
    await expect(getLead(repA, leadIds["b1"] as string)).rejects.toThrow(NotFoundError);
    await expect(getLead(repA, "totally-made-up-id")).rejects.toThrow(NotFoundError);

    // Same error type and message, so the response cannot be used to probe.
    const foreign = await getLead(repA, leadIds["b1"] as string).catch((e: Error) => e.message);
    const missing = await getLead(repA, "totally-made-up-id").catch((e: Error) => e.message);
    expect(foreign).toBe(missing);
  });

  it("a rep can read their own lead", async () => {
    const lead = await getLead(repA, leadIds["a1"] as string);
    expect(lead.name).toBe("Vis lead a1");
  });

  it("a filter cannot widen visibility beyond the rule", async () => {
    // Explicitly asking for Rep B's leads still returns nothing.
    const result = await listLeads(repA, { assignedToId: userBId, perPage: 100 });
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("a search cannot reach another rep's lead", async () => {
    const result = await listLeads(repA, { search: "Vis lead b1", perPage: 100 });
    expect(result.rows).toHaveLength(0);
  });

  it("pipeline counts respect the same rule", async () => {
    const own = await pipelineCounts(repA);
    const all = await pipelineCounts(manager);
    expect((own["NEW"] ?? 0) < (all["NEW"] ?? 0)).toBe(true);
  });

  it("refuses a write against a lead the actor cannot see", async () => {
    await expect(changeStatus(repA, leadIds["b1"] as string, "CONTACTED")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("requires leads.view at all", async () => {
    await expect(listLeads(noPermission)).rejects.toThrow(ForbiddenError);
  });

  it("requires leads.assign to reassign, which an executive lacks", async () => {
    await expect(assignLead(repA, leadIds["a1"] as string, userBId)).rejects.toThrow(ForbiddenError);
  });

  it("lets a manager reassign, and records the handoff", async () => {
    await assignLead(manager, leadIds["a1"] as string, userBId, "Territory change");

    const history = await prisma.leadAssignment.findMany({
      where: { leadId: leadIds["a1"] as string },
      select: { fromUserId: true, toUserId: true, reason: true },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromUserId: userAId, toUserId: userBId, reason: "Territory change" });

    // And the lead has left Rep A's view entirely.
    const repAList = await listLeads(repA, { perPage: 100 });
    expect(repAList.rows.map((r) => r.name)).not.toContain("Vis lead a1");
  });
});

describeDb("pipeline transitions through the service", () => {
  let prisma: PrismaClient;
  let actor: Actor;
  let leadId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const user = await prisma.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    const source = await prisma.leadSource.findFirstOrThrow({
      where: { slug: "website-form" },
      select: { id: true },
    });

    actor = {
      userId: user.id,
      name: "T",
      email: "t@t.test",
      type: "STAFF",
      roleName: "SALES_MANAGER",
      roleId: "r",
      clientId: null,
      permissions: new Set(["leads.view", "leads.view.team", "leads.edit"]),
      ip: null,
      userAgent: null,
    };

    const lead = await prisma.lead.create({
      data: { name: "Transition lead", email: "trans@test.local", sourceId: source.id, status: "NEW" },
      select: { id: true },
    });
    leadId = lead.id;
  });

  afterAll(async () => {
    await prisma.leadActivity.deleteMany({ where: { leadId } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.$disconnect();
  });

  it("records every status change on the timeline", async () => {
    await changeStatus(actor, leadId, "CONTACTED");
    await changeStatus(actor, leadId, "QUALIFIED", "Budget confirmed");

    const activities = await prisma.leadActivity.findMany({
      where: { leadId, type: "STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
      select: { summary: true },
    });

    expect(activities).toHaveLength(2);
    expect(activities[0]?.summary).toContain("NEW to CONTACTED");
    expect(activities[1]?.summary).toContain("CONTACTED to QUALIFIED");
  });

  it("refuses a no-op transition", async () => {
    await expect(changeStatus(actor, leadId, "QUALIFIED")).rejects.toThrow(ValidationError);
  });

  it("stamps convertedAt on WON and then refuses to move back", async () => {
    await changeStatus(actor, leadId, "WON");
    const won = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { convertedAt: true },
    });
    expect(won.convertedAt).not.toBeNull();

    await expect(changeStatus(actor, leadId, "LOST")).rejects.toThrow(ValidationError);
  });
});
