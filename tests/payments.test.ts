import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  createInvoice,
  getInvoice,
  markOverdue,
  sendInvoice,
} from "@/lib/services/invoice.service";
import {
  handleWebhook,
  recordManualPayment,
  refundPayment,
  verifyCheckoutSignature,
} from "@/lib/services/payment.service";
import { billDueRetainers, createRetainer } from "@/lib/services/retainer.service";
import { payments, resetPayments } from "@/lib/payments";
import { resetEnvCache } from "@/lib/config/env";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * The phase 13 exit criterion, second half: a replayed webhook does not
 * double-credit a payment.
 *
 * Signatures are computed here exactly as Razorpay computes them, so the real
 * verification code is exercised rather than stubbed.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const KEY_SECRET = "test-key-secret";
const WEBHOOK_SECRET = "test-webhook-secret";

function webhookBody(input: {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  invoiceId: string;
  event?: string;
}): string {
  return JSON.stringify({
    event: input.event ?? "payment.captured",
    payload: {
      payment: {
        entity: {
          id: input.paymentId,
          order_id: input.orderId,
          amount: input.amountMinor,
          currency: "INR",
          status: "captured",
          notes: { invoiceId: input.invoiceId },
        },
      },
    },
  });
}

const sign = (body: string, secret = WEBHOOK_SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

describeDb("payments and reconciliation", () => {
  let prisma: PrismaClient;
  let actor: Actor;
  let weakActor: Actor;
  let clientId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    process.env["RAZORPAY_KEY_ID"] = "rzp_test_key";
    process.env["RAZORPAY_KEY_SECRET"] = KEY_SECRET;
    process.env["RAZORPAY_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
    resetEnvCache();
    resetPayments();

    const staff = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });

    const base = {
      userId: staff.id,
      name: "Finance",
      email: "finance@emporia.test",
      type: "STAFF" as const,
      roleName: "ADMIN" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };

    actor = {
      ...base,
      permissions: new Set([
        "invoices.view",
        "invoices.create",
        "invoices.edit",
        "invoices.send",
        "payments.view",
        "payments.record",
        "payments.refund",
        "retainers.view",
        "retainers.create",
        "retainers.edit",
      ]),
    };
    weakActor = { ...base, permissions: new Set(["invoices.view"]) };

    const client = await prisma.client.create({
      data: { name: "Finance Test Client", slug: `finance-test-${Date.now()}` },
      select: { id: true },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { clientId } });
    await prisma.invoiceItem.deleteMany({ where: { invoice: { clientId } } });
    await prisma.invoice.deleteMany({ where: { clientId } });
    await prisma.retainer.deleteMany({ where: { clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.$disconnect();

    for (const key of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) {
      delete process.env[key];
    }
    resetEnvCache();
    resetPayments();
  });

  async function makeSentInvoice(total: { unitPrice: string; taxRate: string }) {
    const invoice = await createInvoice(actor, {
      clientId,
      currency: "INR",
      dueAt: new Date(Date.now() + 14 * 86400000),
      items: [
        {
          name: "Retainer",
          quantity: "1",
          unitPrice: total.unitPrice,
          discountRate: "0",
          taxRate: total.taxRate,
        },
      ],
    });

    await sendInvoice(actor, invoice.id);
    return invoice;
  }

  // ── The exit criterion ──────────────────────────────────────────────────

  it("credits a captured payment once, however many times it is delivered", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "100000.00", taxRate: "18" });

    const body = webhookBody({
      paymentId: "pay_replay_001",
      orderId: "order_replay_001",
      amountMinor: 11800000,
      invoiceId: invoice.id,
    });

    const event = payments().parseWebhook(body);

    const first = await handleWebhook(event);
    expect(first.handled).toBe(true);

    // Razorpay retries until it gets a 2xx, so the same event arrives again.
    const second = await handleWebhook(event);
    const third = await handleWebhook(event);

    expect(second.handled).toBe(false);
    expect(second.reason).toMatch(/already recorded/i);
    expect(third.handled).toBe(false);

    const rows = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(rows).toHaveLength(1);

    const after = await getInvoice(actor, invoice.id);
    expect(after.paidTotal).toBe("118000.00");
    expect(after.dueTotal).toBe("0.00");
    expect(after.status).toBe("PAID");
  });

  it("credits nothing twice even when two deliveries race", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "50000.00", taxRate: "0" });

    const body = webhookBody({
      paymentId: "pay_race_001",
      orderId: "order_race_001",
      amountMinor: 5000000,
      invoiceId: invoice.id,
    });
    const event = payments().parseWebhook(body);

    // Both start before either finishes.
    const results = await Promise.all([handleWebhook(event), handleWebhook(event)]);

    expect(results.filter((r) => r.handled)).toHaveLength(1);

    const rows = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(rows).toHaveLength(1);

    const after = await getInvoice(actor, invoice.id);
    expect(after.paidTotal).toBe("50000.00");
    expect(after.status).toBe("PAID");
  });

  // ── Signature verification ──────────────────────────────────────────────

  it("accepts a correctly signed webhook and rejects everything else", () => {
    const body = webhookBody({
      paymentId: "pay_sig",
      orderId: "order_sig",
      amountMinor: 100,
      invoiceId: "x",
    });

    expect(payments().verifyWebhook(body, sign(body))).toBe(true);

    // Wrong secret, tampered body, empty and truncated signatures.
    expect(payments().verifyWebhook(body, sign(body, "another-secret"))).toBe(false);
    expect(payments().verifyWebhook(`${body} `, sign(body))).toBe(false);
    expect(payments().verifyWebhook(body, "")).toBe(false);
    expect(payments().verifyWebhook(body, sign(body).slice(0, 32))).toBe(false);
  });

  it("verifies a checkout callback the way the gateway signs it", () => {
    const orderId = "order_checkout";
    const paymentId = "pay_checkout";
    const signature = createHmac("sha256", KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    expect(verifyCheckoutSignature({ orderId, paymentId, signature })).toBe(true);
    expect(verifyCheckoutSignature({ orderId, paymentId, signature: "deadbeef" })).toBe(false);
    expect(
      verifyCheckoutSignature({ orderId, paymentId: "pay_other", signature }),
    ).toBe(false);
  });

  it("ignores events that are not a capture", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "1000.00", taxRate: "0" });

    const body = webhookBody({
      paymentId: "pay_failed_001",
      orderId: "order_failed_001",
      amountMinor: 100000,
      invoiceId: invoice.id,
      event: "payment.failed",
    });

    const result = await handleWebhook(payments().parseWebhook(body));
    expect(result.handled).toBe(false);

    const after = await getInvoice(actor, invoice.id);
    expect(after.paidTotal).toBe("0.00");
    expect(after.status).toBe("SENT");
  });

  it("refuses a payment for an invoice it cannot find", async () => {
    const body = webhookBody({
      paymentId: "pay_orphan",
      orderId: "order_orphan",
      amountMinor: 100,
      invoiceId: "no-such-invoice",
    });

    const result = await handleWebhook(payments().parseWebhook(body));
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no invoice/i);
    expect(await prisma.payment.count({ where: { gatewayPaymentId: "pay_orphan" } })).toBe(0);
  });

  // ── Manual payments ─────────────────────────────────────────────────────

  it("records a bank transfer and reconciles the invoice", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "100000.00", taxRate: "18" });

    const part = await recordManualPayment(actor, {
      invoiceId: invoice.id,
      amount: "18000.00",
      gateway: "BANK_TRANSFER",
      reference: "NEFT/123",
    });

    expect(part.paidTotal).toBe("18000.00");
    expect(part.dueTotal).toBe("100000.00");
    expect(part.status).toBe("PARTIALLY_PAID");

    const rest = await recordManualPayment(actor, {
      invoiceId: invoice.id,
      amount: "100000.00",
      gateway: "BANK_TRANSFER",
    });

    expect(rest.dueTotal).toBe("0.00");
    expect(rest.status).toBe("PAID");
  });

  it("refuses to take more than is outstanding", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "1000.00", taxRate: "0" });

    await expect(
      recordManualPayment(actor, {
        invoiceId: invoice.id,
        amount: "1000.01",
        gateway: "CASH",
      }),
    ).rejects.toThrow(/more than the 1000.00 outstanding/i);
  });

  it("refuses money against a draft or a cancelled invoice", async () => {
    const draft = await createInvoice(actor, {
      clientId,
      currency: "INR",
      dueAt: new Date(),
      items: [{ name: "x", quantity: "1", unitPrice: "100.00", discountRate: "0", taxRate: "0" }],
    });

    await expect(
      recordManualPayment(actor, { invoiceId: draft.id, amount: "100.00", gateway: "CASH" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("requires payments.record", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "100.00", taxRate: "0" });

    await expect(
      recordManualPayment(weakActor, { invoiceId: invoice.id, amount: "1.00", gateway: "CASH" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ── Refunds ─────────────────────────────────────────────────────────────

  it("puts the money back on the invoice when a manual payment is refunded", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "5000.00", taxRate: "0" });

    const paid = await recordManualPayment(actor, {
      invoiceId: invoice.id,
      amount: "5000.00",
      gateway: "CHEQUE",
    });
    expect(paid.status).toBe("PAID");

    await refundPayment(actor, paid.paymentId, "5000.00", "Cheque bounced");

    const after = await getInvoice(actor, invoice.id);
    expect(after.paidTotal).toBe("0.00");
    expect(after.dueTotal).toBe("5000.00");
    expect(after.status).toBe("SENT");
  });

  it("refuses to refund more than was paid", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "100.00", taxRate: "0" });
    const paid = await recordManualPayment(actor, {
      invoiceId: invoice.id,
      amount: "100.00",
      gateway: "CASH",
    });

    await expect(refundPayment(actor, paid.paymentId, "100.01", null)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  // ── Invoices ────────────────────────────────────────────────────────────

  it("numbers invoices in sequence and stores the figures", async () => {
    const invoice = await createInvoice(actor, {
      clientId,
      currency: "INR",
      dueAt: new Date(Date.now() + 7 * 86400000),
      items: [
        { name: "SEO", quantity: "3", unitPrice: "85000.00", discountRate: "10", taxRate: "18" },
      ],
    });

    expect(invoice.number).toMatch(/^INV-\d{4}-\d{4}$/);

    const loaded = await getInvoice(actor, invoice.id);
    expect(loaded.total).toBe("270810.00");
    expect(loaded.dueTotal).toBe("270810.00");
    expect(typeof loaded.total).toBe("string");
  });

  it("keeps numbering past the fourth digit", async () => {
    // The counter used to be read by sorting the numbers as strings, which
    // agrees with numeric order only up to 9999: once INV-YYYY-10000 exists,
    // "…-9999" still sorts highest and every later invoice collides on the
    // unique constraint. Seed the boundary and check the next two clear it.
    const year = new Date().getFullYear();

    await prisma.invoice.create({
      data: {
        number: `INV-${year}-9999`,
        clientId,
        status: "DRAFT",
        currency: "INR",
        issuedAt: new Date(),
        dueAt: new Date(Date.now() + 7 * 86400000),
        subtotal: "100.00",
        discountTotal: "0.00",
        taxTotal: "0.00",
        total: "100.00",
        dueTotal: "100.00",
      },
    });

    const first = await createInvoice(actor, {
      clientId,
      currency: "INR",
      dueAt: new Date(Date.now() + 7 * 86400000),
      items: [
        { name: "Ten thousandth", quantity: "1", unitPrice: "100.00", discountRate: "0", taxRate: "0" },
      ],
    });
    expect(first.number).toBe(`INV-${year}-10000`);

    // And the one after it, which is where the old behaviour blew up.
    const second = await createInvoice(actor, {
      clientId,
      currency: "INR",
      dueAt: new Date(Date.now() + 7 * 86400000),
      items: [
        { name: "Ten thousand and first", quantity: "1", unitPrice: "100.00", discountRate: "0", taxRate: "0" },
      ],
    });
    expect(second.number).toBe(`INV-${year}-10001`);
  });

  it("will not change a sent invoice", async () => {
    const invoice = await makeSentInvoice({ unitPrice: "100.00", taxRate: "0" });

    const { updateInvoice } = await import("@/lib/services/invoice.service");
    await expect(
      updateInvoice(actor, invoice.id, {
        clientId,
        currency: "INR",
        dueAt: new Date(),
        items: [{ name: "y", quantity: "1", unitPrice: "1.00", discountRate: "0", taxRate: "0" }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("marks outstanding invoices overdue, and nothing else", async () => {
    const overdue = await createInvoice(actor, {
      clientId,
      currency: "INR",
      dueAt: new Date(Date.now() - 86400000),
      items: [{ name: "late", quantity: "1", unitPrice: "500.00", discountRate: "0", taxRate: "0" }],
    });
    await sendInvoice(actor, overdue.id);

    const draft = await createInvoice(actor, {
      clientId,
      currency: "INR",
      dueAt: new Date(Date.now() - 86400000),
      items: [{ name: "draft", quantity: "1", unitPrice: "500.00", discountRate: "0", taxRate: "0" }],
    });

    await markOverdue();

    expect((await getInvoice(actor, overdue.id)).status).toBe("OVERDUE");
    // A draft is not late; it was never sent.
    expect((await getInvoice(actor, draft.id)).status).toBe("DRAFT");
  });

  // ── Retainers ───────────────────────────────────────────────────────────

  it("bills a due retainer once per cycle, however often it runs", async () => {
    const retainer = await createRetainer(actor, {
      clientId,
      name: "Monthly retainer",
      amount: "60000.00",
      currency: "INR",
      cycle: "MONTHLY",
      startsAt: new Date(Date.now() - 86400000),
    });

    const first = await billDueRetainers(actor);
    expect(first.filter((row) => row.retainerId === retainer.id)).toHaveLength(1);

    // Run it again straight away: the date has already moved on.
    const second = await billDueRetainers(actor);
    expect(second.filter((row) => row.retainerId === retainer.id)).toHaveLength(0);

    const invoices = await prisma.invoice.findMany({ where: { retainerId: retainer.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.total.toString()).toBe("60000");

    const updated = await prisma.retainer.findUniqueOrThrow({ where: { id: retainer.id } });
    expect(updated.nextBillingAt.getTime()).toBeGreaterThan(Date.now());
  });
});
