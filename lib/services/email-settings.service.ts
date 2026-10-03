import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ValidationError, RateLimitedError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { encryptSecret, decryptSecret } from "@/lib/security/secret";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { globals } from "@/lib/services/email.service";
import { providerFromSettings, readSmtpSettings, resolveMailer, type MailerSource } from "@/lib/email";
import {
  describeSmtpError,
  parseAddressList,
  SMTP_SETTING_KEY,
  type SmtpEncryption,
  type StoredSmtpSettings,
} from "@/lib/email/smtp-settings";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { SmtpSettingsInput } from "@/lib/validation/email";

/**
 * Settings → Email: the SMTP server, who hears about new activity, and the two
 * checks (connect; send for real).
 *
 * The password is write-only. It is encrypted before it is stored, decrypted
 * only to build a transport, and never returned, logged or audited — the safe
 * view below is the only shape that leaves this module.
 */

const settingsLog = log("email");

export type SafeEmailSettings = {
  host: string | null;
  port: number;
  username: string | null;
  encryption: SmtpEncryption;
  fromName: string;
  fromAddress: string | null;
  replyTo: string | null;
  enabled: boolean;
  passwordConfigured: boolean;
  salesAddresses: string[];
  notifyLeadCreated: boolean;
  notifyLeadAssigned: boolean;
  notifyFormSubmission: boolean;
  /** Where sending currently takes its settings from. */
  source: MailerSource;
  /** Whether anything has been saved here yet. */
  saved: boolean;
};

/** Built field by field from the stored row, so the ciphertext can never ride along. */
function toSafe(settings: StoredSmtpSettings & { saved: boolean }, source: MailerSource): SafeEmailSettings {
  return {
    host: settings.host,
    port: settings.port,
    username: settings.username,
    encryption: settings.encryption,
    fromName: settings.fromName,
    fromAddress: settings.fromAddress,
    replyTo: settings.replyTo,
    enabled: settings.enabled,
    passwordConfigured: Boolean(settings.password),
    salesAddresses: settings.salesAddresses,
    notifyLeadCreated: settings.notifyLeadCreated,
    notifyLeadAssigned: settings.notifyLeadAssigned,
    notifyFormSubmission: settings.notifyFormSubmission,
    source,
    saved: settings.saved,
  };
}

export async function getEmailSettings(actor: Actor): Promise<SafeEmailSettings> {
  requirePermission(actor, "emails.view");
  const [settings, { source }] = await Promise.all([readSmtpSettings(), resolveMailer()]);
  return toSafe(settings, source);
}

/** The audit's view of a save: what changed, and only whether the password did. */
function auditable(settings: StoredSmtpSettings) {
  const { password: _password, ...rest } = settings;
  return { ...rest, passwordConfigured: Boolean(settings.password) };
}

export async function saveEmailSettings(actor: Actor, input: SmtpSettingsInput): Promise<SafeEmailSettings> {
  requirePermission(actor, "settings.edit");

  const { addresses, invalid } = parseAddressList(input.salesAddresses);
  if (invalid.length > 0) {
    throw new ValidationError(`These are not email addresses: ${invalid.slice(0, 5).join(", ")}.`, {
      salesAddresses: [`Not email addresses: ${invalid.join(", ")}`],
    });
  }
  if (addresses.length > 20) throw new ValidationError("Use at most 20 notification addresses.");

  const before = await readSmtpSettings();
  // Blank keeps what is stored; "remove" clears it; anything else replaces it.
  const password = input.removePassword ? null : input.password ? encryptSecret(input.password) : before.password;

  const next: StoredSmtpSettings = {
    host: input.host,
    port: input.port,
    username: input.username,
    password,
    encryption: input.encryption,
    fromName: input.fromName,
    fromAddress: input.fromAddress,
    replyTo: input.replyTo,
    salesAddresses: addresses,
    notifyLeadCreated: input.notifyLeadCreated,
    notifyLeadAssigned: input.notifyLeadAssigned,
    notifyFormSubmission: input.notifyFormSubmission,
    enabled: input.enabled,
  };
  const { enabled, ...config } = next;

  await db.$transaction(async (tx) => {
    await tx.integrationSetting.upsert({
      where: { provider: SMTP_SETTING_KEY },
      create: { provider: SMTP_SETTING_KEY, config, isEnabled: enabled },
      update: { config, isEnabled: enabled },
    });
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "IntegrationSetting",
        entityId: SMTP_SETTING_KEY,
        before: auditable(before),
        after: { ...auditable(next), passwordChanged: password !== before.password },
      },
      tx,
    );
  });

  return getEmailSettings(actor);
}

