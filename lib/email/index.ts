import "server-only";
import { db } from "@/lib/db";
import { smtpConfig } from "@/lib/config/env";
import { decryptSecret } from "@/lib/security/secret";
import { SmtpProvider, UnconfiguredEmail } from "@/lib/email/smtp";
import {
  formatFrom,
  parseStoredSmtp,
  SMTP_SETTING_KEY,
  SMTP_TIMEOUTS,
  tlsOptions,
  type StoredSmtpSettings,
} from "@/lib/email/smtp-settings";
import type { EmailProvider } from "@/lib/email/types";

export type { EmailProvider, OutgoingEmail, SendResult, TemplateDefinition } from "@/lib/email/types";

/**
 * The mail provider, resolved for each send.
 *
 * Settings saved in admin (Settings → Email) win over the `SMTP_*`
 * environment, so a non-technical admin can change SMTP without a redeploy;
 * the environment stays as the bootstrap fallback, so a deployment that has
 * never opened the screen keeps sending exactly as before. Read from the
 * database each time — one small row — so a save takes effect on every
 * instance at once rather than whenever a cache expires.
 */

export type MailerSource = "database" | "environment" | "none";

/** The saved row, or the defaults when nothing has been saved. */
export async function readSmtpSettings(): Promise<StoredSmtpSettings & { saved: boolean }> {
  const row = await db.integrationSetting.findUnique({
    where: { provider: SMTP_SETTING_KEY },
    select: { config: true, isEnabled: true },
  });
  return { ...parseStoredSmtp(row?.config ?? null, row?.isEnabled ?? false), saved: Boolean(row) };
}

/** A transport from saved settings. `password` is already decrypted (or null). */
export function providerFromSettings(settings: StoredSmtpSettings, password: string | null): SmtpProvider {
  return new SmtpProvider({
    transport: {
      host: settings.host ?? "",
      port: settings.port,
      ...tlsOptions(settings.encryption),
      ...(settings.username ? { auth: { user: settings.username, pass: password ?? "" } } : {}),
      ...SMTP_TIMEOUTS,
    },
    from: formatFrom(settings.fromName, settings.fromAddress ?? ""),
    replyTo: settings.replyTo,
  });
}

let envCached: EmailProvider | null = null;

function envProvider(): EmailProvider {
  if (!envCached) {
    const config = smtpConfig();
    envCached = config
      ? new SmtpProvider({
          transport: {
            host: config.host,
            port: config.port,
            secure: config.secure,
            ...(config.user && config.password ? { auth: { user: config.user, pass: config.password } } : {}),
            ...SMTP_TIMEOUTS,
          },
          from: config.from,
        })
      : new UnconfiguredEmail();
  }
  return envCached;
}

/** The provider to send through right now, and where its settings came from. */
export async function resolveMailer(): Promise<{ provider: EmailProvider; source: MailerSource }> {
  const settings = await readSmtpSettings();
  if (settings.host) {
    if (!settings.enabled) {
      return { provider: new UnconfiguredEmail("Email sending is switched off in Settings → Email."), source: "database" };
    }
    if (!settings.fromAddress) {
      return { provider: new UnconfiguredEmail("Email is not configured: there is no From address in Settings → Email."), source: "database" };
    }
    const password = settings.password ? decryptSecret(settings.password) : null;
    if (settings.password && password === null) {
      // The app secret changed since it was saved. Sending without the
      // password would fail anyway; say why instead.
      return {
        provider: new UnconfiguredEmail("Email is not configured: the saved SMTP password can no longer be read. Enter it again in Settings → Email."),
        source: "database",
      };
    }
    return { provider: providerFromSettings(settings, password), source: "database" };
  }
  const provider = envProvider();
  return { provider, source: provider.configured ? "environment" : "none" };
}

/** Test seam: drop the memoised environment provider so a changed environment is re-read. */
export function resetMailer(): void {
  envCached = null;
}
