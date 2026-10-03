import { describe, expect, it } from "vitest";
import {
  describeSmtpError,
  formatFrom,
  parseAddressList,
  parseStoredSmtp,
  SMTP_DEFAULTS,
  tlsOptions,
} from "@/lib/email/smtp-settings";
import { smtpSettingsSchema } from "@/lib/validation/email";

/**
 * Settings → Email, the pure half: what the form accepts, how a stored row is
 * read back, how each encryption choice maps onto the transport, and the
 * sentence an admin sees when the server says no.
 */

const base = {
  host: "smtp.example.com",
  port: "465",
  username: "mailer@example.com",
  password: "",
  encryption: "SSL_TLS",
  fromName: "Emporia",
  fromAddress: "hello@example.com",
  replyTo: "",
  enabled: true,
  salesAddresses: "",
};

describe("the SMTP settings form", () => {
  it("accepts a complete form, lowercasing the host and coercing the port", () => {
    const parsed = smtpSettingsSchema.parse({ ...base, host: "SMTP.Example.com" });
    expect(parsed.host).toBe("smtp.example.com");
    expect(parsed.port).toBe(465);
    expect(parsed.replyTo).toBeNull();
  });

  it("turns blank optional fields into null rather than empty strings", () => {
    const parsed = smtpSettingsSchema.parse({ ...base, enabled: false, host: "", username: "", fromAddress: "" });
    expect(parsed.host).toBeNull();
    expect(parsed.username).toBeNull();
    expect(parsed.fromAddress).toBeNull();
  });

  it("refuses to switch sending on without a host, From address and From name", () => {
    const result = smtpSettingsSchema.safeParse({ ...base, host: "", fromAddress: "", fromName: "" });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join(".")).sort();
    expect(paths).toEqual(["fromAddress", "fromName", "host"]);
  });

  it("saves an incomplete form while sending stays off", () => {
    expect(smtpSettingsSchema.safeParse({ ...base, enabled: false, host: "", fromAddress: "" }).success).toBe(true);
  });

  it("wants the host name only — no scheme, no spaces", () => {
    expect(smtpSettingsSchema.safeParse({ ...base, host: "smtp://smtp.example.com" }).success).toBe(false);
    expect(smtpSettingsSchema.safeParse({ ...base, host: "smtp example.com" }).success).toBe(false);
  });

  it("keeps the port in range", () => {
    expect(smtpSettingsSchema.safeParse({ ...base, port: "0" }).success).toBe(false);
    expect(smtpSettingsSchema.safeParse({ ...base, port: "65536" }).success).toBe(false);
    expect(smtpSettingsSchema.safeParse({ ...base, port: "587" }).success).toBe(true);
  });

  it("refuses a line break in the From name, which would let it write headers", () => {
    expect(smtpSettingsSchema.safeParse({ ...base, fromName: "Emporia\r\nBcc: someone@evil.test" }).success).toBe(false);
  });

  it("refuses an encryption setting it does not know", () => {
    expect(smtpSettingsSchema.safeParse({ ...base, encryption: "SSLv3" }).success).toBe(false);
  });
});

describe("the notification address list", () => {
  it("splits on commas, semicolons and new lines, trimming each", () => {
    expect(parseAddressList(" a@x.com, b@x.com;c@x.com\nd@x.com ").addresses).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
  });

  it("drops duplicates case-insensitively, keeping the first spelling and the order", () => {
    expect(parseAddressList("Sales@x.com, ops@x.com, sales@X.com").addresses).toEqual(["Sales@x.com", "ops@x.com"]);
  });

  it("names the entries that are not addresses instead of dropping them silently", () => {
    expect(parseAddressList("a@x.com, nope, b@x, ,c@x.com")).toEqual({ addresses: ["a@x.com", "c@x.com"], invalid: ["nope", "b@x"] });
  });

  it("an empty list is empty, not an error", () => {
    expect(parseAddressList("  ,\n ")).toEqual({ addresses: [], invalid: [] });
  });
});

