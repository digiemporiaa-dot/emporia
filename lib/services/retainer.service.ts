import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { toMoneyString } from "@/lib/money";
import { nextBillingDate } from "@/lib/finance/invoice";
import { nextInvoiceNumber } from "@/lib/finance/numbering";
import { priceInvoice } from "@/lib/finance/invoice";
import { emailPaymentReminder } from "@/lib/services/alerts.service";
import type { Actor } from "@/lib/actor/types";
import type { RetainerInput } from "@/lib/validation/finance";

/**
 * Retainers: recurring work billed on a cycle.
 *
 * A retainer does not invoice by itself. `billDueRetainers` raises the invoices
 * that are due and advances each retainer's next billing date in the same
 * transaction, so a repeated run cannot bill the same period twice.
 */

export async function listRetainers(actor: Actor) {
  requirePermission(actor, "retainers.view");

  const rows = await db.retainer.findMany({
    orderBy: [{ status: "asc" }, { nextBillingAt: "asc" }],
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      cycle: true,
      status: true,
      startsAt: true,
      nextBillingAt: true,
      endsAt: true,
      client: { select: { id: true, name: true } },
      _count: { select: { invoices: true } },
    },
  });

  return rows.map((row) => ({ ...row, amount: toMoneyString(row.amount) }));
}

export async function createRetainer(actor: Actor, input: RetainerInput) {
  requirePermission(actor, "retainers.create");

  const client = await db.client.findFirst({
    where: { id: input.clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new ValidationError("That client does not exist.");

  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw new ValidationError("The end date must be after the start date.");
  }

  return withAudit(
    { actor, action: "CREATE", entityType: "Retainer", entityId: input.name },
    (tx) =>
      tx.retainer.create({
        data: {
          clientId: input.clientId,
          name: input.name,
          amount: input.amount,
          currency: input.currency,
          cycle: input.cycle,
          status: "ACTIVE",
          startsAt: input.startsAt,
          // The first bill falls on the start date itself.
          nextBillingAt: input.startsAt,
          endsAt: input.endsAt ?? null,
        },
        select: { id: true, name: true },
      }),
  );
}

export async function setRetainerStatus(
  actor: Actor,
  id: string,
  status: "ACTIVE" | "PAUSED" | "CANCELLED",
) {
  requirePermission(actor, "retainers.edit");

  const before = await db.retainer.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!before) throw new NotFoundError("That retainer does not exist.");
  if (before.status === "CANCELLED") {
    throw new ConflictError("That retainer has been cancelled.");
  }

  return withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "Retainer", entityId: id, before },
    (tx) =>
      tx.retainer.update({
        where: { id },
        data: { status },
        select: { id: true, status: true },
      }),
  );
}

/** Retainers whose next billing date has arrived. */
export async function dueRetainers(actor: Actor, now = new Date()) {
  requirePermission(actor, "retainers.view");

  const rows = await db.retainer.findMany({
    where: {
      status: "ACTIVE",
      nextBillingAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: { nextBillingAt: "asc" },
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      cycle: true,
      nextBillingAt: true,
      client: { select: { id: true, name: true } },
    },
  });

  return rows.map((row) => ({ ...row, amount: toMoneyString(row.amount) }));
}

/**
 * Raise the invoices that are due, and advance each retainer.
 *
 * Both happen in one transaction per retainer: if the invoice is written, the
 * next billing date has moved, so running this twice in a day cannot bill the
 * same period twice.
 */
export async function billDueRetainers(actor: Actor, now = new Date()) {
  requirePermission(actor, "invoices.create");

  const due = await db.retainer.findMany({
    where: {
      status: "ACTIVE",
      nextBillingAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: {
      id: true,
      clientId: true,
      name: true,
      amount: true,
      currency: true,
      cycle: true,
      nextBillingAt: true,
    },
  });

  const raised: { retainerId: string; invoiceId: string; number: string }[] = [];

  for (const retainer of due) {
    const priced = priceInvoice([
      {
        quantity: "1",
        unitPrice: toMoneyString(retainer.amount),
        discountRate: "0",
        taxRate: "0",
      },
    ]);

    const invoice = await withAudit(
      { actor, action: "CREATE", entityType: "Invoice", entityId: retainer.id },
      async (tx) => {
        const number = await nextInvoiceNumber(tx, now);
        // Payable thirty days from the billing date, the usual net-30.
        const dueAt = new Date(retainer.nextBillingAt);
        dueAt.setDate(dueAt.getDate() + 30);

        const created = await tx.invoice.create({
          data: {
            number,
            clientId: retainer.clientId,
            retainerId: retainer.id,
            status: "DRAFT",
            currency: retainer.currency,
            issuedAt: retainer.nextBillingAt,
            dueAt,
            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            taxTotal: priced.taxTotal,
            total: priced.total,
            dueTotal: priced.total,
            notes: `${retainer.name} — retainer`,
            items: {
              create: {
                name: retainer.name,
                quantity: "1",
                unitPrice: toMoneyString(retainer.amount),
                discountRate: "0",
                taxRate: "0",
                lineTotal: priced.lineTotals[0] as string,
                order: 0,
              },
            },
          },
          select: { id: true, number: true },
        });

        // Advanced in the same transaction as the invoice, so a re-run skips it.
        await tx.retainer.update({
          where: { id: retainer.id },
          data: { nextBillingAt: nextBillingDate(retainer.nextBillingAt, retainer.cycle) },
        });

        return created;
      },
    );

    raised.push({ retainerId: retainer.id, invoiceId: invoice.id, number: invoice.number });
  }

  return raised;
}

/**
 * Remind clients about invoices that are due soon or already late.
 *
 * Returns what was attempted; each send is logged by the email service, so a
 * failure is visible there rather than swallowed here.
 */
export async function sendPaymentReminders(actor: Actor, withinDays = 3, now = new Date()) {
  requirePermission(actor, "invoices.send");

  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + withinDays);

  const invoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      dueAt: { lte: horizon },
    },
    select: { id: true, number: true },
    take: 200,
  });

  for (const invoice of invoices) {
    await emailPaymentReminder(invoice.id);
  }

  return invoices.map((invoice) => invoice.number);
}
