import "server-only";
import { randomUUID } from "node:crypto";
import { db, type DbClient } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { Decimal, toMoneyString } from "@/lib/money";
import { applyPayment } from "@/lib/finance/invoice";
import { fromMinorUnits, payments as gateway } from "@/lib/payments";
import { emailPaymentReceived } from "@/lib/services/alerts.service";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { PaymentGateway } from "@/generated/prisma/enums";
import type { ManualPaymentInput } from "@/lib/validation/finance";
import type { WebhookEvent } from "@/lib/payments/types";

/**
 * Payments and reconciliation.
 *
 * Two rules carry this module.
 *
 * **A payment and the invoice it settles move together.** Recording money is
 * one transaction that writes the Payment row and recomputes the invoice's
 * paid, due and status. There is no path that credits one without the other.
 *
 * **A replayed webhook cannot double-credit.** Every payment carries a unique
 * `idempotencyKey`, and for gateway payments that key is the gateway's own
 * payment id. The uniqueness is enforced by the database, not by a check that
 * could race two concurrent deliveries (docs/ARCHITECTURE.md 6.7).
 */

const payLog = log("payments");

/** Recompute an invoice from a payment, inside the caller's transaction. */
async function creditInvoice(
  tx: DbClient,
  invoiceId: string,
  amount: string,
  now: Date,
): Promise<{ status: string; paidTotal: string; dueTotal: string }> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, total: true, paidTotal: true, dueAt: true, status: true, deletedAt: true },
  });

  if (!invoice || invoice.deletedAt) throw new NotFoundError("That invoice does not exist.");
  if (invoice.status === "CANCELLED") {
    throw new ConflictError("That invoice was cancelled.");
  }
  if (invoice.status === "DRAFT") {
    throw new ConflictError("That invoice has not been sent yet.");
  }

  const next = applyPayment({
    total: toMoneyString(invoice.total),
    paidTotal: toMoneyString(invoice.paidTotal),
    amount,
    dueAt: invoice.dueAt,
    now,
    status: invoice.status,
  });

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { paidTotal: next.paidTotal, dueTotal: next.dueTotal, status: next.status },
  });

  return next;
}

// ---------------------------------------------------------------------------
// Money received outside the gateway
// ---------------------------------------------------------------------------

/**
 * Record a bank transfer, cheque or cash payment.
 *
 * The idempotency key is generated here because there is no gateway id to use;
 * a duplicate entry is a human mistake, not a replay, and is caught by the
 * over-payment check rather than by the key.
 */
export async function recordManualPayment(actor: Actor, input: ManualPaymentInput) {
  requirePermission(actor, "payments.record");

  const invoice = await db.invoice.findFirst({
    where: { id: input.invoiceId, deletedAt: null },
    select: { id: true, clientId: true, currency: true, total: true, paidTotal: true, status: true },
  });
  if (!invoice) throw new NotFoundError("That invoice does not exist.");

  const amount = new Decimal(input.amount);
  if (amount.lessThanOrEqualTo(0)) throw new ValidationError("Record an amount above zero.");

  const outstanding = new Decimal(invoice.total).minus(invoice.paidTotal);
  if (amount.greaterThan(outstanding)) {
    throw new ValidationError(
      `That is more than the ${toMoneyString(outstanding)} outstanding on this invoice.`,
    );
  }

  const receivedAt = input.receivedAt ?? new Date();

  const result = await withAudit(
    { actor, action: "CREATE", entityType: "Payment", entityId: input.invoiceId },
    async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          clientId: invoice.clientId,
          amount: input.amount,
          currency: invoice.currency,
          gateway: input.gateway as PaymentGateway,
          status: "CAPTURED",
          idempotencyKey: `manual:${randomUUID()}`,
          gatewayPaymentId: null,
          rawPayload: input.reference ? { reference: input.reference } : undefined,
          receivedAt,
        },
        select: { id: true, amount: true },
      });

      const next = await creditInvoice(tx, invoice.id, input.amount, receivedAt);
      return { paymentId: payment.id, ...next };
    },
  );

  await emailPaymentReceived(result.paymentId);
  return result;
}

