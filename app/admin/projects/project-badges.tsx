import { Badge } from "@/components/ui";
import { HEALTH_LABEL } from "@/lib/projects/health";
import { PROJECT_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/projects/lifecycle";
import type { ProjectHealth, ProjectStatus, TaskStatus, Priority } from "@/generated/prisma/enums";

/** Shared badges, so a status never gets a different colour on another page. */

const PROJECT_TONE: Record<ProjectStatus, "neutral" | "navy" | "warning" | "success" | "red"> = {
  PLANNING: "neutral",
  ACTIVE: "navy",
  ON_HOLD: "warning",
  COMPLETED: "success",
  CANCELLED: "red",
};

const HEALTH_TONE: Record<ProjectHealth, "success" | "warning" | "red"> = {
  ON_TRACK: "success",
  AT_RISK: "warning",
  DELAYED: "red",
};

const TASK_TONE: Record<TaskStatus, "neutral" | "navy" | "warning" | "success" | "red"> = {
  TODO: "neutral",
  IN_PROGRESS: "navy",
  BLOCKED: "red",
  IN_REVIEW: "warning",
  DONE: "success",
  CANCELLED: "neutral",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={PROJECT_TONE[status]}>{PROJECT_STATUS_LABEL[status]}</Badge>;
}

export function HealthBadge({ health }: { health: ProjectHealth }) {
  return <Badge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={TASK_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>;
}

export function TaskPriority({ priority }: { priority: Priority }) {
  if (priority === "LOW" || priority === "MEDIUM") {
    return <span className="text-2xs uppercase tracking-wide text-ink-subtle">{priority.toLowerCase()}</span>;
  }
  return (
    <span className="text-2xs font-semibold uppercase tracking-wide text-brand-red-text">
      {priority.toLowerCase()}
    </span>
  );
}
