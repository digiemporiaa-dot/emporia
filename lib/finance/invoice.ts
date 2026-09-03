import { Decimal, amountDue, gte, priceDocument, toMoneyString } from "@/lib/money";
import type { BillingCycle, InvoiceStatus } from "@/generated/prisma/enums";

/**
 * Invoice arithmetic and lifecycle.
 *
 * Every figure here is Decimal. The same `documentTotals` that prices a
 * proposal prices an invoice, so a quote and the bill for it cannot disagree
 * about how discount and tax compose (CLAUDE.md 2 rule 1).
 */

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

/** Only a draft may have its figures edited; a sent invoice is a document. */
export function isEditable(status: InvoiceStatus): boolean {
  return status === "DRAFT";
}

/** Statuses where money is still expected. */
export function isOutstanding(status: InvoiceStatus): boolean {
  return status === "SENT" || status === "PARTIALLY_PAID" || status === "OVERDUE";
}

const ALLOWED: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  // Paid and overdue are reached by recording a payment or by time passing,
  // not by choosing them.
  SENT: ["CANCELLED"],
  PARTIALLY_PAID: ["CANCELLED"],
  OVERDUE: ["CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function transitionError(from: InvoiceStatus, to: InvoiceStatus): string | null {
  if (from === to) return "The invoice is already at that status.";
  if (from === "PAID") return "A paid invoice cannot be changed. Refund it instead.";
  if (from === "CANCELLED") return "A cancelled invoice cannot be changed.";
  if (!canTransition(from, to)) {
    return `A ${INVOICE_STATUS_LABEL[from].toLowerCase()} invoice cannot be moved to ${INVOICE_STATUS_LABEL[to].toLowerCase()}.`;
  }
  return null;
}

export type InvoiceLine = {
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
};

export type InvoiceTotals = {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  lineTotals: string[];
};

/** Price the lines. Discount applies to the gross, tax to the discounted net. */
export function priceInvoice(lines: readonly InvoiceLine[]): InvoiceTotals {
  const priced = priceDocument(lines);

  return { ...priced.totals, lineTotals: priced.lineTotals };
}

/**
 * What a payment does to an invoice.
 *
 * Paid and due are stored on the row rather than aggregated on read, so an
 * "overdue" query is an indexed scan. This is the one function that decides
 * what those columns become, so the two can never drift.
 */
export function applyPayment(input: {
  total: string;
  paidTotal: string;
  amount: string;
  dueAt: Date;
  now?: Date;
  status: InvoiceStatus;
}): { paidTotal: string; dueTotal: string; status: InvoiceStatus } {
  const now = input.now ?? new Date();

  const paid = new Decimal(input.paidTotal).plus(input.amount);
  const paidTotal = toMoneyString(paid);
  const dueTotal = toMoneyString(amountDue(input.total, paid));

  // Settled when what has been paid reaches the total — greater than, too,
  // because an overpayment is still settled and shows a zero balance.
  if (gte(paid, input.total)) {
    return { paidTotal, dueTotal, status: "PAID" };
  }

  if (paid.greaterThan(0)) {
    return { paidTotal, dueTotal, status: "PARTIALLY_PAID" };
  }

  // Nothing paid: the status is whatever the clock says.
  return {
    paidTotal,
    dueTotal,
    status: input.dueAt < now && input.status !== "DRAFT" ? "OVERDUE" : input.status,
  };
}

/** Whether an outstanding invoice has slipped past its due date. */
export function isOverdue(invoice: { status: InvoiceStatus; dueAt: Date }, now = new Date()): boolean {
  return isOutstanding(invoice.status) && invoice.dueAt < now;
}

/** When a retainer on this cycle should next be billed. */
export function nextBillingDate(from: Date, cycle: BillingCycle): Date {
  const next = new Date(from);

  switch (cycle) {
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      break;
    case "QUARTERLY":
      next.setMonth(next.getMonth() + 3);
      break;
    case "HALF_YEARLY":
      next.setMonth(next.getMonth() + 6);
      break;
    case "ANNUAL":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }

  return next;
}

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Every six months",
  ANNUAL: "Annually",
};