describe("a stored row read back", () => {
  it("falls back to the defaults when nothing has been saved", () => {
    expect(parseStoredSmtp(null, false)).toEqual(SMTP_DEFAULTS);
  });

  it("keeps the lead toggles on by default, so an environment-only deployment keeps its alerts", () => {
    expect(SMTP_DEFAULTS.notifyLeadCreated).toBe(true);
    expect(SMTP_DEFAULTS.notifyLeadAssigned).toBe(true);
    expect(SMTP_DEFAULTS.notifyFormSubmission).toBe(false);
  });

  it("ignores malformed fields instead of trusting them", () => {
    const parsed = parseStoredSmtp(
      { host: 42, port: "587", encryption: "ROT13", salesAddresses: ["a@x.com", 7], notifyLeadCreated: "yes" },
      true,
    );
    expect(parsed.host).toBeNull();
    expect(parsed.port).toBe(SMTP_DEFAULTS.port);
    expect(parsed.encryption).toBe(SMTP_DEFAULTS.encryption);
    expect(parsed.salesAddresses).toEqual(["a@x.com"]);
    expect(parsed.notifyLeadCreated).toBe(true);
    expect(parsed.enabled).toBe(true);
  });

  it("takes `enabled` from the row's switch, not from the JSON", () => {
    expect(parseStoredSmtp({ host: "smtp.x.com", enabled: true }, false).enabled).toBe(false);
  });
});

describe("encryption choices", () => {
  it("SSL/TLS is TLS from the first byte", () => {
    expect(tlsOptions("SSL_TLS")).toEqual({ secure: true });
  });

  it("STARTTLS requires the upgrade — it never quietly continues in the clear", () => {
    expect(tlsOptions("STARTTLS")).toEqual({ secure: false, requireTLS: true });
  });

  it("None never upgrades", () => {
    expect(tlsOptions("NONE")).toEqual({ secure: false, ignoreTLS: true });
  });
});

describe("the From header", () => {
  it("quotes the display name", () => {
    expect(formatFrom("Emporia, Digital", "hello@x.com")).toBe('"Emporia, Digital" <hello@x.com>');
  });

  it("strips quotes and backslashes that could break out of the quoting", () => {
    expect(formatFrom('Em"po\\ria', "hello@x.com")).toBe('"Emporia" <hello@x.com>');
  });

  it("is the bare address when there is no name", () => {
    expect(formatFrom("  ", "hello@x.com")).toBe("hello@x.com");
  });
});

describe("SMTP errors, in words", () => {
  it.each([
    [{ code: "EAUTH", responseCode: 535 }, /authentication failed/i],
    [{ responseCode: 534 }, /authentication failed/i],
    [{ responseCode: 530 }, /requires a username and password/i],
    [{ code: "EDNS", message: "getaddrinfo ENOTFOUND smtp.nowhere" }, /could not be found/i],
    [{ code: "ESOCKET", message: "connect ECONNREFUSED 127.0.0.1:2525" }, /refused the connection/i],
    [{ code: "ETIMEDOUT", message: "Connection timeout" }, /did not answer in time/i],
    [{ code: "ETLS", message: "wrong version number" }, /secure connection/i],
    [{ code: "ESOCKET", message: "socket hang up" }, /connection to the server failed/i],
    [{ responseCode: 554 }, /refused the message \(554\)/],
    [{ code: "EWHATEVER" }, /\(EWHATEVER\)/],
  ])("%o reads as %s", (error, expected) => {
    expect(describeSmtpError(error)).toMatch(expected);
  });

  it("never echoes the raw server message, which can carry the username", () => {
    const sentence = describeSmtpError({ code: "EAUTH", message: "535 Invalid login for mailer@example.com" });
    expect(sentence).not.toContain("mailer@example.com");
  });

  it("copes with something that is not an error at all", () => {
    expect(describeSmtpError(undefined)).toBe("The SMTP connection failed.");
  });
});
