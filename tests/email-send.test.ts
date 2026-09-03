import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  listEmailLog,
  retryEmail,
  sendTemplate,
  sendTestEmail,
  updateTemplate,
} from "@/lib/services/email.service";
import { notify, notifyWithEmail, assertChannelAvailable, markRead, unreadCount } from "@/lib/services/notification.service";
import { resetMailer } from "@/lib/email";
import { resetEnvCache } from "@/lib/config/env";
import { ForbiddenError, IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { SmtpSink } from "./support/smtp-sink";
import type { Actor } from "@/lib/actor/types";

/**
 * The phase 12 exit criterion: every send is logged with its status, and
 * failures are visible rather than silent.
 *
 * The real nodemailer path runs against a local SMTP sink, so the transport,
 * the envelope and the message body are genuinely exercised.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("email sending", () => {
  let prisma: PrismaClient;
  let sink: SmtpSink;
  let actor: Actor;
  let weakActor: Actor;
  let userId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    sink = new SmtpSink();
    const port = await sink.start();

    process.env["SMTP_HOST"] = "127.0.0.1";
    process.env["SMTP_PORT"] = String(port);
    process.env["SMTP_FROM"] = "Emporia <hello@emporia.test>";
    process.env["SMTP_SECURE"] = "false";
    delete process.env["SMTP_USER"];
    delete process.env["SMTP_PASSWORD"];
    resetEnvCache();
    resetMailer();

    const user = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });
    userId = user.id;

    const base = {
      userId: user.id,
      name: "Test Sender",
      email: "sender@emporia.test",
      type: "STAFF" as const,
      roleName: "ADMIN" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };

    actor = { ...base, permissions: new Set(["emails.view", "emails.edit", "emails.send"]) };
    weakActor = { ...base, permissions: new Set(["emails.view"]) };
  });

  afterAll(async () => {
    await prisma.emailLog.deleteMany({ where: { to: { endsWith: "@sendtest.example" } } });
    await prisma.notification.deleteMany({ where: { userId, title: { startsWith: "Test " } } });
    await prisma.$disconnect();
    await sink.stop();

    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_SECURE"]) {
      delete process.env[key];
    }
    resetEnvCache();
    resetMailer();
  });

  afterEach(() => {
    sink.clear();
    sink.rejectAt = null;
  });

  // ── A successful send ───────────────────────────────────────────────────

  it("sends through SMTP and logs it as sent", async () => {
    const outcome = await sendTemplate("NEW_LEAD", {
      to: "sales@sendtest.example",
      variables: {
        leadName: "Asha Rao",
        company: " — Rao Foods",
        email: "asha@example.test",
        phone: "+91 90000 00000",
        source: "Website form",
        interest: "SEO in Mumbai",
        message: "We need help with organic search.",
        leadUrl: "https://emporia.test/admin/leads/abc",
      },
      entity: { type: "Lead", id: "abc" },
    });

    expect(outcome.ok).toBe(true);

    // It really went over the wire.
    const mail = sink.last();
    expect(mail?.to).toEqual(["sales@sendtest.example"]);
    expect(mail?.subject).toBe("New lead: Asha Rao");
    expect(mail?.body).toContain("Rao Foods");
    expect(mail?.body).toContain("text/plain");
    expect(mail?.body).toContain("text/html");

    // And it is logged.
    const log = await prisma.emailLog.findUniqueOrThrow({
      where: { id: outcome.ok ? outcome.logId : "" },
    });
    expect(log.status).toBe("SENT");
    expect(log.sentAt).not.toBeNull();
    expect(log.providerMessageId).toBeTruthy();
    expect(log.entityType).toBe("Lead");
    expect(log.entityId).toBe("abc");
    expect(log.error).toBeNull();
  });

  it("escapes what a stranger typed, so a lead cannot inject markup", async () => {
    await sendTemplate("NEW_LEAD", {
      to: "sales@sendtest.example",
      variables: {
        leadName: "Mallory",
        company: "",
        email: "m@example.test",
        phone: "",
        source: "Website form",
        interest: "SEO",
        message: '<script>alert("pwned")</script>',
        leadUrl: "https://emporia.test/admin/leads/x",
      },
    });

    const body = sink.last()?.body ?? "";

    // The HTML part is what a client renders, so that is where escaping has to
    // hold. The text/plain part carries the message as typed, which is correct:
    // markup is not interpreted there.
    const htmlPart = body.slice(body.indexOf("Content-Type: text/html"));
    expect(htmlPart).not.toContain("<script>alert");
    expect(htmlPart).toContain("&lt;script&gt;");
  });

  // ── Failures are recorded, not swallowed ────────────────────────────────

  it("records a rejected recipient as failed, with the reason", async () => {
    sink.rejectAt = "RCPT";

    const outcome = await sendTemplate("NEW_LEAD", {
      to: "nobody@sendtest.example",
      variables: {
        leadName: "X",
        company: "",
        email: "",
        phone: "",
        source: "",
        interest: "",
        message: "",
        leadUrl: "",
      },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.logId).toBeTruthy();

    const log = await prisma.emailLog.findUniqueOrThrow({
      where: { id: outcome.logId as string },
    });
    expect(log.status).toBe("FAILED");
    expect(log.error).toBeTruthy();
    expect(log.sentAt).toBeNull();
  });

  it("records a refused message as failed", async () => {
    sink.rejectAt = "DATA";

    const outcome = await sendTemplate("FOLLOW_UP", {
      to: "someone@sendtest.example",
      variables: { taskTitle: "Call back", leadName: "Y", dueDate: "today", leadUrl: "u" },
    });

    expect(outcome.ok).toBe(false);
    const log = await prisma.emailLog.findUniqueOrThrow({ where: { id: outcome.logId as string } });
    expect(log.status).toBe("FAILED");
  });

  it("records a send attempted with no mail server configured", async () => {
    const host = process.env["SMTP_HOST"];
    delete process.env["SMTP_HOST"];
    resetEnvCache();
    resetMailer();

    const outcome = await sendTemplate("FOLLOW_UP", {
      to: "unconfigured@sendtest.example",
      variables: { taskTitle: "T", leadName: "L", dueDate: "d", leadUrl: "u" },
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/not configured/i);

    const log = await prisma.emailLog.findUniqueOrThrow({ where: { id: outcome.logId as string } });
    expect(log.status).toBe("FAILED");
    expect(log.error).toMatch(/not configured/i);

    process.env["SMTP_HOST"] = host as string;
    resetEnvCache();
    resetMailer();
  });

  it("records a send against a switched-off template rather than dropping it", async () => {
    await updateTemplate(actor, {
      key: "PASSWORD_RESET",
      name: "Password reset",
      subject: "Reset your {{siteName}} password",
      html: "<p>Hello {{name}}, reset it at {{resetUrl}} before {{expiresAt}}.</p>",
      text: "Hello {{name}}, reset it at {{resetUrl}} before {{expiresAt}}.",
      isActive: false,
    });

    const outcome = await sendTemplate("PASSWORD_RESET", {
      to: "off@sendtest.example",
      variables: { name: "A", resetUrl: "u", expiresAt: "tomorrow" },
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/switched off/i);

    const log = await prisma.emailLog.findUniqueOrThrow({ where: { id: outcome.logId as string } });
    expect(log.status).toBe("FAILED");
    expect(sink.received).toHaveLength(0);

    await updateTemplate(actor, {
      key: "PASSWORD_RESET",
      name: "Password reset",
      subject: "Reset your {{siteName}} password",
      html: "<p>Hello {{name}}, reset it at {{resetUrl}} before {{expiresAt}}.</p>",
      text: "Hello {{name}}, reset it at {{resetUrl}} before {{expiresAt}}.",
      isActive: true,
    });
  });

  it("makes failures findable in the log", async () => {
    const failed = await listEmailLog(actor, { status: "FAILED", perPage: 100 });

    expect(failed.rows.length).toBeGreaterThanOrEqual(3);
    expect(failed.rows.every((row) => row.status === "FAILED")).toBe(true);
    expect(failed.failures).toBeGreaterThanOrEqual(3);
  });

  // ── Retry ───────────────────────────────────────────────────────────────

  it("retries a failure by re-rendering what was originally sent", async () => {
    sink.rejectAt = "RCPT";
    const first = await sendTemplate("LEAD_ASSIGNED", {
      to: "retry@sendtest.example",
      variables: {
        leadName: "Retry Lead",
        company: " — Retry Co",
        email: "r@example.test",
        phone: "1",
        score: "42",
        assignedBy: "Someone",
        leadUrl: "https://emporia.test/admin/leads/r",
      },
    });
    expect(first.ok).toBe(false);

    sink.rejectAt = null;
    const retried = await retryEmail(actor, first.logId as string);
    expect(retried.ok).toBe(true);

    // The same message, not one full of placeholders.
    const mail = sink.last();
    expect(mail?.subject).toBe("Retry Lead is now yours");
    expect(mail?.body).toContain("Retry Co");
    expect(mail?.body).not.toContain("{{");

    // The original row stays failed; the retry is its own row.
    const original = await prisma.emailLog.findUniqueOrThrow({ where: { id: first.logId as string } });
    expect(original.status).toBe("FAILED");
    expect(retried.ok && retried.logId).not.toBe(first.logId);
  });

  it("can retry a send that failed because the template was off", async () => {
    await updateTemplate(actor, {
      key: "FOLLOW_UP",
      name: "Follow-up due",
      subject: "Follow up with {{leadName}} today",
      html: "<p>{{taskTitle}} — {{leadName}}, due {{dueDate}}. {{leadUrl}}</p>",
      text: "{{taskTitle}} — {{leadName}}, due {{dueDate}}. {{leadUrl}}",
      isActive: false,
    });

    const refused = await sendTemplate("FOLLOW_UP", {
      to: "wasoff@sendtest.example",
      variables: { taskTitle: "Ring back", leadName: "Nadia", dueDate: "Friday", leadUrl: "u" },
    });
    expect(refused.ok).toBe(false);

    await updateTemplate(actor, {
      key: "FOLLOW_UP",
      name: "Follow-up due",
      subject: "Follow up with {{leadName}} today",
      html: "<p>{{taskTitle}} — {{leadName}}, due {{dueDate}}. {{leadUrl}}</p>",
      text: "{{taskTitle}} — {{leadName}}, due {{dueDate}}. {{leadUrl}}",
      isActive: true,
    });

    // The failure kept its variables, so the retry sends the message that was
    // meant rather than one full of placeholders.
    const retried = await retryEmail(actor, refused.logId as string);
    expect(retried.ok).toBe(true);
    expect(sink.last()?.subject).toBe("Follow up with Nadia today");
    expect(sink.last()?.body).not.toContain("{{");
  });

  it("refuses to retry something already sent", async () => {
    const sent = await sendTemplate("FOLLOW_UP", {
      to: "sent@sendtest.example",
      variables: { taskTitle: "T", leadName: "L", dueDate: "d", leadUrl: "u" },
    });
    expect(sent.ok).toBe(true);

    await expect(retryEmail(actor, sent.logId as string)).rejects.toBeInstanceOf(ValidationError);
  });

  // ── Templates ───────────────────────────────────────────────────────────

  it("refuses an edit that uses a variable nothing supplies", async () => {
    await expect(
      updateTemplate(actor, {
        key: "FOLLOW_UP",
        name: "Follow-up due",
        subject: "Follow up with {{leadName}}",
        html: "<p>{{taskTitle}} for {{whoeverThisIs}}</p>",
        text: null,
        isActive: true,
      }),
    ).rejects.toThrow(/whoeverThisIs/);
  });

  it("requires emails.edit to edit and emails.send to test", async () => {
    await expect(
      updateTemplate(weakActor, {
        key: "FOLLOW_UP",
        name: "x",
        subject: "y",
        html: "<p>a body long enough to pass</p>",
        text: null,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(sendTestEmail(weakActor, "FOLLOW_UP", "x@sendtest.example")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("sends a test with sample values that are visibly samples", async () => {
    const outcome = await sendTestEmail(actor, "FOLLOW_UP", "tester@sendtest.example");
    expect(outcome.ok).toBe(true);

    const body = sink.last()?.body ?? "";
    expect(body).toContain("[taskTitle]");
    expect(body).not.toMatch(/\{\{/);
  });

  // ── Notifications ───────────────────────────────────────────────────────

  it("writes an in-app notification and emails it in one call", async () => {
    const before = await unreadCount(actor);

    const result = await notifyWithEmail({
      userId,
      title: "Test notification",
      body: "Something happened",
      href: "/admin/leads",
      templateKey: "FOLLOW_UP",
      variables: { taskTitle: "Call back", leadName: "Someone", dueDate: "today", leadUrl: "u" },
    });

    expect(result.notification.id).toBeTruthy();
    expect(result.email?.ok).toBe(true);
    expect(await unreadCount(actor)).toBe(before + 1);

    await markRead(actor, result.notification.id);
    expect(await unreadCount(actor)).toBe(before);
  });

  it("still records the in-app notification when the email fails", async () => {
    sink.rejectAt = "RCPT";

    const result = await notifyWithEmail({
      userId,
      title: "Test notification with a failing email",
      templateKey: "FOLLOW_UP",
      variables: { taskTitle: "T", leadName: "L", dueDate: "d", leadUrl: "u" },
    });

    expect(result.notification.id).toBeTruthy();
    expect(result.email?.ok).toBe(false);
  });

  it("refuses the channels that are architected but not built", () => {
    expect(() => assertChannelAvailable("IN_APP")).not.toThrow();
    expect(() => assertChannelAvailable("EMAIL")).not.toThrow();

    for (const channel of ["WHATSAPP", "SMS", "PUSH"] as const) {
      expect(() => assertChannelAvailable(channel)).toThrow(IntegrationNotConfiguredError);
    }
  });

  it("keeps one user out of another's notifications", async () => {
    const mine = await notify({ userId, title: "Test mine" });

    const stranger: Actor = { ...actor, userId: "someone-else-entirely" };
    const result = await markRead(stranger, mine.id);

    // Scoped by userId as well as id, so nothing was touched.
    expect(result.updated).toBe(0);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.readAt).toBeNull();
  });
});