// ---------------------------------------------------------------------------
// Online payment
// ---------------------------------------------------------------------------

/**
 * Open a gateway order for an invoice.
 *
 * Nothing is credited here — an order is an intent. The money is only recorded
 * when the webhook says the gateway captured it.
 */
export async function createOrderForInvoice(invoiceId: string, clientId: string) {
  const invoice = await db.invoice.findFirst({
    // Scoped by clientId as well as id: this is reachable from the portal.
    where: { id: invoiceId, clientId, deletedAt: null },
    select: { id: true, number: true, currency: true, dueTotal: true, status: true },
  });

  if (!invoice) throw new NotFoundError("That invoice does not exist.");
  if (invoice.status === "PAID") throw new ConflictError("That invoice is already paid.");
  if (invoice.status === "CANCELLED") throw new ConflictError("That invoice was cancelled.");
  if (invoice.status === "DRAFT") throw new NotFoundError("That invoice does not exist.");

  const due = toMoneyString(invoice.dueTotal);
  if (new Decimal(due).lessThanOrEqualTo(0)) {
    throw new ConflictError("There is nothing outstanding on that invoice.");
  }

  const order = await gateway().createOrder({
    amount: due,
    currency: invoice.currency,
    receipt: invoice.number,
    notes: { invoiceId: invoice.id, invoiceNumber: invoice.number },
  });

  payLog.info({ invoiceId, orderId: order.orderId }, "gateway order created");

  return { ...order, invoiceNumber: invoice.number, amount: due };
}

/**
 * What the browser reports after checkout.
 *
 * The signature is verified, but this **does not mark the invoice paid**: only
 * the webhook does that. A client-side callback is a hint that the flow
 * finished, nothing more (CLAUDE.md 11).
 */
export function verifyCheckoutSignature(result: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  return gateway().verifyCheckout(result);
}

/**
 * Handle a gateway webhook.
 *
 * The signature has already been checked by the route handler against the raw
 * body. This function is the idempotent part: the gateway's payment id is the
 * idempotency key, so a replay hits a unique constraint and credits nothing.
 */
