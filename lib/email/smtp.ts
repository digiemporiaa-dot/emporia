import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { smtpConfig } from "@/lib/config/env";
import { IntegrationNotConfiguredError } from "@/lib/errors";
import type { EmailProvider, OutgoingEmail, SendResult } from "@/lib/email/types";

/**
 * SMTP, through nodemailer.
 *
 * Credentials are read once, server-side, from lib/config/env. Nothing here is
 * ever sent to the browser (CLAUDE.md 2 rule 6).
 */
export class SmtpProvider implements EmailProvider {
  readonly configured = true;

  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: NonNullable<ReturnType<typeof smtpConfig>>) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user && config.password
        ? { auth: { user: config.user, pass: config.password } }
        : {}),
    });
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: email.to,
      ...(email.cc ? { cc: email.cc } : {}),
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    return { messageId: info.messageId ?? null };
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}

/**
 * No mail provider configured.
 *
 * Every call throws a typed error rather than returning success. A system that
 * silently swallows email is worse than one that refuses: the sender believes
 * the client was told (CLAUDE.md 2 rule 5).
 */
export class UnconfiguredEmail implements EmailProvider {
  readonly configured = false;

  private fail(): never {
    throw new IntegrationNotConfiguredError(
      "Email is not configured. Set the SMTP_* environment variables.",
    );
  }

  async send(): Promise<SendResult> {
    this.fail();
  }

  async verify(): Promise<void> {
    this.fail();
  }
}
