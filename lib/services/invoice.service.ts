import "server-only";
import { db, type DbClient } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { gt, toMoneyString } from "@/lib/money";
import { nextInvoiceNumber } from "@/lib/finance/numbering";
import { isEditable, isOutstanding, priceInvoice, transitionError } from "@/lib/finance/invoice";
import { emailInvoice } from "@/lib/services/alerts.service";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";
import type {
  InvoiceInput,
  InvoiceItemInput,
  InvoiceListParamsInput,
} from "@/lib/validation/finance";

/**
 * Invoicing.
 *
 * Figures are computed once, at write time, by the same pricing a proposal uses
 * (lib/money), and stored. Nothing recomputes a total on read: a bill the
 * client has already been sent must not move because the tax logic was edited
 * afterwards (CLAUDE.md 2 rule 1).
 *
 * `paidTotal` and `dueTotal` are maintained by the payment service inside the
 * same transaction as every payment, so "what is outstanding" is an indexed
 * column rather than an aggregate over Payment.
 */

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function writeItems(
  tx: DbClient,
  invoiceId: string,
  items: readonly InvoiceItemInput[],
): Promise<{ subtotal: string; discountTotal: string; taxTotal: string; total: string }> {
  const priced = priceInvoice(
    items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountRate: item.discountRate,
      taxRate: item.taxRate,
    })),
  );

  await tx.invoiceItem.deleteMany({ where: { invoiceId } });
  await tx.invoiceItem.createMany({
    data: items.map((item, index) => ({
      invoiceId,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountRate: item.discountRate,
      taxRate: item.taxRate,
      // Stored, not derived on read.
      lineTotal: priced.lineTotals[index] as string,
      order: index,
    })),
  });

  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { paidTotal: true },
  });

  const dueTotal = toMoneyString(
    Math.max(0, Number(priced.total) - Number(invoice.paidTotal)).toFixed(2),
  );

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotal: priced.subtotal,
      discountTotal: priced.discountTotal,
      taxTotal: priced.taxTotal,
      total: priced.total,
      dueTotal,
    },
  });

  return {
    subtotal: priced.subtotal,
    discountTotal: priced.discountTotal,
    taxTotal: priced.taxTotal,
    total: priced.total,
  };
}

export async function createInvoice(actor: Actor, input: InvoiceInput) {
  requirePermission(actor, "invoices.create");

  const client = await db.client.findFirst({
    where: { id: input.clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new ValidationError("That client does not exist.");

  return withAudit(
    { actor, action: "CREATE", entityType: "Invoice", entityId: input.clientId },
    async (tx) => {
      const number = await nextInvoiceNumber(tx);

      const invoice = await tx.invoice.create({
        data: {
          number,
          clientId: input.clientId,
          projectId: input.projectId || null,
          contractId: input.contractId || null,
          retainerId: input.retainerId || null,
          status: "DRAFT",
          currency: input.currency,
          issuedAt: input.issuedAt ?? new Date(),
          dueAt: input.dueAt,
          notes: input.notes ?? null,
        },
        select: { id: true, number: true },
      });

      await writeItems(tx, invoice.id, input.items);
      return invoice;
    },
  );
}

export async function updateInvoice(actor: Actor, id: string, input: InvoiceInput) {
  requirePermission(actor, "invoices.edit");

  const before = await db.invoice.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, total: true },
  });
  if (!before) throw new NotFoundError("That invoice does not exist.");

  // A sent invoice is a document the client holds. Changing its figures would
  // mean two versions of the same number exist.
  if (!isEditable(before.status)) {
    throw new ConflictError("That invoice has been sent. Cancel it and raise a new one.");
  }

  return withAudit(
    { actor, action: "UPDATE", entityType: "Invoice", entityId: id, before },
    async (tx) => {
      await tx.invoice.update({
        where: { id },
        data: {
          projectId: input.projectId || null,
          contractId: input.contractId || null,
          currency: input.currency,
          issuedAt: input.issuedAt ?? new Date(),
          dueAt: input.dueAt,
          notes: input.notes ?? null,
        },
      });

      await writeItems(tx, id, input.items);
      return { id };
    },
  );
}

/** Issue the invoice to the client, and email it. */
export async function sendInvoice(actor: Actor, id: string) {
  requirePermission(actor, "invoices.send");

  const before = await db.invoice.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, number: true, total: true, _count: { select: { items: true } } },
  });
  if (!before) throw new NotFoundError("That invoice does not exist.");

  const error = transitionError(before.status, "SENT");
  if (error) throw new ValidationError(error);
  if (before._count.items === 0) throw new ValidationError("That invoice has no lines.");

  const sent = await withAudit(
    { actor, action: "SEND", entityType: "Invoice", entityId: id, before },
    (tx) =>
      tx.invoice.update({
        where: { id },
        data: { status: "SENT" },
        select: { id: true, number: true, status: true },
      }),
  );

  // After the status is committed, so a mail failure cannot leave an invoice
  // that was never marked sent. The attempt is logged either way.
  await emailInvoice(id);

  return sent;
}

