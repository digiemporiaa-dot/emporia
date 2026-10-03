/**
 * SMTP settings as an admin enters them (Settings → Email), and how they map
 * onto a transport.
 *
 * Stored in `IntegrationSetting` under the key `smtp` — the same row shape the
 * AI provider, the Meta Conversions API and the social apps use — with the
 * password encrypted by `lib/security/secret` and every other field plain.
 * Pure functions only: no database, no secrets decrypted here.
 */

export const SMTP_SETTING_KEY = "smtp";

export const SMTP_ENCRYPTIONS = ["SSL_TLS", "STARTTLS", "NONE"] as const;
export type SmtpEncryption = (typeof SMTP_ENCRYPTIONS)[number];

export const SMTP_ENCRYPTION_LABEL: Record<SmtpEncryption, string> = {
  SSL_TLS: "SSL/TLS (usually port 465)",
  STARTTLS: "STARTTLS (usually port 587)",
  NONE: "None",
};

/** What the `config` JSON holds. `password` is ciphertext, or null. */
export type StoredSmtpSettings = {
  host: string | null;
  port: number;
  username: string | null;
  password: string | null;
  encryption: SmtpEncryption;
  fromName: string;
  fromAddress: string | null;
  replyTo: string | null;
  salesAddresses: string[];
  notifyLeadCreated: boolean;
  notifyLeadAssigned: boolean;
  notifyFormSubmission: boolean;
  enabled: boolean;
};

/**
 * Before anyone has saved the form. The lead toggles default on, so a
 * deployment that has only ever used the `SMTP_*` environment keeps sending
 * what it sent before; the submission toggle defaults off.
 */
export const SMTP_DEFAULTS: StoredSmtpSettings = {
  host: null,
  port: 587,
  username: null,
  password: null,
  encryption: "STARTTLS",
  fromName: "",
  fromAddress: null,
  replyTo: null,
  salesAddresses: [],
  notifyLeadCreated: true,
  notifyLeadAssigned: true,
  notifyFormSubmission: false,
  enabled: false,
};

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** Read a stored row defensively: anything malformed falls back to the default. */
export function parseStoredSmtp(config: unknown, isEnabled: boolean): StoredSmtpSettings {
  const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const port = typeof c["port"] === "number" && Number.isInteger(c["port"]) ? (c["port"] as number) : SMTP_DEFAULTS.port;
  const encryption = SMTP_ENCRYPTIONS.includes(c["encryption"] as SmtpEncryption) ? (c["encryption"] as SmtpEncryption) : SMTP_DEFAULTS.encryption;
  return {
    host: str(c["host"]),
    port,
    username: str(c["username"]),
    password: str(c["password"]),
    encryption,
    fromName: str(c["fromName"]) ?? "",
    fromAddress: str(c["fromAddress"]),
    replyTo: str(c["replyTo"]),
    salesAddresses: Array.isArray(c["salesAddresses"]) ? (c["salesAddresses"] as unknown[]).filter((a): a is string => typeof a === "string") : [],
    notifyLeadCreated: bool(c["notifyLeadCreated"], SMTP_DEFAULTS.notifyLeadCreated),
    notifyLeadAssigned: bool(c["notifyLeadAssigned"], SMTP_DEFAULTS.notifyLeadAssigned),
    notifyFormSubmission: bool(c["notifyFormSubmission"], SMTP_DEFAULTS.notifyFormSubmission),
    enabled: isEnabled,
  };
}

/**
 * Nodemailer's TLS options for each choice.
 *
 * - SSL/TLS: TLS from the first byte (port 465).
 * - STARTTLS: plain connect, then *required* upgrade — refusing to continue
 *   unencrypted if the server does not offer it.
 * - None: never upgrade. Only for relays on a trusted network.
 */
export function tlsOptions(encryption: SmtpEncryption): { secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean } {
  switch (encryption) {
    case "SSL_TLS":
      return { secure: true };
    case "STARTTLS":
      return { secure: false, requireTLS: true };
    case "NONE":
      return { secure: false, ignoreTLS: true };
  }
}

/** A dead host must not hang a request: connect, greeting and idle limits. */
export const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 } as const;

/** `"Name" <address>`, with the display name quoted so a comma or quote in it cannot split the header. */
export function formatFrom(fromName: string, fromAddress: string): string {
  const name = fromName.replace(/["\\]/g, "").trim();
  return name ? `"${name}" <${fromAddress}>` : fromAddress;
}

/**
 * A comma- or newline-separated list of addresses: trimmed, de-duplicated
 * case-insensitively keeping the first spelling and order. Returns the
 * entries that are not addresses separately, so the form can name them.
 */
export function parseAddressList(raw: string): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n;]/)) {
    const value = part.trim();
    if (!value) continue;
    if (!EMAIL.test(value)) {
      invalid.push(value);
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(value);
  }
  return { addresses, invalid };
}

/** Deliberately plain: one @, something either side, a dot in the domain, no spaces. */
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/**
 * A human sentence for an SMTP failure (Test connection, Send test).
 *
 * Read from Nodemailer's `code` and the server's response code — never the
 * raw message alone, which can echo the command (and with it the username).
 */
export function describeSmtpError(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown; cause?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const response = typeof e.responseCode === "number" ? e.responseCode : null;
  const message = typeof e.message === "string" ? e.message : "";

  if (code === "EAUTH" || response === 535 || response === 534) {
    return "SMTP authentication failed. Please check your username and password.";
  }
  if (response === 530) return "The server requires a username and password.";
  if (code === "ENOTFOUND" || code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(message)) {
    return "That SMTP host could not be found. Check the host name.";
  }
  if (/ECONNREFUSED/.test(message) || code === "ECONNREFUSED") {
    return "The server refused the connection. Check the host and port.";
  }
  if (code === "ETIMEDOUT" || /timeout|timed out/i.test(message)) {
    return "The server did not answer in time. Check the host, port and any firewall.";
  }
  if (code === "ETLS" || /certificate|wrong version number|SSL|TLS/i.test(message)) {
    return "A secure connection could not be made. Check that the encryption setting matches the port (SSL/TLS for 465, STARTTLS for 587).";
  }
  if (code === "ECONNECTION" || code === "ESOCKET") {
    return "The connection to the server failed. Check the host, port and encryption.";
  }
  if (response && response >= 500) return `The server refused the message (${response}).`;
  return code ? `The SMTP connection failed (${code}).` : "The SMTP connection failed.";
}
