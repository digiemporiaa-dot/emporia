import type { MilestoneStatus, TaskStatus } from "@/generated/prisma/enums";
import type { ProjectHealth } from "@/generated/prisma/enums";
import { isTaskClosed } from "@/lib/projects/lifecycle";

/**
 * Project health, derived from what the project actually contains.
 *
 * Health is stored on the project so that history and filtering are cheap, but
 * it is never typed in by hand: a manager marking a late project "on track"
 * would make the field worthless. It is recomputed whenever a task, milestone
 * or project date changes.
 *
 * The rules, in order of severity:
 *   DELAYED  — the project is past its due date and not finished, or a
 *              milestone is past due and not completed
 *   AT_RISK  — an open task is past its due date, or more than half the
 *              remaining time is gone with less than half the work closed
 *   ON_TRACK — everything else
 */

export type HealthInput = {
  now: Date;
  startsAt: Date;
  dueAt: Date | null;
  completedAt: Date | null;
  tasks: readonly { status: TaskStatus; dueAt: Date | null }[];
  milestones: readonly { status: MilestoneStatus; dueAt: Date }[];
};

export type HealthResult = {
  health: ProjectHealth;
  /** Why, in words, for the UI — never invented, always from the same inputs. */
  reason: string;
  openTasks: number;
  closedTasks: number;
  overdueTasks: number;
  overdueMilestones: number;
  /** 0–100, closed tasks as a share of all tasks. Null when there are none. */
  progress: number | null;
};

export function deriveHealth(input: HealthInput): HealthResult {
  const { now, startsAt, dueAt, completedAt, tasks, milestones } = input;

  const closedTasks = tasks.filter((task) => isTaskClosed(task.status)).length;
  const openTasks = tasks.length - closedTasks;
  const overdueTasks = tasks.filter(
    (task) => !isTaskClosed(task.status) && task.dueAt !== null && task.dueAt < now,
  ).length;
  const overdueMilestones = milestones.filter(
    (milestone) => milestone.status !== "COMPLETED" && milestone.dueAt < now,
  ).length;

  const progress = tasks.length === 0 ? null : Math.round((closedTasks / tasks.length) * 100);

  const base = {
    openTasks,
    closedTasks,
    overdueTasks,
    overdueMilestones,
    progress,
  };

  // A finished project is not late, whatever its dates say.
  if (completedAt) {
    return { ...base, health: "ON_TRACK", reason: "Completed." };
  }

  if (dueAt && dueAt < now) {
    return { ...base, health: "DELAYED", reason: "Past its due date and not complete." };
  }

  if (overdueMilestones > 0) {
    return {
      ...base,
      health: "DELAYED",
      reason:
        overdueMilestones === 1
          ? "A milestone is past its due date."
          : `${overdueMilestones} milestones are past their due dates.`,
    };
  }

  if (overdueTasks > 0) {
    return {
      ...base,
      health: "AT_RISK",
      reason:
        overdueTasks === 1 ? "A task is past its due date." : `${overdueTasks} tasks are overdue.`,
    };
  }

  // Burn-down check: past the halfway point in time with under half the work
  // closed. Only meaningful once there is a due date and some tasks.
  if (dueAt && tasks.length > 0) {
    const span = dueAt.getTime() - startsAt.getTime();
    if (span > 0) {
      const elapsed = (now.getTime() - startsAt.getTime()) / span;
      const done = closedTasks / tasks.length;
      if (elapsed > 0.5 && done < elapsed - 0.2) {
        return {
          ...base,
          health: "AT_RISK",
          reason: `${Math.round(elapsed * 100)}% of the time is gone with ${progress ?? 0}% of the tasks closed.`,
        };
      }
    }
  }

  return { ...base, health: "ON_TRACK", reason: "No overdue work." };
}

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  DELAYED: "Delayed",
};
