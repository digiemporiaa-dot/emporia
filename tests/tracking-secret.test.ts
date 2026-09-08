import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/tracking/secret";

/**
 * Encryption at rest for the Conversions API token.
 *
 * The properties that matter are that a stored value is not the token, that it
 * round-trips, and that every failure mode returns null instead of throwing —
 * a bad stored secret must not take down the settings page.
 */

const TOKEN = `EAA${"x".repeat(40)}9zQ2`;

describe("secret storage", () => {
  it("round-trips a token", () => {
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
  });

  it("does not store the token in readable form", () => {
    const stored = encryptSecret(TOKEN);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(TOKEN.slice(0, 12));
    expect(Buffer.from(stored, "utf8").includes(TOKEN)).toBe(false);
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per encryption, so two identical tokens do not look identical
    // in the database.
    expect(encryptSecret(TOKEN)).not.toBe(encryptSecret(TOKEN));
  });

  it("returns null for a tampered ciphertext rather than a different token", () => {
    const parts = encryptSecret(TOKEN).split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    parts[3] = flipped.toString("base64url");
    expect(decryptSecret(parts.join("."))).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["plain text", "not-encrypted-at-all"],
    ["truncated", encryptSecret(TOKEN).split(".").slice(0, 3).join(".")],
    ["an unknown version", encryptSecret(TOKEN).replace(/^v1/, "v9")],
  ])("returns null for %s", (_label, stored) => {
    expect(decryptSecret(stored)).toBeNull();
  });
});

describe("masking", () => {
  it("reveals only the last four characters", () => {
    const masked = maskSecret(TOKEN);
    expect(masked).not.toBeNull();
    expect(masked!.endsWith(TOKEN.slice(-4))).toBe(true);
    expect(masked).not.toContain(TOKEN.slice(0, -4));
  });

  it("masks nothing when there is nothing stored", () => {
    expect(maskSecret(null)).toBeNull();
  });
});
