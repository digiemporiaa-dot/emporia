import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { announceClientDecision } from "@/lib/services/social-notify.service";
import { runAutomations } from "@/lib/automation/engine";
import { actionConfigSchema } from "@/lib/validation/automation";
import { ACTION_LABEL } from "@/lib/automation/action-labels";
import type { AutomationTriggerType } from "@/generated/prisma/enums";

/**
 * "A rejected post should be able to create a task" (brief §53).
 *
 * Pinned: a client asking for changes can put a task on the content's project,
 * titled from the event, for the content's owner (or the manager when nobody
 * owns it, said so), a named member of staff (never a portal user), due and
 * prioritised as configured, linking to the content, and audited; it is one
 * more task however many the project has; without a project it creates
 * nothing; and social notifications still link to the content, not the
 * project they now also carry.
 */

describe("the project task action", () => {
  it("is offered, labelled, and validated with safe defaults", () => {
    expect(ACTION_LABEL.CREATE_PROJECT_TASK).toBe("Create a task on the project");
    const parsed = actionConfigSchema.parse({ type: "CREATE_PROJECT_TASK", title: "Rework" });
    expect(parsed).toMatchObject({ assignTo: "PROJECT_MANAGER", dueInDays: 2, priority: "MEDIUM" });
    expect(actionConfigSchema.safeParse({ type: "CREATE_PROJECT_TASK", title: "" }).success).toBe(false);
    expect(actionConfigSchema.safeParse({ type: "CREATE_PROJECT_TASK", title: "x", assignTo: "ANYONE" }).success).toBe(false);
  });
});

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `ptk${Date.now()}`;
const DAY = 86_400_000;

