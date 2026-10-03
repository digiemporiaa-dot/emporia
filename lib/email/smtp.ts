import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { AppError } from "@/lib/errors";
import type { EmailProvider, OutgoingEmail, SendResult } from "@/lib/email/types";

/**
 * SMTP, through nodemailer.
 *
 * Built from the settings an admin saved (Settings → Email), or from the
 * `SMTP_*` environment when nothing has been saved. Either way the password is
 * decrypted only here, server-side, at the moment of building the transport;
 * nothing reaches the browser (CLAUDE.md 2 rule 6), and nothing here logs it.
 */
export class SmtpProvider implements EmailProvider {
  readonly configured = true;

  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly replyTo: string | null;

  constructor(options: { transport: SMTPTransport.Options; from: string; replyTo?: string | null }) {
    this.from = options.from;
    this.replyTo = options.replyTo ?? null;
    this.transporter = nodemailer.createTransport(options.transport);
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const replyTo = email.replyTo || this.replyTo;
    const info = await this.transporter.sendMail({
      from: this.from,
      to: email.to,
      ...(email.cc ? { cc: email.cc } : {}),
      ...(replyTo ? { replyTo } : {}),
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

/** Why nothing can be sent right now, in words the email log and the screen can show. */
export class EmailUnavailableError extends AppError {
  constructor(reason: string) {
    super("INTEGRATION_NOT_CONFIGURED", 503, reason);
  }
}

/**
 * No mail can be sent: not configured, switched off, or the stored password
 * unreadable.
 *
 * Every call throws rather than returning success. A system that silently
 * swallows email is worse than one that refuses: the sender believes the
 * client was told (CLAUDE.md 2 rule 5).
 */
export class UnconfiguredEmail implements EmailProvider {
  readonly configured = false;

  constructor(
    private readonly reason = "Email is not configured. Add the SMTP settings in Settings → Email.",
  ) {}

  private fail(): never {
    throw new EmailUnavailableError(this.reason);
  }

  async send(): Promise<SendResult> {
    this.fail();
  }

  async verify(): Promise<void> {
    this.fail();
  }
}
