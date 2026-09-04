import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createAutomation, recentRuns, setAutomationActive, updateAutomation } from "@/lib/services/automation.service";
import { runAutomations, previewAutomation } from "@/lib/automation/engine";
import { matches } from "@/lib/automation/conditions";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { AutomationInput } from "@/lib/validation/automation";
import type { Actor } from "@/lib/actor/types";

/**
 * The phase 15 exit criteria: rules are editable in admin without a deploy, and
 * every automated action lands in the audit log.
 *
 * The rules below are built the same way the admin editor builds them — through
 * the service, from validated input — so "no deploy" is what is actually being
 * exercised.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("automation", () => {
  let prisma: PrismaClient;
  let actor: Actor;
  let weakActor: Actor;

  const tag = `auto-${Date.now()}`;
  let sourceId = "";
  let repId = "";
  let staffId = "";
  const madeIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const staff = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });
    staffId = staff.id;

    const base = {
      userId: staff.id,
      name: "Ops",
      email: "ops@emporia.test",
      type: "STAFF" as const,
      roleName: "ADMIN" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };

    actor = { ...base, permissions: new Set(["automation.view", "automation.edit"]) };
    weakActor = { ...base, permissions: new Set(["automation.view"]) };

    const source = await prisma.leadSource.create({
      data: { name: `${tag} source`, slug: `${tag}-source`, type: "WEBSITE_FORM" },
      select: { id: true },
    });
    sourceId = source.id;

    const role = await prisma.role.findFirstOrThrow({
      where: { name: "SALES_EXECUTIVE" },
      select: { id: true },
    });
    const rep = await prisma.user.create({
      data: {
        email: `${tag}-rep@test.local`,
        name: "Rule Rep",
        type: "STAFF",
        status: "ACTIVE",
        roleId: role.id,
      },
      select: { id: true },
    });
    repId = rep.id;
  });

  afterEach(async () => {
    // Each test builds its own rules; nothing leaks into the next.
    await prisma.automation.deleteMany({ where: { name: { startsWith: tag } } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "Automation" } });
    await prisma.leadTask.deleteMany({ where: { lead: { sourceId } } });
    await prisma.leadTag.deleteMany({ where: { lead: { sourceId } } });
    await prisma.leadAssignment.deleteMany({ where: { lead: { sourceId } } });
    await prisma.leadActivity.deleteMany({ where: { lead: { sourceId } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [repId, staffId] } } });
    await prisma.lead.deleteMany({ where: { sourceId } });
    await prisma.projectTask.deleteMany({ where: { project: { id: { in: madeIds } } } });
    await prisma.project.deleteMany({ where: { id: { in: madeIds } } });
    await prisma.user.deleteMany({ where: { id: repId } });
    await prisma.leadSource.deleteMany({ where: { id: sourceId } });
    await prisma.tag.deleteMany({ where: { slug: { startsWith: "rule-" } } });
    await prisma.$disconnect();
  });

  async function makeLead(overrides: Record<string, unknown> = {}) {
    return prisma.lead.create({
      data: {
        name: `${tag} lead`,
        sourceId,
        status: "NEW",
        ...overrides,
      },
      select: { id: true },
    });
  }

  const rule = (over: Partial<AutomationInput>): AutomationInput => ({
    name: `${tag} rule`,
    description: null,
    isActive: true,
    order: 0,
    trigger: "LEAD_CREATED",
    conditions: [],
    actions: [],
    ...over,
  });

  // ── Exit criterion 1: editable without a deploy ─────────────────────────

  it("builds a working rule from admin input alone", async () => {
    await createAutomation(
      actor,
      rule({
        conditions: [{ field: "lead.score", operator: "gte", value: "50" }],
        actions: [{ type: "ADD_TAG", tagName: "Rule Hot" }],
      }),
    );

    const hot = await makeLead({ score: 80 });
    await runAutomations("LEAD_CREATED", { leadId: hot.id });

    const tagged = await prisma.leadTag.findFirst({
      where: { leadId: hot.id },
      select: { tag: { select: { name: true } } },
    });
    expect(tagged?.tag.name).toBe("Rule Hot");

    // And the same rule declines a lead that does not meet the condition.
    const cold = await makeLead({ score: 10 });
    await runAutomations("LEAD_CREATED", { leadId: cold.id });
    expect(await prisma.leadTag.count({ where: { leadId: cold.id } })).toBe(0);
  });

  it("changes behaviour when the rule is edited, with no code change", async () => {
    const created = await createAutomation(
      actor,
      rule({
        conditions: [{ field: "lead.score", operator: "gte", value: "50" }],
        actions: [{ type: "ADD_TAG", tagName: "Rule First" }],
      }),
    );

    await updateAutomation(
      actor,
      created.id,
      rule({
        conditions: [{ field: "lead.score", operator: "gte", value: "5" }],
        actions: [{ type: "ADD_TAG", tagName: "Rule Second" }],
      }),
    );

    const lead = await makeLead({ score: 10 });
    await runAutomations("LEAD_CREATED", { leadId: lead.id });

    const names = await prisma.leadTag.findMany({
      where: { leadId: lead.id },
      select: { tag: { select: { name: true } } },
    });
    expect(names.map((row) => row.tag.name)).toEqual(["Rule Second"]);
  });

  it("does not run an inactive rule", async () => {
    await createAutomation(
      actor,
      rule({ isActive: false, actions: [{ type: "ADD_TAG", tagName: "Rule Off" }] }),
    );

    const lead = await makeLead();
    await runAutomations("LEAD_CREATED", { leadId: lead.id });

    expect(await prisma.leadTag.count({ where: { leadId: lead.id } })).toBe(0);
  });

  // ── Exit criterion 2: every automated action is audited ─────────────────

  it("audits the rule run and each action it took", async () => {
    const created = await createAutomation(
      actor,
      rule({
        actions: [
          { type: "ADD_TAG", tagName: "Rule Audited" },
          { type: "SET_LEAD_STATUS", status: "CONTACTED" },
        ],
      }),
    );

    const lead = await makeLead();
    await runAutomations("LEAD_CREATED", { leadId: lead.id });

    // One row for the rule, naming what it did.
    const runRow = await prisma.auditLog.findFirst({
      where: { entityType: "Automation", entityId: created.id },
      orderBy: { createdAt: "desc" },
    });
    expect(runRow).not.toBeNull();
    // Attributed to no user, because no user did it.
    expect(runRow?.actorId).toBeNull();
    const payload = runRow?.after as { trigger: string; actions: { type: string; changed: boolean }[] };
    expect(payload.trigger).toBe("LEAD_CREATED");
    expect(payload.actions.map((a) => a.type)).toEqual(["ADD_TAG", "SET_LEAD_STATUS"]);
    expect(payload.actions.every((a) => a.changed)).toBe(true);

    // Plus a row per domain change, so the lead's own history shows it.
    const leadRows = await prisma.auditLog.findMany({
      where: { entityType: "Lead", entityId: lead.id },
      select: { action: true },
    });
    expect(leadRows.map((row) => row.action).sort()).toEqual(["STATUS_CHANGE", "UPDATE"]);
  });

  it("reads the run history back out of the audit trail", async () => {
    await createAutomation(actor, rule({ actions: [{ type: "ADD_TAG", tagName: "Rule Logged" }] }));

    const lead = await makeLead();
    await runAutomations("LEAD_CREATED", { leadId: lead.id });

    const runs = await recentRuns(actor, 10);
    const mine = runs.find((run) => run.name === `${tag} rule`);

    expect(mine?.trigger).toBe("LEAD_CREATED");
    expect(mine?.actions[0]?.detail).toContain("Rule Logged");
  });

  // ── Actions behave when the world has moved on ──────────────────────────

  it("leaves an assigned lead alone by default, and reassigns when told to", async () => {
    const lead = await makeLead({ assignedToId: staffId });

    await createAutomation(
      actor,
      rule({
        name: `${tag} rule gentle`,
        actions: [{ type: "ASSIGN_LEAD", strategy: "SPECIFIC", userId: repId, onlyIfUnassigned: true }],
      }),
    );
    await runAutomations("LEAD_CREATED", { leadId: lead.id });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedToId).toBe(staffId);

    await prisma.automation.deleteMany({ where: { name: `${tag} rule gentle` } });
    await createAutomation(
      actor,
      rule({
        name: `${tag} rule firm`,
        actions: [{ type: "ASSIGN_LEAD", strategy: "SPECIFIC", userId: repId, onlyIfUnassigned: false }],
      }),
    );
    await runAutomations("LEAD_CREATED", { leadId: lead.id });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedToId).toBe(repId);
  });

  it("refuses to win a lead by the side door", async () => {
    await createAutomation(actor, rule({ actions: [{ type: "SET_LEAD_STATUS", status: "WON" }] }));

    const lead = await makeLead();
    const [outcome] = await runAutomations("LEAD_CREATED", { leadId: lead.id });

    expect(outcome?.actions[0]?.changed).toBe(false);
    expect(outcome?.actions[0]?.detail).toContain("accepting a proposal");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("NEW");
  });

  it("creates a follow-up task, and says so when there is no owner for one", async () => {
    await createAutomation(
      actor,
      rule({
        actions: [{ type: "CREATE_LEAD_TASK", title: "Call {{lead.company}}", dueInDays: 2, assignTo: "LEAD_OWNER", priority: "HIGH" }],
      }),
    );

    const unowned = await makeLead({ company: "Acme" });
    const [first] = await runAutomations("LEAD_CREATED", { leadId: unowned.id });
    expect(first?.actions[0]?.changed).toBe(false);
    expect(first?.actions[0]?.detail).toContain("No owner");

    const owned = await makeLead({ company: "Acme", assignedToId: repId });
    await runAutomations("LEAD_CREATED", { leadId: owned.id });

    const task = await prisma.leadTask.findFirst({ where: { leadId: owned.id } });
    // The title template was filled from the facts.
    expect(task?.title).toBe("Call Acme");
    expect(task?.priority).toBe("HIGH");
  });

  it("notifies a role without naming individuals", async () => {
    await createAutomation(
      actor,
      rule({
        actions: [{ type: "NOTIFY_USER", to: "ROLE", roleName: "SALES_EXECUTIVE", title: "New lead: {{lead.company}}" }],
      }),
    );

    const lead = await makeLead({ company: "Northwind" });
    await runAutomations("LEAD_CREATED", { leadId: lead.id });

    const note = await prisma.notification.findFirst({
      where: { userId: repId },
      orderBy: { createdAt: "desc" },
    });
    expect(note?.title).toBe("New lead: Northwind");
  });

  it("matches nobody for a role that does not exist", async () => {
    await createAutomation(
      actor,
      rule({ actions: [{ type: "NOTIFY_USER", to: "ROLE", roleName: "NOT_A_ROLE", title: "x" }] }),
    );

    const lead = await makeLead();
    const [outcome] = await runAutomations("LEAD_CREATED", { leadId: lead.id });

    expect(outcome?.actions[0]?.changed).toBe(false);
    expect(outcome?.actions[0]?.detail).toContain("Nobody to notify");
  });

  // ── The engine never breaks its caller ──────────────────────────────────

  it("survives a rule whose stored config is no longer valid", async () => {
    const created = await createAutomation(
      actor,
      rule({
        actions: [
          { type: "ADD_TAG", tagName: "Rule Survivor" },
        ],
      }),
    );

    // Corrupt the stored config the way a schema change would.
    await prisma.automationAction.updateMany({
      where: { automationId: created.id },
      data: { config: { type: "ADD_TAG" } },
    });

    const lead = await makeLead();
    const [outcome] = await runAutomations("LEAD_CREATED", { leadId: lead.id });

    expect(outcome?.actions[0]?.changed).toBe(false);
    expect(outcome?.actions[0]?.detail).toContain("no longer valid");
  });

  it("returns nothing rather than throwing when a subject has vanished", async () => {
    await createAutomation(actor, rule({ actions: [{ type: "ADD_TAG", tagName: "Rule Ghost" }] }));

    const outcomes = await runAutomations("LEAD_CREATED", { leadId: "does-not-exist" });
    expect(outcomes[0]?.actions[0]?.changed).toBe(false);
  });

  // ── Preview ─────────────────────────────────────────────────────────────

  it("previews a rule without doing anything", async () => {
    const created = await createAutomation(
      actor,
      rule({
        conditions: [{ field: "lead.score", operator: "gte", value: "50" }],
        actions: [{ type: "ADD_TAG", tagName: "Rule Preview" }],
      }),
    );

    const lead = await makeLead({ score: 90 });
    const preview = await previewAutomation(created.id, { leadId: lead.id });

    expect(preview?.matched).toBe(true);
    expect(preview?.actions).toEqual(["ADD_TAG"]);
    // Nothing was actually tagged.
    expect(await prisma.leadTag.count({ where: { leadId: lead.id } })).toBe(0);
  });

  // ── Authorization and guard rails ───────────────────────────────────────

  it("refuses to build or edit a rule without automation.edit", async () => {
    await expect(
      createAutomation(weakActor, rule({ actions: [{ type: "ADD_TAG", tagName: "Nope" }] })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("will not switch on a rule with no actions", async () => {
    const created = await prisma.automation.create({
      data: { name: `${tag} rule empty`, isActive: false },
      select: { id: true },
    });

    await expect(setAutomationActive(actor, created.id, true)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  // ── Conditions ──────────────────────────────────────────────────────────

  it("compares money exactly, not as floats", () => {
    const facts = { "lead.budget": "500000.01" };

    expect(matches([{ field: "lead.budget", operator: "gt", value: "500000.00" }], facts)).toBe(true);
    expect(matches([{ field: "lead.budget", operator: "gte", value: "500000.01" }], facts)).toBe(true);
    expect(matches([{ field: "lead.budget", operator: "gt", value: "500000.01" }], facts)).toBe(false);
  });

  it("does not match a numeric comparison against a non-number", () => {
    const facts = { "lead.company": "Acme" };
    expect(matches([{ field: "lead.company", operator: "gt", value: "10" }], facts)).toBe(false);
  });

  it("treats an absent fact as empty rather than matching everything", () => {
    expect(matches([{ field: "lead.missing", operator: "is_empty", value: null }], {})).toBe(true);
    expect(matches([{ field: "lead.missing", operator: "eq", value: "x" }], {})).toBe(false);
  });

  it("requires every condition to hold", () => {
    const facts = { "lead.score": 80, "lead.sourceSlug": "google" };

    expect(
      matches(
        [
          { field: "lead.score", operator: "gte", value: 50 },
          { field: "lead.sourceSlug", operator: "in", value: "google,bing" },
        ],
        facts,
      ),
    ).toBe(true);

    expect(
      matches(
        [
          { field: "lead.score", operator: "gte", value: 50 },
          { field: "lead.sourceSlug", operator: "in", value: "facebook" },
        ],
        facts,
      ),
    ).toBe(false);
  });

  it("never matches an operator it does not know", () => {
    expect(matches([{ field: "lead.score", operator: "sorta_like", value: 1 }], { "lead.score": 5 })).toBe(
      false,
    );
  });
});
