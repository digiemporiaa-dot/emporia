import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { proposalTargets } from "@/lib/services/sales.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Who a new proposal can be addressed to.
 *
 * The bug this pins: the New Proposal page queried leads directly, skipped the
 * CRM's row-level scoping, and rendered an empty dropdown that explained
 * nothing when the result was empty. Both halves are asserted here — that a
 * rep is offered only their own leads, and that the counts needed to explain an
 * empty list come back with it.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(
  userId: string,
  permissions: string[],
  roleName: Actor["roleName"] = "SALES_EXECUTIVE",
): Actor {
  return {
    userId,
    name: "Rep",
    email: null,
    type: "STAFF",
    roleName,
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const BASE = ["proposals.create", "leads.view", "clients.view"];

describeDb("proposal targets", () => {
  const leadIds: string[] = [];
  let mine: Actor;
  let manager: Actor;
  let otherUserId = "";

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true, roleId: true },
    });
    mine = actorWith(staff.id, BASE);
    manager = actorWith(staff.id, [...BASE, "leads.view.team"], "SALES_MANAGER");

    // A second staff user, so "someone else's lead" is a real row.
    const other = await db.user.create({
      data: {
        email: `targets-${Date.now()}@emporia.test`,
        name: "Other Rep",
        type: "STAFF",
        roleId: staff.roleId,
      },
      select: { id: true },
    });
    otherUserId = other.id;

    const source = await db.leadSource.findFirstOrThrow({ select: { id: true } });
    const make = async (name: string, over: Record<string, unknown>) => {
      const lead = await db.lead.create({
        data: { name, sourceId: source.id, ...over },
        select: { id: true },
      });
      leadIds.push(lead.id);
      return lead.id;
    };

    await make("Mine Open", {
      assignedToId: staff.id,
      status: "NEW",
      company: "Acme Ltd",
      email: "buyer@acme.test",
    });
    await make("Mine Won", { assignedToId: staff.id, status: "WON" });
    await make("Mine Deleted", { assignedToId: staff.id, status: "NEW", deletedAt: new Date() });
    await make("Theirs Open", { assignedToId: otherUserId, status: "QUALIFIED" });
    await make("Unassigned Open", { status: "NEW" });
  });

  afterAll(async () => {
    if (leadIds.length > 0) await db.lead.deleteMany({ where: { id: { in: leadIds } } });
    if (otherUserId) await db.user.deleteMany({ where: { id: otherUserId } });
  });

  it("offers a rep only the leads assigned to them", async () => {
    const { leads } = await proposalTargets(mine);
    const names = leads.map((lead) => lead.name);

    expect(names).toContain("Mine Open");
    // The whole point of the scoping fix: another rep's lead is not offered,
    // by name or by company.
    expect(names).not.toContain("Theirs Open");
    expect(names).not.toContain("Unassigned Open");
  });

  it("offers a manager the whole team's leads", async () => {
    const names = (await proposalTargets(manager)).leads.map((lead) => lead.name);
    expect(names).toEqual(expect.arrayContaining(["Mine Open", "Theirs Open", "Unassigned Open"]));
  });

  it("leaves out won, lost and soft-deleted leads", async () => {
    const names = (await proposalTargets(manager)).leads.map((lead) => lead.name);
    expect(names).not.toContain("Mine Won");
    expect(names).not.toContain("Mine Deleted");
  });

  it("returns what the label needs to tell two leads apart", async () => {
    const lead = (await proposalTargets(mine)).leads.find((row) => row.name === "Mine Open");
    expect(lead).toMatchObject({
      name: "Mine Open",
      company: "Acme Ltd",
      email: "buyer@acme.test",
    });
  });

  it("reports how many leads exist before scoping, so an empty list can explain itself", async () => {
    const result = await proposalTargets(mine);
    // A rep sees one; three are open in total. That difference is what turns
    // "no leads" into "none of them are yours".
    expect(result.leadsBeforeScoping).toBeGreaterThan(result.leads.length);
  });

  it("refuses an actor who may not create proposals", async () => {
    await expect(proposalTargets(actorWith(mine.userId, ["leads.view"]))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses an actor who may not read leads", async () => {
    await expect(
      proposalTargets(actorWith(mine.userId, ["proposals.create"])),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("offers no clients to an actor without clients.view", async () => {
    const { clients } = await proposalTargets(
      actorWith(mine.userId, ["proposals.create", "leads.view"]),
    );
    expect(clients).toEqual([]);
  });
});
