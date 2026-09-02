import "server-only";
import { db, type DbClient } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { can, requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { toMoneyString } from "@/lib/money";
import { hoursToMinutes } from "@/lib/projects/hours";
import { deriveHealth } from "@/lib/projects/health";
import { nextProjectCode } from "@/lib/projects/numbering";
import {
  blockingDependencies,
  canTransitionTask,
  projectTransitionError,
  TASK_STATUS_LABEL,
  wouldCycle,
} from "@/lib/projects/lifecycle";
import type { Actor } from "@/lib/actor/types";
import type { MilestoneStatus, ProjectStatus, TaskStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CommentInput,
  MilestoneInput,
  ProjectInput,
  TaskInput,
  TimeEntryInput,
} from "@/lib/validation/project";

/**
 * Delivery: projects, tasks, milestones, comments and time.
 *
 * Two rules carry this module. Row-level visibility is defined once in
 * `visibilityFilter` — `projects.view` shows a user the projects they manage or
 * are assigned work on, `projects.view.team` shows all of them. And health is
 * derived, never typed in: it is recomputed from the project's own tasks and
 * milestones whenever any of them changes (lib/projects/health.ts).
 */

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** The single definition of which projects an actor may see. */
export function visibilityFilter(actor: Actor): Prisma.ProjectWhereInput {
  if (actor.roleName === "SUPER_ADMIN" || can(actor, "projects.view.team")) return {};
  if (!can(actor, "projects.view")) {
    // Callers check first; this makes the failure mode a matching-nothing
    // filter rather than an accidental full table scan.
    return { id: "__none__" };
  }
  return {
    OR: [{ managerId: actor.userId }, { tasks: { some: { assigneeId: actor.userId } } }],
  };
}

export function seesWholeTeam(actor: Actor): boolean {
  return actor.roleName === "SUPER_ADMIN" || can(actor, "projects.view.team");
}

/**
 * Resolve a project by id *and* the visibility filter, so a project the actor
 * may not see is indistinguishable from one that does not exist.
 */
async function visibleProject(actor: Actor, id: string, select: Prisma.ProjectSelect) {
  const project = await db.project.findFirst({
    where: { AND: [{ id }, visibilityFilter(actor)] },
    select,
  });
  if (!project) throw new NotFoundError("That project does not exist.");
  return project;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Recompute and store health from the project's own tasks and milestones.
 *
 * Called after every change that can move it. Returns the derived result so a
 * caller can show the reason without a second query.
 */
export async function recomputeHealth(tx: DbClient, projectId: string, now = new Date()) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      startsAt: true,
      dueAt: true,
      completedAt: true,
      health: true,
      tasks: { select: { status: true, dueAt: true } },
      milestones: { select: { status: true, dueAt: true } },
    },
  });

  if (!project) throw new NotFoundError("That project does not exist.");

  const result = deriveHealth({
    now,
    startsAt: project.startsAt,
    dueAt: project.dueAt,
    completedAt: project.completedAt,
    tasks: project.tasks,
    milestones: project.milestones,
  });

  if (result.health !== project.health) {
    await tx.project.update({ where: { id: projectId }, data: { health: result.health } });
  }

  return result;
}

/**
 * The derived health of a project, without writing it.
 *
 * The stored column is what lists and filters use; this is the same
 * computation with its reason and counts, for a detail page that should say
 * *why* rather than just show a colour.
 */
