import type { ProposalStatus } from "@/generated/prisma/enums";

/**
 * Proposal lifecycle.
 *
 * DRAFT → SENT → VIEWED → NEGOTIATION → ACCEPTED / REJECTED
 *
 * The rules that matter:
 *   - a sent proposal is immutable in its priced lines; changing the numbers
 *     means a new revision, not an edit of what the client already has
 *   - ACCEPTED and REJECTED are terminal, because accepting creates a Client
 *     and a contract, and quietly un-accepting would orphan them
 *   - VIEWED is recorded by the client opening it, never set by staff
 */

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "NEGOTIATION",
  "ACCEPTED",
  "REJECTED",
];

export const TERMINAL_STATUSES: readonly ProposalStatus[] = ["ACCEPTED", "REJECTED"];

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  NEGOTIATION: "In negotiation",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

const ALLOWED: Record<ProposalStatus, readonly ProposalStatus[]> = {
  DRAFT: ["SENT"],
  // A sent proposal can be viewed, negotiated, decided, or pulled back to
  // draft to be revised — the revision is what the client sees next.
  SENT: ["VIEWED", "NEGOTIATION", "ACCEPTED", "REJECTED", "DRAFT"],
  VIEWED: ["NEGOTIATION", "ACCEPTED", "REJECTED", "DRAFT"],
  NEGOTIATION: ["ACCEPTED", "REJECTED", "DRAFT"],
  ACCEPTED: [],
  REJECTED: [],
};

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function transitionError(from: ProposalStatus, to: ProposalStatus): string | null {
  if (from === to) return "The proposal is already at that status.";
  if (TERMINAL_STATUSES.includes(from)) {
    return `A ${from.toLowerCase()} proposal cannot be changed. Create a new proposal instead.`;
  }
  if (!canTransition(from, to)) {
    return `A ${from.toLowerCase()} proposal cannot move straight to ${to.toLowerCase()}.`;
  }
  return null;
}

/** Whether the priced lines may still be edited in place. */
export function isEditable(status: ProposalStatus): boolean {
  return status === "DRAFT";
}

/** Whether this status means the client has the document. */
export function isWithClient(status: ProposalStatus): boolean {
  return status === "SENT" || status === "VIEWED" || status === "NEGOTIATION";
}
