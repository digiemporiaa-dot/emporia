import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  addComment,
  addDependency,
  createProject,
  getProject,
  listProjects,
  listTasks,
  logTime,
  projectTime,
  saveMilestone,
  saveTask,
  setProjectStatus,
  setTaskStatus,
} from "@/lib/services/project.service";
import {
  addApprovalVersion,
  decideApproval,
  getApproval,
  getContentItem,
  requestApproval,
  saveContentItem,
  setContentStage,
} from "@/lib/services/delivery-content.service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * The Phase 9 exit criterion: a project runs end to end internally, and a
 * content item moves through every workflow stage.
 *
 * Driven through the service layer against a real database, so transactions,
 * foreign keys and the derived-health recomputation are exercised rather than
 * mocked.
 */

const DAY = 24 * 60 * 60 * 1000;
/** Dates are relative to now: a fixture pinned to a literal date goes stale. */
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("project delivery", () => {
  let prisma: PrismaClient;
  let actor: Actor;
  let outsider: Actor;
  let clientId = "";
  let projectId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const user = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });

    const staffRole = await prisma.role.findFirstOrThrow({
      where: { name: "STAFF" },
      select: { id: true },
    });

    const other = await prisma.user.create({
      data: {
        email: "delivery-outsider@delivery.test",
        name: "Delivery Outsider",
        passwordHash: "not-a-real-hash",
        type: "STAFF",
        status: "ACTIVE",
        roleId: staffRole.id,
      },
      select: { id: true },
    });

    const base = {
      name: "Test",
      email: "t@t.test",
      type: "STAFF" as const,
      roleName: "PROJECT_MANAGER" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };

    const permissions = new Set([
      "projects.view",
      "projects.view.team",
      "projects.create",
      "projects.edit",
      "tasks.view",
      "tasks.create",
      "tasks.edit",
      "tasks.assign",
      "timeentries.view",
      "timeentries.create",
      "content.view",
      "content.create",
      "content.edit",
      "content.publish",
      "approvals.view",
      "approvals.request",
      "approvals.decide",
    ]);

    actor = { ...base, userId: user.id, permissions };
    // Same permissions, but no team-wide visibility: sees only what they
    // manage or are assigned.
    outsider = {
      ...base,
      userId: other.id,
      permissions: new Set([...permissions].filter((p) => p !== "projects.view.team")),
    };

    const client = await prisma.client.create({
      data: { name: "Delivery Test Client", slug: `delivery-test-${Date.now()}` },
      select: { id: true },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.approvalVersion.deleteMany({
      where: { approval: { client: { name: "Delivery Test Client" } } },
    });
    await prisma.approval.deleteMany({ where: { client: { name: "Delivery Test Client" } } });
    await prisma.contentCalendarItem.deleteMany({
      where: { client: { name: "Delivery Test Client" } },
    });
    await prisma.timeEntry.deleteMany({ where: { project: { clientId } } });
    await prisma.projectComment.deleteMany({ where: { project: { clientId } } });
    await prisma.projectTaskDependency.deleteMany({ where: { task: { project: { clientId } } } });
    await prisma.projectTask.deleteMany({ where: { project: { clientId } } });
    await prisma.projectMilestone.deleteMany({ where: { project: { clientId } } });
    await prisma.project.deleteMany({ where: { clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { email: "delivery-outsider@delivery.test" } });
    await prisma.$disconnect();
  });

  // ── Projects ────────────────────────────────────────────────────────────

  it("creates a numbered project for a real client", async () => {
    const project = await createProject(actor, {
      name: "Delivery end to end",
      clientId,
      serviceId: null,
      managerId: actor.userId,
      contractId: null,
      status: "PLANNING",
      budget: "450000.00",
      currency: "INR",
      startsAt: daysFromNow(-30),
      dueAt: daysFromNow(90),
    });

    projectId = project.id;
    expect(project.code).toMatch(/^PRJ-\d{4}-\d{4}$/);

    const loaded = await getProject(actor, projectId);
    // Budget crosses the service boundary as a fixed-precision string.
    expect(loaded.budget).toBe("450000.00");
    expect(typeof loaded.budget).toBe("string");
    expect(loaded.health).toBe("ON_TRACK");
  });

  it("refuses a project for a client that does not exist", async () => {
    await expect(
      createProject(actor, {
        name: "Orphan project",
        clientId: "no-such-client",
        serviceId: null,
        managerId: actor.userId,
        contractId: null,
        status: "PLANNING",
        budget: "0",
        currency: "INR",
        startsAt: new Date(),
        dueAt: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to create a project without the permission", async () => {
    const weak: Actor = { ...actor, permissions: new Set(["projects.view"]) };
    await expect(
      createProject(weak, {
        name: "Unauthorised project",
        clientId,
        serviceId: null,
        managerId: actor.userId,
        contractId: null,
        status: "PLANNING",
        budget: "0",
        currency: "INR",
        startsAt: new Date(),
        dueAt: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ── Visibility ──────────────────────────────────────────────────────────

  it("hides a project from someone who neither manages nor works on it", async () => {
    const mine = await listProjects(actor, { search: "Delivery end to end" });
    expect(mine.total).toBe(1);

    const theirs = await listProjects(outsider, { search: "Delivery end to end" });
    expect(theirs.total).toBe(0);

    // And by direct id: not visible is indistinguishable from not existing.
    await expect(getProject(outsider, projectId)).rejects.toBeInstanceOf(NotFoundError);
  });

  // ── Milestones and tasks ────────────────────────────────────────────────

  let milestoneId = "";
  let researchId = "";
  let writeId = "";

  it("adds a milestone and two tasks", async () => {
    const milestone = await saveMilestone(actor, null, {
      projectId,
      title: "Launch",
      dueAt: daysFromNow(45),
      status: "PENDING",
      order: 0,
    });
    milestoneId = milestone.id;

    const research = await saveTask(actor, null, {
      projectId,
      parentId: null,
      milestoneId,
      title: "Keyword research",
      description: null,
      assigneeId: actor.userId,
      status: "TODO",
      priority: "HIGH",
      dueAt: daysFromNow(10),
      estimateHours: "12",
    });
    researchId = research.id;

    const write = await saveTask(actor, null, {
      projectId,
      parentId: null,
      milestoneId,
      title: "Write the pillar page",
      description: null,
      assigneeId: actor.userId,
      status: "TODO",
      priority: "MEDIUM",
      dueAt: null,
      estimateHours: "20",
    });
    writeId = write.id;

    const tasks = await listTasks(actor, { projectId });
    expect(tasks).toHaveLength(2);
    // Estimates are Decimal in the database and must not leave as one.
    expect(typeof tasks[0]?.estimateHours).toBe("string");
  });

  it("allows one level of subtask and no more", async () => {
    const subtask = await saveTask(actor, null, {
      projectId,
      parentId: researchId,
      milestoneId: null,
      title: "Pull competitor terms",
      description: null,
      assigneeId: null,
      status: "TODO",
      priority: "LOW",
      dueAt: null,
      estimateHours: null,
    });

    await expect(
      saveTask(actor, null, {
        projectId,
        parentId: subtask.id,
        milestoneId: null,
        title: "Too deep",
        description: null,
        assigneeId: null,
        status: "TODO",
        priority: "LOW",
        dueAt: null,
        estimateHours: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to assign a task without tasks.assign", async () => {
    const unassigning: Actor = {
      ...actor,
      permissions: new Set(["projects.view", "projects.view.team", "tasks.create", "tasks.view"]),
    };

    await expect(
      saveTask(unassigning, null, {
        projectId,
        parentId: null,
        milestoneId: null,
        title: "Should not be assigned",
        description: null,
        assigneeId: actor.userId,
        status: "TODO",
        priority: "LOW",
        dueAt: null,
        estimateHours: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // ── Dependencies ────────────────────────────────────────────────────────

  it("records a dependency and refuses one that would loop", async () => {
    await addDependency(actor, writeId, researchId);

    await expect(addDependency(actor, researchId, writeId)).rejects.toBeInstanceOf(ConflictError);
    await expect(addDependency(actor, writeId, writeId)).rejects.toBeInstanceOf(ValidationError);
    await expect(addDependency(actor, writeId, researchId)).rejects.toBeInstanceOf(ConflictError);
  });

  it("will not start a task that waits on unfinished work", async () => {
    await expect(setTaskStatus(actor, writeId, "IN_PROGRESS")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("starts the task once its prerequisite is done", async () => {
    await setTaskStatus(actor, researchId, "IN_PROGRESS");
    await setTaskStatus(actor, researchId, "DONE");

    const started = await setTaskStatus(actor, writeId, "IN_PROGRESS");
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("refuses a transition the lifecycle does not allow", async () => {
    await setTaskStatus(actor, writeId, "CANCELLED");
    await expect(setTaskStatus(actor, writeId, "DONE")).rejects.toBeInstanceOf(ValidationError);
    await setTaskStatus(actor, writeId, "TODO");
  });

  // ── Derived health ──────────────────────────────────────────────────────

  it("derives health from the project's own tasks, not from a form field", async () => {
    const before = await getProject(actor, projectId);
    expect(before.health).toBe("ON_TRACK");

    // A task that is open and past due is what "at risk" means.
    await saveTask(actor, null, {
      projectId,
      parentId: null,
      milestoneId: null,
      title: "Overdue work",
      description: null,
      assigneeId: actor.userId,
      status: "TODO",
      priority: "URGENT",
      dueAt: daysFromNow(-5),
      estimateHours: null,
    });

    const after = await getProject(actor, projectId);
    expect(after.health).toBe("AT_RISK");

    // An overdue milestone is worse than an overdue task.
    await saveMilestone(actor, milestoneId, {
      projectId,
      title: "Launch",
      dueAt: daysFromNow(-2),
      status: "IN_PROGRESS",
      order: 0,
    });

    const delayed = await getProject(actor, projectId);
    expect(delayed.health).toBe("DELAYED");
  });

  // ── Time ────────────────────────────────────────────────────────────────

  it("logs time in whole minutes and totals it", async () => {
    await logTime(actor, {
      projectId,
      taskId: researchId,
      hours: "7.5",
      note: "Research",
      startedAt: daysFromNow(-3),
    });
    await logTime(actor, {
      projectId,
      taskId: null,
      hours: "4.1",
      note: "Planning",
      startedAt: daysFromNow(-2),
    });

    const time = await projectTime(actor, projectId);
    // 450 + 246, with no float drift.
    expect(time.totalMinutes).toBe(696);
    expect(time.byUser[0]?.minutes).toBe(696);
    expect(time.recent).toHaveLength(2);
  });

  it("refuses an entry longer than a day or shorter than nothing", async () => {
    await expect(
      logTime(actor, {
        projectId,
        taskId: null,
        hours: "0",
        note: null,
        startedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      logTime(actor, {
        projectId,
        taskId: null,
        hours: "25",
        note: null,
        startedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses time against a task in another project", async () => {
    const other = await createProject(actor, {
      name: "Another delivery project",
      clientId,
      serviceId: null,
      managerId: actor.userId,
      contractId: null,
      status: "ACTIVE",
      budget: "0",
      currency: "INR",
      startsAt: daysFromNow(-10),
      dueAt: null,
    });

    await expect(
      logTime(actor, {
        projectId: other.id,
        taskId: researchId,
        hours: "1",
        note: null,
        startedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // ── Comments ────────────────────────────────────────────────────────────

  it("records a comment against the project", async () => {
    const comment = await addComment(actor, {
      projectId,
      taskId: researchId,
      body: "Draft outline is ready for review.",
    });
    expect(comment.id).toBeTruthy();
  });

  // ── Project status ──────────────────────────────────────────────────────

  it("walks the project status lifecycle and refuses illegal jumps", async () => {
    await setProjectStatus(actor, projectId, "ACTIVE");
    await expect(setProjectStatus(actor, projectId, "ACTIVE")).rejects.toBeInstanceOf(
      ValidationError,
    );

    const completed = await setProjectStatus(actor, projectId, "COMPLETED");
    expect(completed.status).toBe("COMPLETED");

    // Completing records a time, and a completed project is not "late".
    const loaded = await getProject(actor, projectId);
    expect(loaded.completedAt).not.toBeNull();
    expect(loaded.health).toBe("ON_TRACK");

    await expect(setProjectStatus(actor, projectId, "CANCELLED")).rejects.toBeInstanceOf(
      ValidationError,
    );

    await setProjectStatus(actor, projectId, "ACTIVE");
  });

  // ── Content workflow ────────────────────────────────────────────────────

  let itemId = "";

  it("creates a content item that takes its client from the project", async () => {
    const item = await saveContentItem(actor, null, {
      projectId,
      channel: "INSTAGRAM",
      title: "Launch teaser",
      brief: "Three-frame carousel.",
      ownerId: actor.userId,
      scheduledFor: null,
    });
    itemId = item.id;

    const row = await prisma.contentCalendarItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { clientId: true },
    });
    // Never taken from the caller: this is the column portal isolation uses.
    expect(row.clientId).toBe(clientId);
  });

  it("moves through every workflow stage in order", async () => {
    expect((await setContentStage(actor, itemId, "DRAFT")).stage).toBe("DRAFT");
    expect((await setContentStage(actor, itemId, "INTERNAL_REVIEW")).stage).toBe("INTERNAL_REVIEW");
    expect((await setContentStage(actor, itemId, "CLIENT_REVIEW")).stage).toBe("CLIENT_REVIEW");
    expect((await setContentStage(actor, itemId, "APPROVED")).stage).toBe("APPROVED");

    // Scheduling needs a date to schedule for.
    await expect(setContentStage(actor, itemId, "SCHEDULED")).rejects.toBeInstanceOf(
      ValidationError,
    );

    await saveContentItem(actor, itemId, {
      projectId,
      channel: "INSTAGRAM",
      title: "Launch teaser",
      brief: "Three-frame carousel.",
      ownerId: actor.userId,
      scheduledFor: daysFromNow(20),
    });

    expect((await setContentStage(actor, itemId, "SCHEDULED")).stage).toBe("SCHEDULED");
    expect((await setContentStage(actor, itemId, "PUBLISHED")).stage).toBe("PUBLISHED");

    const published = await getContentItem(actor, itemId);
    expect(published.publishedAt).not.toBeNull();
  });

  it("treats published as the end of the line", async () => {
    await expect(setContentStage(actor, itemId, "DRAFT")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to skip the pipeline", async () => {
    const skipper = await saveContentItem(actor, null, {
      projectId,
      channel: "BLOG",
      title: "Skipping the queue",
      brief: null,
      ownerId: null,
      scheduledFor: daysFromNow(25),
    });

    await expect(setContentStage(actor, skipper.id, "SCHEDULED")).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(setContentStage(actor, skipper.id, "PUBLISHED")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("requires content.publish to publish", async () => {
    const item = await saveContentItem(actor, null, {
      projectId,
      channel: "LINKEDIN",
      title: "Needs the publish right",
      brief: null,
      ownerId: null,
      scheduledFor: daysFromNow(30),
    });

    await setContentStage(actor, item.id, "DRAFT");
    await setContentStage(actor, item.id, "INTERNAL_REVIEW");
    await setContentStage(actor, item.id, "APPROVED");
    await setContentStage(actor, item.id, "SCHEDULED");

    const editor: Actor = {
      ...actor,
      permissions: new Set([
        "projects.view",
        "projects.view.team",
        "content.view",
        "content.edit",
      ]),
    };

    await expect(setContentStage(editor, item.id, "PUBLISHED")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  // ── Approvals ───────────────────────────────────────────────────────────

  let approvalId = "";

  it("opens an approval with its first version", async () => {
    const approval = await requestApproval(actor, {
      title: "Teaser creative",
      projectId: null,
      contentItemId: itemId,
      notes: "First cut.",
    });
    approvalId = approval.id;

    const loaded = await getApproval(actor, approvalId);
    expect(loaded.currentVersion).toBe(1);
    expect(loaded.status).toBe("PENDING");
    expect(loaded.versions).toHaveLength(1);
    // The client is inherited from the content item, never supplied.
    expect(loaded.client.id).toBe(clientId);
  });

  it("refuses an approval that belongs to nothing", async () => {
    await expect(
      requestApproval(actor, {
        title: "Floating approval",
        projectId: null,
        contentItemId: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps every version rather than editing the last one", async () => {
    await expect(
      decideApproval(actor, approvalId, "CHANGES_REQUESTED", null),
    ).rejects.toBeInstanceOf(ValidationError);

    await decideApproval(actor, approvalId, "CHANGES_REQUESTED", "Tighten the second frame.");

    const afterFeedback = await getApproval(actor, approvalId);
    expect(afterFeedback.status).toBe("CHANGES_REQUESTED");
    expect(afterFeedback.versions[0]?.feedback).toBe("Tighten the second frame.");

    // A decided version cannot be decided twice.
    await expect(decideApproval(actor, approvalId, "APPROVED", null)).rejects.toBeInstanceOf(
      ConflictError,
    );

    await addApprovalVersion(actor, approvalId, "Second cut.");
    const v2 = await getApproval(actor, approvalId);
    expect(v2.currentVersion).toBe(2);
    expect(v2.status).toBe("PENDING");
    expect(v2.versions).toHaveLength(2);
    // Version 1 keeps the feedback it was given.
    expect(v2.versions.find((v) => v.version === 1)?.feedback).toBe("Tighten the second frame.");

    await decideApproval(actor, approvalId, "APPROVED", null);
    const approved = await getApproval(actor, approvalId);
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedBy?.id).toBe(actor.userId);
  });

  it("will not add a version to an approved approval", async () => {
    await expect(addApprovalVersion(actor, approvalId, "Third cut.")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("requires approvals.decide to decide", async () => {
    const requester: Actor = {
      ...actor,
      permissions: new Set([
        "projects.view",
        "projects.view.team",
        "approvals.view",
        "approvals.request",
      ]),
    };

    const fresh = await requestApproval(actor, {
      title: "Second creative",
      projectId,
      contentItemId: null,
      notes: null,
    });

    await expect(
      decideApproval(requester, fresh.id, "APPROVED", null),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides an approval on a project the actor cannot see", async () => {
    await expect(getApproval(outsider, approvalId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