async function limit(actor: Actor, what: string) {
  const result = await checkRateLimit(`smtp-${what}:${actor.userId}`, { limit: 5, windowMs: 60_000 });
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds, "Too many tries. Wait a minute and try again.");
}

/**
 * Test connection: connect and log in, send nothing.
 *
 * Tests what is in the form now, so a change can be checked before it is
 * saved; a blank password means the stored one.
 */
export async function verifySmtpSettings(actor: Actor, input: SmtpSettingsInput): Promise<{ ok: boolean; message: string }> {
  requirePermission(actor, "settings.edit");
  await limit(actor, "verify");
  if (!input.host) return { ok: false, message: "Enter an SMTP host first." };

  const stored = await readSmtpSettings();
  let password: string | null = null;
  if (input.password) password = input.password;
  else if (!input.removePassword && stored.password) {
    password = decryptSecret(stored.password);
    if (password === null) return { ok: false, message: "The saved password can no longer be read. Enter it again." };
  }
  if (input.username && !password) return { ok: false, message: "Enter the password to test logging in." };

  const provider = providerFromSettings(
    { ...stored, host: input.host, port: input.port, username: input.username, encryption: input.encryption, fromName: input.fromName, fromAddress: input.fromAddress, replyTo: input.replyTo },
    password,
  );
  try {
    await provider.verify();
    return { ok: true, message: "SMTP connection successful." };
  } catch (error) {
    // The code only: the full error can carry the server's reply to AUTH.
    settingsLog.warn({ code: (error as { code?: unknown })?.code, host: input.host, port: input.port }, "smtp verify failed");
    return { ok: false, message: describeSmtpError(error) };
  }
}

/** Send a test: a real message through the saved settings, recorded in the email log. */
export async function sendSmtpTestEmail(actor: Actor, to: string): Promise<{ ok: boolean; message: string }> {
  requirePermission(actor, "emails.send");
  await limit(actor, "test");

  const { provider } = await resolveMailer();
  const { siteName = "Emporia" } = await globals();
  const sentAt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date());
  const subject = "SMTP Test Email";
  const text = `This is a test email from ${siteName}.\n\nYour SMTP configuration is working correctly.\n\nSent ${sentAt} by ${actor.name}.`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1c22;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e7e9;">
<tr><td style="background:#002A3A;padding:16px 24px;color:#ffffff;font-size:16px;font-weight:600;">${escapeHtml(siteName)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55;"><p style="margin:0 0 12px;">This is a test email from ${escapeHtml(siteName)}.</p>
<p style="margin:0 0 12px;">Your SMTP configuration is working correctly.</p>
<p style="margin:0;color:#6b7a80;font-size:13px;">Sent ${escapeHtml(sentAt)} by ${escapeHtml(actor.name)}.</p></td></tr>
</table></td></tr></table></body></html>`;

  const row = await db.emailLog.create({
    data: { templateKey: null, to, subject, status: "QUEUED", entityType: "IntegrationSetting", entityId: SMTP_SETTING_KEY },
    select: { id: true },
  });
  try {
    const result = await provider.send({ to, subject, html, text });
    await db.emailLog.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.messageId } });
    await record({ actor, action: "SEND", entityType: "IntegrationSetting", entityId: SMTP_SETTING_KEY, after: { test: true, to } });
    return { ok: true, message: `Test email sent to ${to}.` };
  } catch (error) {
    const message = provider.configured ? describeSmtpError(error) : error instanceof Error ? (error as { publicMessage?: string }).publicMessage ?? error.message : "Email could not be sent.";
    await db.emailLog.update({ where: { id: row.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    return { ok: false, message };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
