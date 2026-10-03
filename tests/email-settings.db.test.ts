import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/config/env";
import { readSmtpSettings, resetMailer, resolveMailer } from "@/lib/email";
import { SMTP_SETTING_KEY } from "@/lib/email/smtp-settings";
import { decryptSecret } from "@/lib/security/secret";
import { ForbiddenError, RateLimitedError, ValidationError } from "@/lib/errors";
import {
  getEmailSettings,
  saveEmailSettings,
  sendSmtpTestEmail,
  verifySmtpSettings,
} from "@/lib/services/email-settings.service";
import { sendTemplate } from "@/lib/services/email.service";
import { alertLeadAssigned, alertNewLead } from "@/lib/services/alerts.service";
import { captureContactLead } from "@/lib/services/lead.service";
import { smtpSettingsSchema } from "@/lib/validation/email";
import { SmtpSink } from "./support/smtp-sink";
import type { Actor } from "@/lib/actor/types";

/**
 * Settings → Email, end to end against a real SMTP conversation.
 *
 * The sink demands AUTH PLAIN, so "logged in with the stored password" and
 * "authentication failed" are what a real provider would say, not mocks. What
 * is pinned here: the password never comes back out; the saved settings beat
 * the environment and a switched-off form stops sending outright; and the three
 * notification toggles send exactly the mails they promise — one per enquiry
 * to the sales list, never two.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const PASSWORD = "sink-Pa55word!";
const SALES = ["sales@settingstest.example", "ops@settingstest.example"];
const SUFFIX = `es-${Date.now()}`;

describeDb("Settings → Email", () => {
  let sink: SmtpSink;
  let envSink: SmtpSink;
  let port = 0;
  let admin: Actor;
  let viewer: Actor;
  let staffId = "";
  let staffEmail = "";
  let sourceId = "";
  const leadIds: string[] = [];

  function actorWith(permissions: string[]): Actor {
    return {
      userId: staffId,
      name: "Settings Tester",
      email: staffEmail,
      type: "STAFF",
      roleName: "ADMIN",
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
      permissions: new Set(permissions),
    };
  }

  function form(overrides: Record<string, unknown> = {}) {
    return smtpSettingsSchema.parse({
      host: "127.0.0.1",
      port: String(port),
      username: "mailer@sink.test",
      password: "",
      encryption: "NONE",
      fromName: "Emporia Settings",
      fromAddress: "hello@settingstest.example",
      replyTo: "",
      enabled: true,
      salesAddresses: "",
      notifyLeadCreated: true,
      notifyLeadAssigned: true,
      notifyFormSubmission: false,
      ...overrides,
    });
  }

  async function clearLimits() {
    await db.rateLimitWindow.deleteMany({ where: { key: { in: [`smtp-verify:${staffId}`, `smtp-test:${staffId}`] } } });
  }

  async function makeLead(overrides: { assignedToId?: string | null; email?: string } = {}) {
    const lead = await db.lead.create({
      data: {
        name: `Asha ${SUFFIX}`,
        email: overrides.email ?? `asha-${SUFFIX}@lead.example`,
        phone: "+91 98765 43210",
        company: "Acme Textiles",
        message: "We need help with local SEO in Surat.",
        sourceId,
        landingPath: "/services/seo",
        device: "MOBILE",
        status: "NEW",
        priority: "MEDIUM",
        assignedToId: overrides.assignedToId === undefined ? staffId : overrides.assignedToId,
      },
      select: { id: true },
    });
    leadIds.push(lead.id);
    return lead.id;
  }

  const logsFor = (leadId: string) =>
    db.emailLog.findMany({ where: { entityType: "Lead", entityId: leadId }, select: { templateKey: true, to: true, status: true } });

  const toSales = () => sink.received.filter((mail) => mail.to.includes(SALES[0] as string));

  beforeAll(async () => {
    sink = new SmtpSink();
    sink.credentials = { user: "mailer@sink.test", pass: PASSWORD };
    port = await sink.start();

    envSink = new SmtpSink();
    const envPort = await envSink.start();
    process.env["SMTP_HOST"] = "127.0.0.1";
    process.env["SMTP_PORT"] = String(envPort);
    process.env["SMTP_FROM"] = "Env Sender <env@settingstest.example>";
    process.env["SMTP_SECURE"] = "false";
    delete process.env["SMTP_USER"];
    delete process.env["SMTP_PASSWORD"];
    resetEnvCache();
    resetMailer();

    const staff = await db.user.findFirstOrThrow({
      where: { type: "STAFF", status: "ACTIVE" },
      select: { id: true, email: true },
      orderBy: { createdAt: "asc" },
    });
    staffId = staff.id;
    staffEmail = staff.email;
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { slug: "website-form" }, select: { id: true } })).id;

    admin = actorWith(["emails.view", "emails.send", "settings.edit"]);
    viewer = actorWith(["emails.view"]);

    await db.integrationSetting.deleteMany({ where: { provider: SMTP_SETTING_KEY } });
    await clearLimits();
  });

  beforeEach(() => {
    sink.clear();
    envSink.clear();
    sink.rejectAt = null;
  });

  afterAll(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: SMTP_SETTING_KEY } });
    await db.emailLog.deleteMany({ where: { OR: [{ entityId: { in: leadIds } }, { to: { contains: "settingstest.example" } }] } });
    await db.notification.deleteMany({ where: { entityId: { in: leadIds } } });
    await db.lead.deleteMany({ where: { id: { in: leadIds } } });
    await db.auditLog.deleteMany({ where: { entityType: "IntegrationSetting", entityId: SMTP_SETTING_KEY, actorId: staffId } });
    await clearLimits();
    delete process.env["SMTP_HOST"];
    delete process.env["SMTP_PORT"];
    delete process.env["SMTP_FROM"];
    delete process.env["SMTP_SECURE"];
    resetEnvCache();
    resetMailer();
    await sink.stop();
    await envSink.stop();
  });

  // -------------------------------------------------------------------------
  // Before anything is saved
  // -------------------------------------------------------------------------

  it("with nothing saved, the environment still sends — an existing deployment keeps working", async () => {
    const { source } = await resolveMailer();
    expect(source).toBe("environment");

    const outcome = await sendTemplate("NEW_LEAD", { to: "env-check@settingstest.example", variables: {} });
    expect(outcome.ok).toBe(true);
    expect(envSink.received).toHaveLength(1);
    expect(sink.received).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Who may do what
  // -------------------------------------------------------------------------

  it("refuses to show the settings without emails.view", async () => {
    await expect(getEmailSettings(actorWith([]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to save or test the connection without settings.edit", async () => {
    await expect(saveEmailSettings(viewer, form({ password: PASSWORD }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(verifySmtpSettings(viewer, form({ password: PASSWORD }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.integrationSetting.count({ where: { provider: SMTP_SETTING_KEY } })).toBe(0);
  });

  it("refuses a test send without emails.send", async () => {
    await expect(sendSmtpTestEmail(actorWith(["emails.view", "settings.edit"]), "x@settingstest.example")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("names the notification addresses that are not addresses, and saves nothing", async () => {
    const error = await saveEmailSettings(admin, form({ salesAddresses: "sales@settingstest.example, not-an-address" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((error as ValidationError).details)).toContain("not-an-address");
    expect(await db.integrationSetting.count({ where: { provider: SMTP_SETTING_KEY } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // The password
  // -------------------------------------------------------------------------

  it("encrypts the password, and it never comes back out — not in the view, not in the audit", async () => {
    const safe = await saveEmailSettings(admin, form({ password: PASSWORD, salesAddresses: SALES.join(", ") }));

    expect(safe.passwordConfigured).toBe(true);
    expect(safe.source).toBe("database");
    expect(safe.salesAddresses).toEqual(SALES);
    expect(Object.keys(safe)).not.toContain("password");
    expect(JSON.stringify(safe)).not.toContain(PASSWORD);

    const row = await db.integrationSetting.findUniqueOrThrow({ where: { provider: SMTP_SETTING_KEY } });
    const stored = (row.config as { password: string }).password;
    expect(stored).not.toContain(PASSWORD);
    expect(decryptSecret(stored)).toBe(PASSWORD);
    expect(row.isEnabled).toBe(true);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "IntegrationSetting", entityId: SMTP_SETTING_KEY, actorId: staffId },
      orderBy: { createdAt: "desc" },
    });
    const trail = JSON.stringify([audit.before, audit.after]);
    expect(trail).not.toContain(PASSWORD);
    expect(trail).not.toContain(stored);
    expect((audit.after as { passwordChanged: boolean }).passwordChanged).toBe(true);
  });

  it("a blank password keeps the stored one", async () => {
    const before = (await readSmtpSettings()).password;
    await saveEmailSettings(admin, form({ password: "", salesAddresses: SALES.join(", ") }));
    expect((await readSmtpSettings()).password).toBe(before);
  });

  it("removing the password clears it, and putting it back works", async () => {
    const removed = await saveEmailSettings(admin, form({ removePassword: true, salesAddresses: SALES.join(", ") }));
    expect(removed.passwordConfigured).toBe(false);
    expect((await readSmtpSettings()).password).toBeNull();

    await saveEmailSettings(admin, form({ password: PASSWORD, salesAddresses: SALES.join(", ") }));
    expect(decryptSecret((await readSmtpSettings()).password)).toBe(PASSWORD);
  });

  it("a password the app can no longer decrypt stops sending with a reason, rather than logging in blank", async () => {
    const row = await db.integrationSetting.findUniqueOrThrow({ where: { provider: SMTP_SETTING_KEY } });
    const config = row.config as Record<string, unknown>;
    await db.integrationSetting.update({ where: { provider: SMTP_SETTING_KEY }, data: { config: { ...config, password: "v1:not:real" } } });
    try {
      const { provider } = await resolveMailer();
      expect(provider.configured).toBe(false);
      await expect(provider.send({ to: "x@settingstest.example", subject: "s", html: "h", text: "t" })).rejects.toThrow(/can no longer be read/);
    } finally {
      await db.integrationSetting.update({ where: { provider: SMTP_SETTING_KEY }, data: { config: config as object } });
    }
  });

  // -------------------------------------------------------------------------
  // Test connection
  // -------------------------------------------------------------------------

  it("Test connection logs in with the stored password when the field is blank, and sends nothing", async () => {
    await clearLimits();
    const result = await verifySmtpSettings(admin, form({ password: "" }));
    expect(result).toEqual({ ok: true, message: "SMTP connection successful." });
    expect(sink.lastAuthUser).toBe("mailer@sink.test");
    expect(sink.received).toHaveLength(0);
  });

  it("Test connection checks what is typed now, so a wrong password reads as an authentication failure", async () => {
    await clearLimits();
    const result = await verifySmtpSettings(admin, form({ password: "wrong-password" }));
    expect(result).toEqual({ ok: false, message: "SMTP authentication failed. Please check your username and password." });
  });

  it("STARTTLS against a server that cannot upgrade fails rather than sending in the clear", async () => {
    await clearLimits();
    const result = await verifySmtpSettings(admin, form({ encryption: "STARTTLS" }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/secure connection/i);
  });

  it("SSL/TLS against a plain server fails with the encryption hint", async () => {
    await clearLimits();
    const result = await verifySmtpSettings(admin, form({ encryption: "SSL_TLS" }));
    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/successful/);
  });

  it("asks for a host before trying", async () => {
    await clearLimits();
    expect(await verifySmtpSettings(admin, form({ enabled: false, host: "" }))).toEqual({ ok: false, message: "Enter an SMTP host first." });
  });

  it("Test connection is rate limited", async () => {
    await clearLimits();
    for (let i = 0; i < 5; i++) await verifySmtpSettings(admin, form());
    await expect(verifySmtpSettings(admin, form())).rejects.toBeInstanceOf(RateLimitedError);
    await clearLimits();
  });

  // -------------------------------------------------------------------------
  // Send a test, and which settings win
  // -------------------------------------------------------------------------

  it("Send a test goes through the saved server, logged in, from the configured name — and is logged", async () => {
    await clearLimits();
    const result = await sendSmtpTestEmail(admin, "inbox@settingstest.example");
    expect(result).toEqual({ ok: true, message: "Test email sent to inbox@settingstest.example." });

    expect(envSink.received).toHaveLength(0);
    const mail = sink.last();
    expect(mail?.to).toEqual(["inbox@settingstest.example"]);
    expect(mail?.subject).toBe("SMTP Test Email");
    expect(mail?.body).toMatch(/^From: "?Emporia Settings"? <hello@settingstest\.example>/m);
    expect(mail?.body).toContain("Your SMTP configuration is working correctly.");
    expect(sink.lastAuthUser).toBe("mailer@sink.test");

    const log = await db.emailLog.findFirstOrThrow({ where: { to: "inbox@settingstest.example" }, orderBy: { createdAt: "desc" } });
    expect(log.status).toBe("SENT");
    expect(log.entityType).toBe("IntegrationSetting");
  });

  it("switched off, nothing is sent — not through the saved server and not through the environment either", async () => {
    await clearLimits();
    await saveEmailSettings(admin, form({ enabled: false, salesAddresses: SALES.join(", ") }));

    const result = await sendSmtpTestEmail(admin, "off@settingstest.example");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/switched off/);
    expect(sink.received).toHaveLength(0);
    expect(envSink.received).toHaveLength(0);

    const log = await db.emailLog.findFirstOrThrow({ where: { to: "off@settingstest.example" } });
    expect(log.status).toBe("FAILED");
    expect(log.error).toMatch(/switched off/);

    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", ") }));
  });

  it("a server that refuses the message is recorded as a failure in words", async () => {
    await clearLimits();
    sink.rejectAt = "DATA";
    const result = await sendSmtpTestEmail(admin, "refused@settingstest.example");
    expect(result).toEqual({ ok: false, message: "The server refused the message (554)." });
  });

  // -------------------------------------------------------------------------
  // The notification toggles
  // -------------------------------------------------------------------------

  it("lead captured on: one lead email to the whole sales list, replying to the lead, with the form details", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", "), notifyLeadCreated: true, notifyFormSubmission: false }));
    const leadId = await makeLead();

    await alertNewLead(leadId, { form: "Contact form", path: "/contact" });

    const mails = toSales();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to.sort()).toEqual([...SALES].sort());
    expect(mails[0]?.data).toMatch(new RegExp(`^Reply-To: asha-${SUFFIX}@lead\\.example`, "m"));
    expect(mails[0]?.data).toContain("Contact form");

    const logs = await logsFor(leadId);
    expect(logs.filter((log) => log.templateKey === "FORM_SUBMISSION")).toHaveLength(0);
    expect(logs.filter((log) => log.templateKey === "NEW_LEAD" && log.to.includes(SALES[0] as string))).toHaveLength(1);
    // The assignee still hears about it, separately.
    expect(logs.filter((log) => log.templateKey === "NEW_LEAD" && log.to === staffEmail)).toHaveLength(1);
  });

  it("both toggles on: still only one email to the sales list — the lead email", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", "), notifyLeadCreated: true, notifyFormSubmission: true }));
    const leadId = await makeLead();

    await alertNewLead(leadId, { form: "Contact form", path: "/contact" });

    expect(toSales()).toHaveLength(1);
    const logs = await logsFor(leadId);
    expect(logs.map((log) => log.templateKey).filter((key) => key === "FORM_SUBMISSION")).toEqual([]);
  });

  it("lead email off, submissions on: the form-submission email goes to the list, and staff get in-app only", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", "), notifyLeadCreated: false, notifyFormSubmission: true }));
    const leadId = await makeLead();

    await alertNewLead(leadId, { form: "Popup “Free audit”", path: "/services/seo" });

    const mails = toSales();
    expect(mails).toHaveLength(1);
    const log = await db.emailLog.findFirstOrThrow({ where: { entityId: leadId, templateKey: "FORM_SUBMISSION" } });
    expect(log.subject).toBe("New form submission: Popup “Free audit”");
    expect(log.status).toBe("SENT");
    expect(mails[0]?.data).toMatch(new RegExp(`^Reply-To: asha-${SUFFIX}@lead\\.example`, "m"));

    const logs = await logsFor(leadId);
    expect(logs.map((log) => log.templateKey)).toEqual(["FORM_SUBMISSION"]);
    expect(await db.notification.count({ where: { entityId: leadId, userId: staffId } })).toBe(1);
  });

  it("both off: no email at all, but the in-app notification still lands", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", "), notifyLeadCreated: false, notifyFormSubmission: false }));
    const leadId = await makeLead();

    await alertNewLead(leadId, null);

    expect(sink.received).toHaveLength(0);
    expect(await logsFor(leadId)).toEqual([]);
    expect(await db.notification.count({ where: { entityId: leadId, userId: staffId } })).toBe(1);
  });

  it("no sales addresses: the lead toggle still governs the assignee's copy", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: "", notifyLeadCreated: true }));
    const leadId = await makeLead();

    await alertNewLead(leadId, null);

    expect(sink.received.map((mail) => mail.to)).toEqual([[staffEmail]]);
  });

  it("an assignee who is also on the sales list gets one copy, not two", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: `${SALES[0]}, ${staffEmail.toUpperCase()}`, notifyLeadCreated: true }));
    const leadId = await makeLead();

    await alertNewLead(leadId, null);

    const copies = sink.received.filter((mail) => mail.to.map((to) => to.toLowerCase()).includes(staffEmail.toLowerCase()));
    expect(copies).toHaveLength(1);
  });

  it("the assignment email follows its toggle; the in-app notification does not", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", "), notifyLeadAssigned: false }));
    const quiet = await makeLead({ assignedToId: null });
    await alertLeadAssigned(quiet, staffId, "A Manager");
    expect(sink.received).toHaveLength(0);
    expect((await logsFor(quiet)).filter((log) => log.templateKey === "LEAD_ASSIGNED")).toEqual([]);
    expect(await db.notification.count({ where: { entityId: quiet, userId: staffId } })).toBe(1);

    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", "), notifyLeadAssigned: true }));
    const loud = await makeLead({ assignedToId: null });
    await alertLeadAssigned(loud, staffId, "A Manager");
    expect(sink.last()?.subject).toBe(`Asha ${SUFFIX} is now yours`);
    expect(sink.last()?.to).toEqual([staffEmail]);
  });

  it("a failing mail server never costs the lead: capture succeeds and the failure is logged", async () => {
    await saveEmailSettings(admin, form({ salesAddresses: SALES.join(", "), notifyLeadCreated: true }));
    sink.rejectAt = "MAIL";

    const { leadId } = await captureContactLead(
      {
        name: `Ravi ${SUFFIX}`,
        email: `ravi-${SUFFIX}@lead.example`,
        phone: "",
        company: "",
        serviceId: "",
        message: "Please call me about a website redesign.",
        website: "",
      },
      { landingPath: "/contact", referrer: null, device: "DESKTOP", ip: null, userAgent: "vitest" },
    );
    leadIds.push(leadId);

    expect(await db.lead.count({ where: { id: leadId } })).toBe(1);
    const salesLog = (await logsFor(leadId)).find((log) => log.to.includes(SALES[0] as string));
    expect(salesLog?.status).toBe("FAILED");
  });
});
