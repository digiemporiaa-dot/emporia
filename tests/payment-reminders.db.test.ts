import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { systemActor } from "@/lib/actor/types";
import { REMINDER_INTERVAL_DAYS, sendPaymentReminders } from "@/lib/services/retainer.service";

/**
 * The scheduler calls sendPaymentReminders every five minutes, so a reminder
 * must go out at most once per interval per invoice, whether or not the send
 * itself succeeded.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `pr${Date.now().toString(36)}`;

describeDb("payment reminders", () => {
  const actor = systemActor({ permissions: ["invoices.send"] });
  const now = new Date();
  let clientId = "";
  let invoiceId = "";
  const number = `INV-${TAG}`;

  beforeAll(async () => {
    const staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    clientId = (
      await db.client.create({
        data: {
          name: `Reminder ${TAG}`,
          slug: `reminder-${TAG}`,
          ownerId: staffId,
          contacts: { create: { name: "Payer", email: `payer-${TAG}@x.test`, isPrimary: true } },
        },
        select: { id: true },
      })
    ).id;
    invoiceId = (
      await db.invoice.create({
        data: {
          number,
          clientId,
          status: "SENT",
          issuedAt: new Date(now.getTime() - 30 * 86_400_000),
          dueAt: new Date(now.getTime() + 86_400_000),
          total: "1000.00",
          dueTotal: "1000.00",
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (!clientId) return;
    await db.emailLog.deleteMany({ where: { entityType: "Invoice", entityId: invoiceId } });
    await db.invoice.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
  });

  it("requires invoices.send", async () => {
    await expect(sendPaymentReminders(systemActor(), 3, now)).rejects.toThrow(ForbiddenError);
  });

  it("reminds once, then not again on the next run", async () => {
    const first = await sendPaymentReminders(actor, 3, now);
    expect(first).toContain(number);
    expect(
      await db.emailLog.count({ where: { templateKey: "PAYMENT_REMINDER", entityType: "Invoice", entityId: invoiceId } }),
    ).toBe(1);

    const fiveMinutesLater = new Date(now.getTime() + 5 * 60_000);
    const second = await sendPaymentReminders(actor, 3, fiveMinutesLater);
    expect(second).not.toContain(number);
    expect(
      await db.emailLog.count({ where: { templateKey: "PAYMENT_REMINDER", entityType: "Invoice", entityId: invoiceId } }),
    ).toBe(1);
  });

  it("reminds again once the interval has passed", async () => {
    const old = new Date(now);
    old.setDate(old.getDate() - REMINDER_INTERVAL_DAYS - 1);
    await db.emailLog.updateMany({
      where: { templateKey: "PAYMENT_REMINDER", entityType: "Invoice", entityId: invoiceId },
      data: { createdAt: old },
    });
    const again = await sendPaymentReminders(actor, 3, now);
    expect(again).toContain(number);
  });
});