export async function healthDetail(actor: Actor, projectId: string, now = new Date()) {
  requirePermission(actor, "projects.view");

  const project = await visibleProject(actor, projectId, {
    startsAt: true,
    dueAt: true,
    completedAt: true,
    tasks: { select: { status: true, dueAt: true } },
    milestones: { select: { status: true, dueAt: true } },
  });

  const typed = project as {
    startsAt: Date;
    dueAt: Date | null;
    completedAt: Date | null;
    tasks: { status: TaskStatus; dueAt: Date | null }[];
    milestones: { status: MilestoneStatus; dueAt: Date }[];
  };

  return deriveHealth({
    now,
    startsAt: typed.startsAt,
    dueAt: typed.dueAt,
    completedAt: typed.completedAt,
    tasks: typed.tasks,
    milestones: typed.milestones,
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectListParams = {
  page?: number;
  perPage?: number;
  search?: string;
  status?: ProjectStatus | null;
  clientId?: string | null;
  managerId?: string | null;
  sort?: "createdAt" | "name" | "dueAt" | "status";
  direction?: "asc" | "desc";
};

const MAX_PER_PAGE = 100;

export async function listProjects(actor: Actor, params: ProjectListParams = {}) {
  requirePermission(actor, "projects.view");

  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(5, params.perPage ?? 25));
  const search = params.search?.trim();

  const where: Prisma.ProjectWhereInput = {
    AND: [
      visibilityFilter(actor),
      ...(search
        ? [
            {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { code: { contains: search, mode: "insensitive" as const } },
                { client: { name: { contains: search, mode: "insensitive" as const } } },
              ],
            },
          ]
        : []),
    ],
    ...(params.status ? { status: params.status } : {}),
    ...(params.clientId ? { clientId: params.clientId } : {}),
    ...(params.managerId ? { managerId: params.managerId } : {}),
  };

  const orderBy: Prisma.ProjectOrderByWithRelationInput =
    params.sort === "name"
      ? { name: params.direction ?? "asc" }
      : params.sort === "dueAt"
        ? { dueAt: params.direction ?? "asc" }
        : params.sort === "status"
          ? { status: params.direction ?? "asc" }
          : { createdAt: params.direction ?? "desc" };

  // Server-side pagination; the browser never receives the whole table.
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        health: true,
        budget: true,
        currency: true,
        startsAt: true,
        dueAt: true,
        client: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
        service: { select: { name: true } },
        _count: { select: { tasks: true, milestones: true } },
      },
    }),
    db.project.count({ where }),
  ]);

  return {
    // Money crosses the boundary as a fixed-precision string, never a number.
    rows: rows.map((row) => ({ ...row, budget: toMoneyString(row.budget) })),
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

const projectSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  health: true,
  budget: true,
  currency: true,
  startsAt: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  clientId: true,
  serviceId: true,
  managerId: true,
  contractId: true,
  client: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
  contract: { select: { id: true, number: true, title: true } },
  milestones: {
    orderBy: [{ order: "asc" }, { dueAt: "asc" }],
    select: { id: true, title: true, dueAt: true, status: true, order: true, _count: { select: { tasks: true } } },
  },
} as const satisfies Prisma.ProjectSelect;

export async function getProject(actor: Actor, id: string) {
  requirePermission(actor, "projects.view");

  // Resolved by id AND the visibility filter, so a project the actor may not
  // see is indistinguishable from one that does not exist.
  const project = await db.project.findFirst({
    where: { AND: [{ id }, visibilityFilter(actor)] },
    select: projectSelect,
  });

  if (!project) throw new NotFoundError("That project does not exist.");

  return { ...project, budget: toMoneyString(project.budget) };
}