export async function cancelInvoice(actor: Actor, id: string, reason: string | null) {
  requirePermission(actor, "invoices.edit");

  const before = await db.invoice.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, paidTotal: true },
  });
  if (!before) throw new NotFoundError("That invoice does not exist.");

  const error = transitionError(before.status, "CANCELLED");
  if (error) throw new ValidationError(error);

  // Decimal, not Number(): a paisa of received money still blocks a cancel.
  if (gt(before.paidTotal.toString(), 0)) {
    throw new ConflictError("Money has been received against that invoice. Refund it first.");
  }

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "Invoice",
      entityId: id,
      before,
      // The reason belongs in the audit trail, not in `notes` — notes are
      // printed on the client's invoice, and overwriting them would destroy
      // what someone wrote there.
      after: { status: "CANCELLED", reason },
    },
    (tx) =>
      tx.invoice.update({
        where: { id },
        data: { status: "CANCELLED" },
        select: { id: true, status: true },
      }),
  );
}

/**
 * Mark outstanding invoices overdue.
 *
 * Called from the finance screens and available to a scheduled job. It only
 * moves invoices whose due date has genuinely passed, and never touches a
 * draft, a paid or a cancelled one.
 */
export async function markOverdue(now = new Date()): Promise<number> {
  const result = await db.invoice.updateMany({
    where: {
      deletedAt: null,
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      dueAt: { lt: now },
    },
    data: { status: "OVERDUE" },
  });

  return result.count;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listInvoices(actor: Actor, params: InvoiceListParamsInput) {
  requirePermission(actor, "invoices.view");

  const page = Math.max(1, params.page);
  const perPage = Math.min(100, Math.max(5, params.perPage));
  const search = params.search?.trim();

  const where: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...(params.status ? { status: params.status } : {}),
    ...(params.clientId ? { clientId: params.clientId } : {}),
    ...(params.overdue
      ? { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, dueAt: { lt: new Date() } }
      : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: "insensitive" as const } },
            { client: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total, outstanding] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        issuedAt: true,
        dueAt: true,
        total: true,
        paidTotal: true,
        dueTotal: true,
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    db.invoice.count({ where }),
    db.invoice.aggregate({
      where: { deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      _sum: { dueTotal: true },
    }),
  ]);

  return {
    // Money leaves as fixed-precision strings; a Decimal would not survive the
    // RSC boundary and must never become a JS number.
    rows: rows.map((row) => ({
      ...row,
      total: toMoneyString(row.total),
      paidTotal: toMoneyString(row.paidTotal),
      dueTotal: toMoneyString(row.dueTotal),
    })),
    total,
    outstandingTotal: toMoneyString(outstanding._sum.dueTotal ?? 0),
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getInvoice(actor: Actor, id: string) {
  requirePermission(actor, "invoices.view");

  const invoice = await db.invoice.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      issuedAt: true,
      dueAt: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      total: true,
      paidTotal: true,
      dueTotal: true,
      notes: true,
      clientId: true,
      projectId: true,
      contractId: true,
      retainerId: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      items: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          quantity: true,
          unitPrice: true,
          discountRate: true,
          taxRate: true,
          lineTotal: true,
        },
      },
      payments: {
        orderBy: { receivedAt: "desc" },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          gateway: true,
          gatewayPaymentId: true,
          receivedAt: true,
        },
      },
    },
  });

  if (!invoice) throw new NotFoundError("That invoice does not exist.");

  return {
    ...invoice,
    subtotal: toMoneyString(invoice.subtotal),
    discountTotal: toMoneyString(invoice.discountTotal),
    taxTotal: toMoneyString(invoice.taxTotal),
    total: toMoneyString(invoice.total),
    paidTotal: toMoneyString(invoice.paidTotal),
    dueTotal: toMoneyString(invoice.dueTotal),
    outstanding: isOutstanding(invoice.status),
    items: invoice.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: toMoneyString(item.unitPrice),
      discountRate: item.discountRate.toString(),
      taxRate: item.taxRate.toString(),
      lineTotal: toMoneyString(item.lineTotal),
    })),
    payments: invoice.payments.map((payment) => ({
      ...payment,
      amount: toMoneyString(payment.amount),
    })),
  };
}

/** Totals for the finance overview. Money as strings, never numbers. */
export async function financeSummary(actor: Actor) {
  requirePermission(actor, "invoices.view");

  const now = new Date();

  const [outstanding, overdue, paidThisMonth, drafts] = await Promise.all([
    db.invoice.aggregate({
      where: { deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      _sum: { dueTotal: true },
      _count: true,
    }),
    db.invoice.aggregate({
      where: {
        deletedAt: null,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        dueAt: { lt: now },
      },
      _sum: { dueTotal: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: {
        status: "CAPTURED",
        receivedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
      },
      _sum: { amount: true },
    }),
    db.invoice.count({ where: { deletedAt: null, status: "DRAFT" } }),
  ]);

  return {
    outstandingTotal: toMoneyString(outstanding._sum.dueTotal ?? 0),
    outstandingCount: outstanding._count,
    overdueTotal: toMoneyString(overdue._sum.dueTotal ?? 0),
    overdueCount: overdue._count,
    receivedThisMonth: toMoneyString(paidThisMonth._sum.amount ?? 0),
    drafts,
  };
}