describeDb("rules that put social work on the project", () => {
  let roleId = "";
  let clientId = "";
  let projectId = "";
  const users = { manager: "", owner: "", portal: "" };
  const automationIds: string[] = [];
  let counter = 0;

  async function user(key: string, type: "STAFF" | "CLIENT" = "STAFF") {
    return (
      await db.user.create({
        data: { email: `${TAG}-${key}@emporia.test`, name: key, type, status: "ACTIVE", roleId, clientId: type === "CLIENT" ? clientId : null },
        select: { id: true },
      })
    ).id;
  }

  async function idea(ownerId: string | null = users.owner) {
    counter += 1;
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, ownerId, title: `${TAG} Diwali reel ${counter}`, channel: "INSTAGRAM", stage: "CLIENT_REVIEW" },
      select: { id: true, title: true },
    });
    await db.socialPost.create({
      data: { contentItemId: item.id, clientId, provider: "INSTAGRAM", type: "REEL", status: "DRAFT", caption: "Copy." },
    });
    return item;
  }

  async function rule(trigger: AutomationTriggerType, action: Record<string, unknown>, conditions: { field: string; operator: string; value: unknown }[] = []) {
    const created = await db.automation.create({
      data: {
        name: `${TAG} ${trigger}`,
        isActive: true,
        triggers: { create: { type: trigger } },
        conditions: {
          create: [{ field: "client.name", operator: "eq", value: `${TAG} client`, order: 0 }, ...conditions.map((c, i) => ({ field: c.field, operator: c.operator, value: c.value as never, order: i + 1 }))],
        },
        actions: { create: { type: action["type"] as never, config: action as never } },
      },
      select: { id: true },
    });
    automationIds.push(created.id);
  }

  const tasks = () => db.projectTask.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    roleId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { roleId: true } })).roleId;
    clientId = (await db.client.create({ data: { name: `${TAG} client`, slug: `${TAG}-a` }, select: { id: true } })).id;
    users.manager = await user("manager");
    users.owner = await user("owner");
    users.portal = await user("portal", "CLIENT");
    projectId = (
      await db.project.create({
        data: { code: `T-${TAG}`.slice(0, 20), name: "Retainer", clientId, managerId: users.manager, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await db.automation.deleteMany({ where: { id: { in: automationIds.splice(0) } } });
    await db.projectTask.deleteMany({ where: { projectId } });
  });

  afterAll(async () => {
    const userIds = Object.values(users).filter(Boolean);
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.socialPost.deleteMany({ where: { clientId } });
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
    await db.project.deleteMany({ where: { clientId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.client.deleteMany({ where: { id: clientId } });
  });

  it("creates a rework task for the content's owner when the client asks for changes, and not when they approve", async () => {
    await rule(
      "SOCIAL_APPROVAL_DECIDED",
      { type: "CREATE_PROJECT_TASK", title: "Rework: {{social.title}}", detail: "{{client.name}} asked for changes.", assignTo: "CONTENT_OWNER", dueInDays: 2, priority: "HIGH" },
      [{ field: "social.decision", operator: "eq", value: "CHANGES_REQUESTED" }],
    );
    const item = await idea();
    const before = Date.now();
    await announceClientDecision(item.id, "CHANGES_REQUESTED", "Shorter, please.");

    const [task, ...rest] = await tasks();
    expect(rest).toEqual([]);
    expect(task).toMatchObject({ title: `Rework: ${item.title}`, assigneeId: users.owner, priority: "HIGH", status: "TODO" });
    expect(task!.description).toContain(`${TAG} client asked for changes.`);
    expect(task!.description).toContain(`/admin/clients/${clientId}/social/content/${item.id}`);
    const due = task!.dueAt!.getTime() - before;
    expect(due).toBeGreaterThan(1.9 * DAY);
    expect(due).toBeLessThan(2.1 * DAY);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "ProjectTask", entityId: task!.id } });
    expect(audit.action).toBe("CREATE");
    expect(audit.after).toMatchObject({ automated: true, projectId, contentItemId: item.id });

    await announceClientDecision(item.id, "APPROVED", null);
    expect(await tasks()).toHaveLength(1);
  });

  it("gives it to the manager when nobody owns the content, and says so", async () => {
    await rule("SOCIAL_APPROVAL_DECIDED", { type: "CREATE_PROJECT_TASK", title: "Rework", assignTo: "CONTENT_OWNER" });
    const item = await idea(null);
    const [outcome] = await runAutomations("SOCIAL_APPROVAL_DECIDED", { clientId, contentItemId: item.id, projectId });
    expect(outcome!.actions[0]!.detail).toContain("went to the project manager");
    expect((await tasks())[0]!.assigneeId).toBe(users.manager);
  });

  it("assigns a named member of staff, and never a portal user", async () => {
    await rule("SOCIAL_APPROVAL_DECIDED", { type: "CREATE_PROJECT_TASK", title: "For the owner", assignTo: "SPECIFIC", userId: users.owner });
    const item = await idea();
    await runAutomations("SOCIAL_APPROVAL_DECIDED", { clientId, contentItemId: item.id, projectId });
    expect((await tasks()).map((t) => t.assigneeId)).toEqual([users.owner]);

    await db.automation.deleteMany({ where: { id: { in: automationIds.splice(0) } } });
    await rule("SOCIAL_APPROVAL_DECIDED", { type: "CREATE_PROJECT_TASK", title: "For the client", assignTo: "SPECIFIC", userId: users.portal });
    const [outcome] = await runAutomations("SOCIAL_APPROVAL_DECIDED", { clientId, contentItemId: item.id, projectId });
    expect(outcome!.actions[0]).toMatchObject({ changed: false });
    expect((await tasks()).map((t) => t.title)).toEqual(["For the owner"]);
  });

  it("adds one more task however many the project has, and nothing without a project", async () => {
    await db.projectTask.create({ data: { projectId, title: "Already here" } });
    await rule("SOCIAL_APPROVAL_DECIDED", { type: "CREATE_PROJECT_TASK", title: "One more" });
    const item = await idea();
    await runAutomations("SOCIAL_APPROVAL_DECIDED", { clientId, contentItemId: item.id, projectId });
    const all = await tasks();
    expect(all.map((t) => [t.title, t.order])).toEqual([
      ["Already here", 0],
      ["One more", 1],
    ]);

    const [outcome] = await runAutomations("SOCIAL_APPROVAL_DECIDED", { clientId, contentItemId: item.id });
    expect(outcome!.actions[0]).toMatchObject({ changed: false, detail: "No project to add the task to." });
    expect(await tasks()).toHaveLength(2);
  });

  it("still links a social notification to the content, and can now reach the project manager", async () => {
    await rule("SOCIAL_APPROVAL_DECIDED", { type: "NOTIFY_USER", to: "PROJECT_MANAGER", title: `${TAG} decided {{social.title}}` });
    const item = await idea();
    await announceClientDecision(item.id, "CHANGES_REQUESTED", "No.");
    const note = await db.notification.findFirstOrThrow({ where: { userId: users.manager, title: { startsWith: `${TAG} decided` } } });
    expect(note.href).toBe(`/admin/clients/${clientId}/social/content/${item.id}`);
    expect(note.entityType).toBe("ContentCalendarItem");
    expect(note.entityId).toBe(item.id);
  });
});
