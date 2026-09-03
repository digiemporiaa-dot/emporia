import { Badge } from "@/components/ui";
import { INVOICE_STATUS_LABEL } from "@/lib/finance/invoice";
import type { InvoiceStatus, PaymentGateway, PaymentStatus } from "@/generated/prisma/enums";

/**
 * Status badges for finance.
 *
 * One tone map, so an overdue invoice is the same red everywhere it appears.
 * The labels come from `lib/finance/invoice` rather than being repeated here.
 */

type Tone = "neutral" | "navy" | "red" | "success" | "warning";

const INVOICE_TONE: Record<InvoiceStatus, Tone> = {
  DRAFT: "neutral",
  SENT: "navy",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "red",
  CANCELLED: "neutral",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pending",
  CAPTURED: "Received",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Part refunded",
};

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  PENDING: "warning",
  CAPTURED: "success",
  FAILED: "red",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={INVOICE_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONE[status]}>{PAYMENT_STATUS_LABEL[status]}</Badge>;
}

export const GATEWAY_LABEL: Record<PaymentGateway, string> = {
  RAZORPAY: "Razorpay",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  UPI: "UPI",
  OTHER: "Other",
};
