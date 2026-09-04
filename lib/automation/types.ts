import type { AutomationTriggerType } from "@/generated/prisma/enums";

/**
 * The automation engine's vocabulary.
 *
 * A rule is `trigger → conditions → actions`. Facts are a flat object the
 * trigger assembles from the database; conditions read fields out of it by
 * name; actions receive the same facts plus the subject's ids.
 *
 * Everything an admin can choose is enumerated here, so the editor cannot offer
 * a trigger nothing fires or a field no fact carries.
 */

/**
 * Triggers something in the codebase actually raises.
 *
 * `TASK_OVERDUE` exists in the schema enum but nothing fires it — there is no
 * scheduler yet — so it is deliberately absent. Offering it would let someone
 * build a rule that silently never runs (CLAUDE.md 2 rule 5).
 */
export const WIRED_TRIGGERS = [
  "LEAD_CREATED",
  "LEAD_STATUS_CHANGED",
  "LEAD_ASSIGNED",
  "PROPOSAL_SENT",
  "PROPOSAL_ACCEPTED",
  "PROPOSAL_REJECTED",
  "INVOICE_SENT",
  "INVOICE_OVERDUE",
  "PAYMENT_RECEIVED",
  "PROJECT_CREATED",
] as const satisfies readonly AutomationTriggerType[];

export type WiredTrigger = (typeof WIRED_TRIGGERS)[number];

export const TRIGGER_LABEL: Record<WiredTrigger, string> = {
  LEAD_CREATED: "A lead is captured",
  LEAD_STATUS_CHANGED: "A lead's status changes",
  LEAD_ASSIGNED: "A lead is assigned",
  PROPOSAL_SENT: "A proposal is sent",
  PROPOSAL_ACCEPTED: "A proposal is accepted",
  PROPOSAL_REJECTED: "A proposal is rejected",
  INVOICE_SENT: "An invoice is sent",
  INVOICE_OVERDUE: "An invoice goes overdue",
  PAYMENT_RECEIVED: "A payment is received",
  PROJECT_CREATED: "A project is created",
};

/** What a rule is running about. Ids are the handles actions act through. */
export type Subject = {
  leadId?: string | null;
  clientId?: string | null;
  proposalId?: string | null;
  invoiceId?: string | null;
  projectId?: string | null;
  paymentId?: string | null;
  /** Whoever caused the trigger, for the audit trail. Null for the system. */
  actorUserId?: string | null;
};

/** A flat bag of comparable values. Money arrives as a fixed-precision string. */
export type Facts = Record<string, string | number | boolean | null>;

export type FactField = {
  key: string;
  label: string;
  kind: "string" | "number" | "money" | "boolean";
};

/**
 * The fields each trigger guarantees.
 *
 * The editor builds its condition dropdown from this, so a condition can only
 * be written against a fact that will actually be present.
 */
export const TRIGGER_FACTS: Record<WiredTrigger, readonly FactField[]> = {
  LEAD_CREATED: leadFacts(),
  LEAD_STATUS_CHANGED: [
    ...leadFacts(),
    { key: "lead.previousStatus", label: "Previous status", kind: "string" },
  ],
  LEAD_ASSIGNED: [...leadFacts(), { key: "lead.assigneeName", label: "Assignee", kind: "string" }],
  PROPOSAL_SENT: proposalFacts(),
  PROPOSAL_ACCEPTED: proposalFacts(),
  PROPOSAL_REJECTED: proposalFacts(),
  INVOICE_SENT: invoiceFacts(),
  INVOICE_OVERDUE: [
    ...invoiceFacts(),
    { key: "invoice.daysOverdue", label: "Days overdue", kind: "number" },
  ],
  PAYMENT_RECEIVED: [
    ...invoiceFacts(),
    { key: "payment.amount", label: "Payment amount", kind: "money" },
    { key: "payment.gateway", label: "Payment method", kind: "string" },
  ],
  PROJECT_CREATED: [
    { key: "project.name", label: "Project name", kind: "string" },
    { key: "project.status", label: "Project status", kind: "string" },
    { key: "project.budget", label: "Project budget", kind: "money" },
    { key: "client.name", label: "Client name", kind: "string" },
  ],
};

function leadFacts(): FactField[] {
  return [
    { key: "lead.status", label: "Lead status", kind: "string" },
    { key: "lead.priority", label: "Priority", kind: "string" },
    { key: "lead.score", label: "Score", kind: "number" },
    { key: "lead.budget", label: "Stated budget", kind: "money" },
    { key: "lead.sourceSlug", label: "Source", kind: "string" },
    { key: "lead.serviceSlug", label: "Service", kind: "string" },
    { key: "lead.citySlug", label: "City", kind: "string" },
    { key: "lead.campaignName", label: "Campaign", kind: "string" },
    { key: "lead.company", label: "Company", kind: "string" },
    { key: "lead.email", label: "Email", kind: "string" },
    { key: "lead.assigned", label: "Already assigned", kind: "boolean" },
  ];
}

function proposalFacts(): FactField[] {
  return [
    { key: "proposal.total", label: "Proposal total", kind: "money" },
    { key: "proposal.currency", label: "Currency", kind: "string" },
    { key: "proposal.title", label: "Proposal title", kind: "string" },
    { key: "client.name", label: "Client name", kind: "string" },
    { key: "lead.sourceSlug", label: "Originating source", kind: "string" },
  ];
}

function invoiceFacts(): FactField[] {
  return [
    { key: "invoice.total", label: "Invoice total", kind: "money" },
    { key: "invoice.dueTotal", label: "Outstanding", kind: "money" },
    { key: "invoice.status", label: "Invoice status", kind: "string" },
    { key: "invoice.currency", label: "Currency", kind: "string" },
    { key: "client.name", label: "Client name", kind: "string" },
  ];
}