export async function createProject(actor: Actor, input: ProjectInput) {
  requirePermission(actor, "projects.create");

  const client = await db.client.findFirst({
    where: { id: input.clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new ValidationError("That client does not exist.");

  return withAudit(
    { actor, action: "CREATE", entityType: "Project", entityId: input.name },
    async (tx) => {
      const code = await nextProjectCode(tx);

      return tx.project.create({
        data: {
          code,
          name: input.name,
          clientId: input.clientId,
          serviceId: input.serviceId || null,
          managerId: input.managerId,
          contractId: input.contractId || null,
          status: input.status,
          budget: input.budget,
          currency: input.currency,
          startsAt: input.startsAt,
          dueAt: input.dueAt ?? null,
        },
        select: { id: true, code: true },
      });
    },
  );
}

export async function updateProject(actor: Actor, id: string, input: ProjectInput) {
  requirePermission(actor, "projects.edit");

  const before = await visibleProject(actor, id, {
    id: true,
    status: true,
    name: true,
    budget: true,
    startsAt: true,
    dueAt: true,
  });

  const result = await withAudit(
    { actor, action: "UPDATE", entityType: "Project", entityId: id, before },
    async (tx) => {
      const updated = await tx.project.update({
        where: { id },
        data: {
          name: input.name,
          serviceId: input.serviceId || null,
          managerId: input.managerId,
          contractId: input.contractId || null,
          budget: input.budget,
          currency: input.currency,
          startsAt: input.startsAt,
          dueAt: input.dueAt ?? null,
        },
        select: { id: true },
      });

      // Dates moved, so the health verdict may have moved with them.
      await recomputeHealth(tx, id);
      return updated;
    },
  );

  return result;
}

export async function setProjectStatus(actor: Actor, id: string, status: ProjectStatus) {
  requirePermission(actor, "projects.edit");

  const before = await visibleProject(actor, id, { id: true, status: true, completedAt: true });
  const current = (before as { status: ProjectStatus }).status;

  const error = projectTransitionError(current, status);
  if (error) throw new ValidationError(error);

  return withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "Project", entityId: id, before },
    async (tx) => {
      const updated = await tx.project.update({
        where: { id },
        data: {
          status,
          // Completion is a fact with a time, not just a label.
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
        select: { id: true, status: true },
      });

      await recomputeHealth(tx, id);
      return updated;
    },
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export async function saveMilestone(actor: Actor, id: string | null, input: MilestoneInput) {
  requirePermission(actor, id ? "projects.edit" : "projects.create");
  await visibleProject(actor, input.projectId, { id: true });

  return withAudit(
    {
      actor,
      action: id ? "UPDATE" : "CREATE",
      entityType: "ProjectMilestone",
      entityId: id ?? input.title,
    },
    async (tx) => {
      const data = {
        title: input.title,
        dueAt: input.dueAt,
        status: input.status,
        order: input.order,
      };

      const milestone = id
        ? await tx.projectMilestone.update({ where: { id }, data, select: { id: true } })
        : await tx.projectMilestone.create({
            data: { ...data, projectId: input.projectId },
            select: { id: true },
          });

      await recomputeHealth(tx, input.projectId);
      return milestone;
    },
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskListParams = {
  projectId: string;
  status?: TaskStatus | null;
  assigneeId?: string | null;
  milestoneId?: string | null;
};

export async function listTasks(actor: Actor, params: TaskListParams) {
  requirePermission(actor, "tasks.view");
  await visibleProject(actor, params.projectId, { id: true });

  const tasks = await db.projectTask.findMany({
    where: {
      projectId: params.projectId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.assigneeId ? { assigneeId: params.assigneeId } : {}),
      ...(params.milestoneId ? { milestoneId: params.milestoneId } : {}),
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      parentId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueAt: true,
      estimateHours: true,
      order: true,
      assignee: { select: { id: true, name: true } },
      milestone: { select: { id: true, title: true } },
      dependencies: {
        select: { dependsOn: { select: { id: true, title: true, status: true } } },
      },
      _count: { select: { subtasks: true, comments: true, timeEntries: true } },
    },
  });

  return tasks.map((task) => ({
    ...task,
    // Hours are Decimal in the database and must not reach a client component
    // as one.
    estimateHours: task.estimateHours ? task.estimateHours.toString() : null,
  }));
}

export async function saveTask(actor: Actor, id: string | null, input: TaskInput) {
  requirePermission(actor, id ? "tasks.edit" : "tasks.create");
  await visibleProject(actor, input.projectId, { id: true });

  if (input.assigneeId && !can(actor, "tasks.assign")) {
    throw new ValidationError("You do not have permission to assign tasks.");
  }

  if (input.parentId) {
    const parent = await db.projectTask.findFirst({
      where: { id: input.parentId, projectId: input.projectId },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new ValidationError("That parent task is not in this project.");
    // One level of nesting: a subtask of a subtask is a project, not a task.
    if (parent.parentId) throw new ValidationError("A subtask cannot have subtasks of its own.");
    if (id && parent.id === id) throw new ValidationError("A task cannot be its own parent.");
  }

  return withAudit(
    { actor, action: id ? "UPDATE" : "CREATE", entityType: "ProjectTask", entityId: id ?? input.title },
    async (tx) => {
      const data = {
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId || null,
        status: input.status,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        estimateHours: input.estimateHours || null,
        milestoneId: input.milestoneId || null,
        parentId: input.parentId || null,
      };

      const task = id
        ? await tx.projectTask.update({ where: { id }, data, select: { id: true } })
        : await tx.projectTask.create({
            data: { ...data, projectId: input.projectId },
            select: { id: true },
          });

      await recomputeHealth(tx, input.projectId);
      return task;
    },
  );
}

/**
 * Move a task to a new status.
 *
 * A task cannot start while an unfinished task it depends on is outstanding —
 * that is the whole point of recording the dependency, and enforcing it in the
 * UI alone would leave the rule to whoever remembers it.
 */
export async function setTaskStatus(actor: Actor, taskId: string, status: TaskStatus) {
  requirePermission(actor, "tasks.edit");

  const task = await db.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      status: true,
      title: true,
      dependencies: { select: { dependsOnId: true, dependsOn: { select: { status: true, title: true } } } },
    },
  });

  if (!task) throw new NotFoundError("That task does not exist.");
  await visibleProject(actor, task.projectId, { id: true });

  if (task.status === status) {
    throw new ValidationError("The task is already at that status.");
  }
  if (!canTransitionTask(task.status, status)) {
    throw new ValidationError(
      `A ${TASK_STATUS_LABEL[task.status].toLowerCase()} task cannot move to ${TASK_STATUS_LABEL[status].toLowerCase()}.`,
    );
  }

  if (status === "IN_PROGRESS" || status === "IN_REVIEW" || status === "DONE") {
    const blocking = blockingDependencies(
      task.dependencies.map((d) => ({ dependsOnId: d.dependsOnId, status: d.dependsOn.status })),
    );
    if (blocking.length > 0) {
      const names = task.dependencies
        .filter((d) => blocking.includes(d.dependsOnId))
        .map((d) => d.dependsOn.title);
      throw new ConflictError(
        `This task waits on ${names.join(", ")}. Finish ${names.length === 1 ? "it" : "them"} first.`,
      );
    }
  }

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "ProjectTask",
      entityId: taskId,
      before: { status: task.status },
    },
    async (tx) => {
      const updated = await tx.projectTask.update({
        where: { id: taskId },
        data: { status },
        select: { id: true, status: true },
      });

      await recomputeHealth(tx, task.projectId);
      return updated;
    },
  );
}

export async function addDependency(actor: Actor, taskId: string, dependsOnId: string) {
  requirePermission(actor, "tasks.edit");

  if (taskId === dependsOnId) {
    throw new ValidationError("A task cannot depend on itself.");
  }

  const [task, dependsOn] = await Promise.all([
    db.projectTask.findUnique({ where: { id: taskId }, select: { id: true, projectId: true } }),
    db.projectTask.findUnique({ where: { id: dependsOnId }, select: { id: true, projectId: true } }),
  ]);

  if (!task || !dependsOn) throw new NotFoundError("That task does not exist.");
  if (task.projectId !== dependsOn.projectId) {
    throw new ValidationError("A dependency must be on a task in the same project.");
  }
  await visibleProject(actor, task.projectId, { id: true });

  // Cycle detection runs against the project's existing edges, before the
  // write — a cycle is a deadlock no UI can show its way out of.
  const edges = await db.projectTaskDependency.findMany({
    where: { task: { projectId: task.projectId } },
    select: { taskId: true, dependsOnId: true },
  });

  if (wouldCycle(edges, taskId, dependsOnId)) {
    throw new ConflictError("That would make the two tasks wait on each other.");
  }

  const existing = await db.projectTaskDependency.findUnique({
    where: { taskId_dependsOnId: { taskId, dependsOnId } },
    select: { taskId: true },
  });
  if (existing) throw new ConflictError("That dependency is already recorded.");

  await db.projectTaskDependency.create({ data: { taskId, dependsOnId } });
  await record({
    actor,
    action: "UPDATE",
    entityType: "ProjectTask",
    entityId: taskId,
    after: { dependsOn: dependsOnId },
  });

  return { taskId, dependsOnId };
}

export async function removeDependency(actor: Actor, taskId: string, dependsOnId: string) {
  requirePermission(actor, "tasks.edit");

  const task = await db.projectTask.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) throw new NotFoundError("That task does not exist.");
  await visibleProject(actor, task.projectId, { id: true });

  await db.projectTaskDependency.deleteMany({ where: { taskId, dependsOnId } });
  await record({
    actor,
    action: "UPDATE",
    entityType: "ProjectTask",
    entityId: taskId,
    before: { dependsOn: dependsOnId },
  });

  return { taskId, dependsOnId };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addComment(actor: Actor, input: CommentInput) {
  requirePermission(actor, "projects.view");
  await visibleProject(actor, input.projectId, { id: true });

  if (input.taskId) {
    const task = await db.projectTask.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      select: { id: true },
    });
    if (!task) throw new ValidationError("That task is not in this project.");
  }

  const comment = await db.projectComment.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId || null,
      authorId: actor.userId,
      body: input.body,
    },
    select: { id: true },
  });

  return comment;
}

