import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { sanitizeSnapshot } from "@/lib/services/audit.service";

/**
 * An audit log that captures a password hash turns the safety feature into a
 * liability, so redaction is tested rather than assumed.
 */
describe("audit snapshot sanitisation", () => {
  it("redacts credentials at the top level", () => {
    const out = sanitizeSnapshot({
      id: "u1",
      email: "a@b.com",
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$abc",
    }) as Record<string, unknown>;

    expect(out["email"]).toBe("a@b.com");
    expect(out["passwordHash"]).toBe("[redacted]");
  });

  it("redacts nested credentials and tokens", () => {
    const out = sanitizeSnapshot({
      user: { name: "A", passwordResetToken: "tok_123", inviteToken: "inv_456" },
      payment: { gatewaySignature: "sig_789", amount: "100.00" },
    }) as Record<string, Record<string, unknown>>;

    expect(out["user"]?.["name"]).toBe("A");
    expect(out["user"]?.["passwordResetToken"]).toBe("[redacted]");
    expect(out["user"]?.["inviteToken"]).toBe("[redacted]");
    expect(out["payment"]?.["gatewaySignature"]).toBe("[redacted]");
    expect(out["payment"]?.["amount"]).toBe("100.00");
  });

  it("redacts OAuth credentials, whatever row they arrive on", () => {
    const out = sanitizeSnapshot({
      account: { name: "Northwind on LinkedIn", accessToken: "AQV-live", refreshToken: "AQX-live", tokenExpiresAt: "2026-11-01" },
      settings: { clientId: "li-app", clientSecret: "shh" },
      pending: { credentials: "{\"accessToken\":\"AQV\"}" },
    }) as Record<string, Record<string, unknown>>;

    expect(out["account"]?.["name"]).toBe("Northwind on LinkedIn");
    expect(out["account"]?.["accessToken"]).toBe("[redacted]");
    expect(out["account"]?.["refreshToken"]).toBe("[redacted]");
    // When it expires is not a secret, and is what the trail is for.
    expect(out["account"]?.["tokenExpiresAt"]).toBe("2026-11-01");
    expect(out["settings"]?.["clientId"]).toBe("li-app");
    expect(out["settings"]?.["clientSecret"]).toBe("[redacted]");
    expect(out["pending"]?.["credentials"]).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toContain("live");
  });

  it("redacts inside arrays", () => {
    const out = sanitizeSnapshot([{ password: "hunter2" }, { password: "hunter3" }]) as Record<
      string,
      unknown
    >[];
    expect(out[0]?.["password"]).toBe("[redacted]");
    expect(out[1]?.["password"]).toBe("[redacted]");
  });

  it("serialises Decimal money without losing precision", () => {
    const out = sanitizeSnapshot({ total: new Decimal("12345.67") }) as Record<string, unknown>;
    expect(out["total"]).toBe("12345.67");
  });

  it("serialises Prisma's Decimal too, which is a different class", () => {
    const out = sanitizeSnapshot({ total: new Prisma.Decimal("99999999.99") }) as Record<
      string,
      unknown
    >;
    expect(out["total"]).toBe("99999999.99");
  });

  it("does not shred a Decimal into its internal representation", () => {
    const out = sanitizeSnapshot({ total: new Decimal("1.5") }) as Record<string, unknown>;
    expect(out["total"]).not.toHaveProperty("d");
    expect(typeof out["total"]).toBe("string");
  });

  it("serialises dates to ISO strings", () => {
    const out = sanitizeSnapshot({ at: new Date("2026-01-02T03:04:05.000Z") }) as Record<string, unknown>;
    expect(out["at"]).toBe("2026-01-02T03:04:05.000Z");
  });

  it("passes through null and undefined untouched", () => {
    expect(sanitizeSnapshot(null)).toBeNull();
    expect(sanitizeSnapshot(undefined)).toBeUndefined();
  });
});
