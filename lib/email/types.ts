import type { EmailTemplateKey } from "@/generated/prisma/enums";

/**
 * The mail provider contract.
 *
 * One service, one place that talks SMTP. Everything above it asks for a
 * template to be sent to an address; nothing else builds a message or opens a
 * connection (CLAUDE.md 3).
 */

export type OutgoingEmail = {
  to: string;
  cc?: string | null;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = {
  /** The provider's own id, kept on the log so a bounce can be traced back. */
  messageId: string | null;
};

export interface EmailProvider {
  readonly configured: boolean;
  send(email: OutgoingEmail): Promise<SendResult>;
  /** Prove the credentials work, for the settings screen. */
  verify(): Promise<void>;
}

/** What a template needs to render, declared so the admin editor can show it. */
export type TemplateVariables = Record<string, string>;

export type TemplateDefinition = {
  key: EmailTemplateKey;
  name: string;
  subject: string;
  html: string;
  text: string;
  /** Variable name to a one-line description. */
  variables: Record<string, string>;
};