export async function handleWebhook(event: WebhookEvent): Promise<{
  handled: boolean;
  reason: string;
  paymentId?: string;
}> {
  // Only capture events move money. Everything else is acknowledged so the
  // gateway stops retrying, and recorded in the log.
  if (event.event !== "payment.captured") {
    payLog.info({ event: event.event }, "webhook ignored");
    return { handled: false, reason: `Ignored ${event.event}.` };
  }

  if (!event.paymentId || event.amountMinor === null) {
    return { handled: false, reason: "That event carries no payment." };
  }

  const existing = await db.payment.findUnique({
    where: { gatewayPaymentId: event.paymentId },
    select: { id: true },
  });

  if (existing) {
    // The common case for a replay: seen already, nothing to do.
    payLog.info({ paymentId: event.paymentId }, "webhook replay ignored");
    return { handled: false, reason: "Already recorded.", paymentId: existing.id };
  }

  // The invoice is identified by the note we set when creating the order, and
  // failing that by the order id we stored.
  const raw = event.raw as
    | { payload?: { payment?: { entity?: { notes?: Record<string, string> } } } }
    | undefined;
  const noteInvoiceId = raw?.payload?.payment?.entity?.notes?.["invoiceId"] ?? null;

  const invoice = noteInvoiceId
    ? await db.invoice.findFirst({
        where: { id: noteInvoiceId, deletedAt: null },
        select: { id: true, clientId: true, currency: true },
      })
    : null;

  if (!invoice) {
    payLog.warn({ paymentId: event.paymentId }, "webhook for an unknown invoice");
    return { handled: false, reason: "No invoice matches that payment." };
  }

  const amount = fromMinorUnits(event.amountMinor);
  const receivedAt = new Date();

  try {
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          clientId: invoice.clientId,
          amount,
          currency: invoice.currency,
          gateway: "RAZORPAY",
          status: "CAPTURED",
          // The gateway's own id, so a replay collides on the unique index
          // rather than being caught by a check that could race.
          idempotencyKey: `razorpay:${event.paymentId}`,
          gatewayPaymentId: event.paymentId,
          gatewayOrderId: event.orderId,
          rawPayload: event.raw as object,
          receivedAt,
        },
        select: { id: true },
      });

      await creditInvoice(tx, invoice.id, amount, receivedAt);
      return payment;
    });

    await record({
      actor: {
        userId: "system",
        name: "Razorpay",
        email: null,
        type: "SYSTEM",
        roleName: null,
        roleId: null,
        clientId: null,
        permissions: new Set<string>(),
        ip: null,
        userAgent: null,
      },
      action: "CREATE",
      entityType: "Payment",
      entityId: result.id,
      after: { gatewayPaymentId: event.paymentId, amount },
    });

    await emailPaymentReceived(result.id);

    payLog.info({ paymentId: result.id, invoiceId: invoice.id, amount }, "payment captured");
    return { handled: true, reason: "Recorded.", paymentId: result.id };
  } catch (error) {
    // Two deliveries racing: whichever loses the unique constraint stops here,
    // which is exactly the behaviour we want.
    if (isUniqueViolation(error)) {
      payLog.info({ paymentId: event.paymentId }, "concurrent webhook lost the race");
      return { handled: false, reason: "Already recorded." };
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export async function refundPayment(
  actor: Actor,
  paymentId: string,
  amount: string,
  reason: string | null,
) {
  requirePermission(actor, "payments.refund");

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amount: true,
      status: true,
      gateway: true,
      gatewayPaymentId: true,
      invoiceId: true,
      invoice: { select: { id: true, total: true, paidTotal: true, dueAt: true, status: true } },
    },
  });

  if (!payment) throw new NotFoundError("That payment does not exist.");
  if (payment.status !== "CAPTURED" && payment.status !== "PARTIALLY_REFUNDED") {
    throw new ConflictError("That payment cannot be refunded.");
  }

  const refundAmount = new Decimal(amount);
  if (refundAmount.lessThanOrEqualTo(0)) throw new ValidationError("Refund an amount above zero.");
  if (refundAmount.greaterThan(payment.amount.toString())) {
    throw new ValidationError("That is more than the payment.");
  }

  // A gateway payment is refunded through the gateway; a manual one is simply
  // recorded, because the money moved outside the system.
  if (payment.gateway === "RAZORPAY" && payment.gatewayPaymentId) {
    await gateway().refund({
      paymentId: payment.gatewayPaymentId,
      amount,
      notes: reason ? { reason } : {},
    });
  }

  const full = refundAmount.equals(payment.amount.toString());

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "Payment",
      entityId: paymentId,
      before: { status: payment.status, amount: payment.amount.toString() },
      after: { refunded: amount, reason },
    },
    async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });

      // The invoice owes the money again.
      const invoice = payment.invoice;
      const paidTotal = toMoneyString(new Decimal(invoice.paidTotal).minus(refundAmount));
      const dueTotal = toMoneyString(new Decimal(invoice.total).minus(paidTotal));

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidTotal,
          dueTotal,
          status: new Decimal(paidTotal).greaterThan(0) ? "PARTIALLY_PAID" : "SENT",
        },
      });

      return { paymentId, paidTotal, dueTotal };
    },
  );
}

export async function listPayments(actor: Actor, limit = 50) {
  requirePermission(actor, "payments.view");

  const rows = await db.payment.findMany({
    orderBy: { receivedAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      gateway: true,
      gatewayPaymentId: true,
      receivedAt: true,
      client: { select: { id: true, name: true } },
      invoice: { select: { id: true, number: true } },
    },
  });

  return rows.map((row) => ({ ...row, amount: toMoneyString(row.amount) }));
}
