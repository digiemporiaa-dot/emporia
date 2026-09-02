import type { LeadStatus } from "@/generated/prisma/enums";

/**
 * Pipeline stages and the transitions between them.
 *
 * The order here drives the kanban columns and the list filters, so the two
 * cannot drift apart.
 */

export const PIPELINE_STAGES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
  "NURTURE",
];

/** Columns shown on the board. WON and LOST are terminal and shown apart. */
export const BOARD_STAGES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
];

export const TERMINAL_STAGES: readonly LeadStatus[] = ["WON", "LOST", "NURTURE"];

export const STAGE_LABEL: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
  NURTURE: "Nurture",
};

/**
 * Whether a status change is allowed.
 *
 * Deliberately permissive in both directions — sales moves backwards all the
 * time, and a pipeline that refuses to record what actually happened just gets
 * worked around. The one rule is that a lead cannot move out of WON, because
 * WON creates a Client (Phase 8) and reversing it would orphan that record.
 */
export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  if (from === "WON") return false;
  return true;
}

export function transitionError(from: LeadStatus, to: LeadStatus): string | null {
  if (from === to) return "The lead is already at that stage.";
  if (from === "WON") {
    return "A won lead cannot be moved back. Reopen it as a new opportunity instead.";
  }
  if (!PIPELINE_STAGES.includes(to)) return "That is not a pipeline stage.";
  return null;
}
