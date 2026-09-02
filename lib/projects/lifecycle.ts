import type {
  ContentStage,
  MilestoneStatus,
  ProjectStatus,
  TaskStatus,
} from "@/generated/prisma/enums";

/**
 * Delivery lifecycles: projects, tasks, milestones and content.
 *
 * Each is a single transition map so the board columns, the filters and the
 * service-layer guard cannot drift apart.
 */

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * A completed or cancelled project can be reopened to ACTIVE — work does come
 * back — but it cannot jump straight from COMPLETED to CANCELLED, which would
 * rewrite what happened rather than record it.
 */
const PROJECT_ALLOWED: Record<ProjectStatus, readonly ProjectStatus[]> = {
  PLANNING: ["ACTIVE", "ON_HOLD", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: ["ACTIVE"],
  CANCELLED: ["ACTIVE"],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_ALLOWED[from].includes(to);
}

export function projectTransitionError(from: ProjectStatus, to: ProjectStatus): string | null {
  if (from === to) return "The project is already at that status.";
  if (!canTransitionProject(from, to)) {
    return `A ${PROJECT_STATUS_LABEL[from].toLowerCase()} project cannot move straight to ${PROJECT_STATUS_LABEL[to].toLowerCase()}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_STATUSES: readonly TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "IN_REVIEW",
  "DONE",
  "CANCELLED",
];

/** Columns on the board. CANCELLED is filtered out rather than shown. */
export const TASK_BOARD_STATUSES: readonly TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "IN_REVIEW",
  "DONE",
];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  IN_REVIEW: "In review",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

/**
 * Tasks move freely except out of CANCELLED, which is reopened by moving it
 * back to TODO explicitly. Delivery work genuinely bounces between states and
 * a board that refuses to record that just gets worked around.
 */
const TASK_ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"],
  IN_PROGRESS: ["TODO", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"],
  BLOCKED: ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"],
  IN_REVIEW: ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"],
  DONE: ["TODO", "IN_PROGRESS", "IN_REVIEW", "CANCELLED"],
  CANCELLED: ["TODO"],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_ALLOWED[from].includes(to);
}

/** Statuses that count as work finished, for progress and health. */
export function isTaskClosed(status: TaskStatus): boolean {
  return status === "DONE" || status === "CANCELLED";
}

/** Statuses that mean the task is genuinely started, for dependency checks. */
export function isTaskStarted(status: TaskStatus): boolean {
  return status !== "TODO" && status !== "CANCELLED";
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type DependencyEdge = { taskId: string; dependsOnId: string };

/**
 * Whether adding `taskId → dependsOnId` would create a cycle.
 *
 * A cycle is a deadlock the UI cannot show its way out of: every task in the
 * loop waits for another, so nothing is ever startable. Checked before the
 * write, not after (CLAUDE.md 4).
 */
export function wouldCycle(
  edges: readonly DependencyEdge[],
  taskId: string,
  dependsOnId: string,
): boolean {
  if (taskId === dependsOnId) return true;

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.taskId);
    if (list) list.push(edge.dependsOnId);
    else outgoing.set(edge.taskId, [edge.dependsOnId]);
  }

  // Walk what dependsOnId itself waits for. Reaching taskId closes a loop.
  const seen = new Set<string>();
  const stack = [dependsOnId];

  while (stack.length) {
    const current = stack.pop() as string;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of outgoing.get(current) ?? []) stack.push(next);
  }

  return false;
}

/** The unfinished prerequisites of a task, by id. */
export function blockingDependencies(
  dependencies: readonly { dependsOnId: string; status: TaskStatus }[],
): string[] {
  return dependencies.filter((d) => !isTaskClosed(d.status)).map((d) => d.dependsOnId);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const CONTENT_STAGES: readonly ContentStage[] = [
  "IDEA",
  "DRAFT",
  "INTERNAL_REVIEW",
  "CLIENT_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
];

export const CONTENT_STAGE_LABEL: Record<ContentStage, string> = {
  IDEA: "Idea",
  DRAFT: "Draft",
  INTERNAL_REVIEW: "Internal review",
  CLIENT_REVIEW: "Client review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
};

/**
 * The content workflow is a pipeline, not a free-for-all: a post cannot be
 * scheduled before it is approved, and cannot be marked published without
 * having been scheduled. Sending work back for changes is always allowed,
 * because that is what review is for.
 */
const CONTENT_ALLOWED: Record<ContentStage, readonly ContentStage[]> = {
  IDEA: ["DRAFT"],
  DRAFT: ["IDEA", "INTERNAL_REVIEW"],
  INTERNAL_REVIEW: ["DRAFT", "CLIENT_REVIEW", "APPROVED"],
  CLIENT_REVIEW: ["DRAFT", "INTERNAL_REVIEW", "APPROVED"],
  APPROVED: ["SCHEDULED", "INTERNAL_REVIEW"],
  SCHEDULED: ["PUBLISHED", "APPROVED"],
  PUBLISHED: [],
};

export function canTransitionContent(from: ContentStage, to: ContentStage): boolean {
  return CONTENT_ALLOWED[from].includes(to);
}

export function contentTransitionError(from: ContentStage, to: ContentStage): string | null {
  if (from === to) return "That item is already at this stage.";
  if (from === "PUBLISHED") {
    return "Published content cannot move back. Create a new item instead.";
  }
  if (!canTransitionContent(from, to)) {
    return `Content at ${CONTENT_STAGE_LABEL[from].toLowerCase()} cannot move straight to ${CONTENT_STAGE_LABEL[to].toLowerCase()}.`;
  }
  return null;
}

/** Stages at which a schedule date is required to be meaningful. */
export function requiresSchedule(stage: ContentStage): boolean {
  return stage === "SCHEDULED" || stage === "PUBLISHED";
}

export const CONTENT_CHANNEL_LABEL = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  BLOG: "Blog",
  YOUTUBE: "YouTube",
  EMAIL: "Email",
  ADS: "Ads",
} as const;
