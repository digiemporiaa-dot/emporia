import "server-only";
import { smtpConfig } from "@/lib/config/env";
import { SmtpProvider, UnconfiguredEmail } from "@/lib/email/smtp";
import type { EmailProvider } from "@/lib/email/types";

export type { EmailProvider, OutgoingEmail, SendResult, TemplateDefinition } from "@/lib/email/types";

/**
 * The mail provider for this deployment.
 *
 * Resolved lazily and cached, so `next build` needs no credentials and a
 * deployment without SMTP still boots — it records every attempted send as
 * FAILED with the reason, which is visible in admin.
 */
let cached: EmailProvider | null = null;

export function mailer(): EmailProvider {
  if (!cached) {
    const config = smtpConfig();
    cached = config ? new SmtpProvider(config) : new UnconfiguredEmail();
  }
  return cached;
}

export function isEmailConfigured(): boolean {
  return mailer().configured;
}

/** Test seam: drop the memoised provider so a changed environment is re-read. */
export function resetMailer(): void {
  cached = null;
}
