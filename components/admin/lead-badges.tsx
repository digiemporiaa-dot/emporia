import { Badge } from "@/components/ui";
import { bandOf } from "@/lib/crm/scoring";
import type { LeadStatus, Priority } from "@/generated/prisma/enums";

/** Shared status, priority and score presentation, so the list and the board agree. */

const STATUS_TONE: Record<LeadStatus, "neutral" | "navy" | "red" | "success" | "warning"> = {
  NEW: "navy",
  CONTACTED: "navy",
  QUALIFIED: "warning",
  PROPOSAL: "warning",
  NEGOTIATION: "warning",
  WON: "success",
  LOST: "neutral",
  NURTURE: "neutral",
};

const PRIORITY_TONE: Record<Priority, "neutral" | "warning" | "red"> = {
  LOW: "neutral",
  MEDIUM: "neutral",
  HIGH: "warning",
  URGENT: "red",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status.toLowerCase()}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "LOW" || priority === "MEDIUM") {
    return <span className="text-xs text-ink-subtle">{priority.toLowerCase()}</span>;
  }
  return <Badge tone={PRIORITY_TONE[priority]}>{priority.toLowerCase()}</Badge>;
}

/** Score with its band. Red is reserved for hot, which is the point of it. */
export function ScoreBadge({ score }: { score: number }) {
  const band = bandOf(score);
  const tone = band === "HOT" ? "text-brand-red" : band === "WARM" ? "text-warning" : "text-ink-subtle";

  return (
    <span className={`font-display text-sm tabular-nums ${tone}`}>
      {score}
      <span className="ml-1 text-2xs uppercase tracking-wide">{band}</span>
    </span>
  );
}