export async function listComments(actor: Actor, projectId: string, taskId?: string | null) {
  requirePermission(actor, "projects.view");
  await visibleProject(actor, projectId, { id: true });

  return db.projectComment.findMany({
    where: { projectId, ...(taskId ? { taskId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export async function logTime(actor: Actor, input: TimeEntryInput) {
  requirePermission(actor, "timeentries.create");
  await visibleProject(actor, input.projectId, { id: true });

  const minutes = hoursToMinutes(input.hours);
  if (minutes <= 0) throw new ValidationError("Log some time, not none.");
  if (minutes > 24 * 60) throw new ValidationError("That is more than a day on one entry.");

  if (input.taskId) {
    const task = await db.projectTask.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      select: { id: true },
    });
    if (!task) throw new ValidationError("That task is not in this project.");
  }

  return withAudit(
    { actor, action: "CREATE", entityType: "TimeEntry", entityId: input.projectId },
    (tx) =>
      tx.timeEntry.create({
        data: {
          projectId: input.projectId,
          taskId: input.taskId || null,
          // Time is always logged against the person logging it. Recording
          // someone else's hours is a different feature with its own rules.
          userId: actor.userId,
          minutes,
          note: input.note ?? null,
          startedAt: input.startedAt,
        },
        select: { id: true, minutes: true },
      }),
  );
}

export async function projectTime(actor: Actor, projectId: string) {
  requirePermission(actor, "timeentries.view");
  await visibleProject(actor, projectId, { id: true });

  const [total, byUser, recent] = await Promise.all([
    db.timeEntry.aggregate({ where: { projectId }, _sum: { minutes: true } }),
    db.timeEntry.groupBy({
      by: ["userId"],
      where: { projectId },
      _sum: { minutes: true },
    }),
    db.timeEntry.findMany({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        minutes: true,
        note: true,
        startedAt: true,
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
      },
    }),
  ]);

  const users = await db.user.findMany({
    where: { id: { in: byUser.map((row) => row.userId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((user) => [user.id, user.name]));

  return {
    totalMinutes: total._sum.minutes ?? 0,
    byUser: byUser
      .map((row) => ({
        userId: row.userId,
        name: nameById.get(row.userId) ?? "Unknown",
        minutes: row._sum.minutes ?? 0,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    recent,
  };
}
