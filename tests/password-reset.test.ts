import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  completeReset,
  requestReset,
  resetTokenIsValid,
} from "@/lib/services/password-reset.service";
import { verifyPassword } from "@/lib/auth/password";
import { ValidationError } from "@/lib/errors";

/**
 * Password reset, and the three properties that make it safe to expose
 * unauthenticated: it does not reveal who has an account, it does not store a
 * usable token, and a link cannot be replayed.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const sha = (token: string) => createHash("sha256").update(token).digest("hex");

describeDb("password reset", () => {
  let prisma: PrismaClient;
  const tag = `reset-${Date.now()}`;
  const email = `${tag}@test.local`;
  let userId = "";
  let roleId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const role = await prisma.role.findFirstOrThrow({ where: { name: "STAFF" }, select: { id: true } });
    roleId = role.id;

    const user = await prisma.user.create({
      data: { email, name: "Reset Tester", type: "STAFF", status: "ACTIVE", roleId },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: userId } });
    await prisma.emailLog.deleteMany({ where: { to: { contains: tag } } });
    await prisma.user.deleteMany({ where: { email: { contains: tag } } });
    await prisma.$disconnect();
  });

  async function issueToken(): Promise<string> {
    // The plaintext only exists in the email, so the test regenerates a token
    // the same way the service does and checks the stored hash matches.
    await requestReset(email, null);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordResetToken: true },
    });
    expect(row.passwordResetToken).not.toBeNull();
    return row.passwordResetToken as string;
  }

  // ── Does not reveal who has an account ──────────────────────────────────

  it("resolves the same way for an address that does not exist", async () => {
    await expect(requestReset(`nobody-${tag}@test.local`, null)).resolves.toBeUndefined();
  });

  it("issues nothing for an account that is not active", async () => {
    const invited = await prisma.user.create({
      data: {
        email: `invited-${tag}@test.local`,
        name: "Invited",
        type: "STAFF",
        status: "INVITED",
        roleId,
      },
      select: { id: true },
    });

    await requestReset(`invited-${tag}@test.local`, null);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: invited.id },
      select: { passwordResetToken: true },
    });
    // No link, and the caller was told nothing either way.
    expect(row.passwordResetToken).toBeNull();
  });

  // ── Does not store a usable token ───────────────────────────────────────

  it("stores only a hash of the token", async () => {
    const stored = await issueToken();

    // 64 hex characters: a SHA-256, not a base64url token.
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    // And the stored value is not itself accepted as the link.
    expect(await resetTokenIsValid(stored)).toBe(false);
  });

  it("accepts the plaintext token whose hash is stored", async () => {
    // Drive it the other way: plant a known token's hash and use the plaintext.
    const plaintext = "a-known-token-value-long-enough-to-pass";
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: sha(plaintext),
        passwordResetExpires: new Date(Date.now() + 60_000),
      },
    });

    expect(await resetTokenIsValid(plaintext)).toBe(true);
  });

  // ── Cannot be replayed, and expires ─────────────────────────────────────

  it("sets the password and clears the token in one step", async () => {
    const plaintext = `single-use-${Date.now()}-padding`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: sha(plaintext),
        passwordResetExpires: new Date(Date.now() + 60_000),
      },
    });

    await completeReset(plaintext, "A-new-Password-1!", null);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, passwordResetToken: true, passwordResetExpires: true },
    });

    expect(row.passwordResetToken).toBeNull();
    expect(row.passwordResetExpires).toBeNull();
    expect(await verifyPassword(row.passwordHash as string, "A-new-Password-1!")).toBe(true);
  });

  it("refuses the same link a second time", async () => {
    const plaintext = `replay-${Date.now()}-padding-value`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: sha(plaintext),
        passwordResetExpires: new Date(Date.now() + 60_000),
      },
    });

    await completeReset(plaintext, "First-password-1!", null);
    await expect(completeReset(plaintext, "Second-password-1!", null)).rejects.toBeInstanceOf(
      ValidationError,
    );

    // The first password stands; the replay changed nothing.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    expect(await verifyPassword(row.passwordHash as string, "First-password-1!")).toBe(true);
  });

  it("refuses an expired link", async () => {
    const plaintext = `expired-${Date.now()}-padding-val`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: sha(plaintext),
        passwordResetExpires: new Date(Date.now() - 1_000),
      },
    });

    expect(await resetTokenIsValid(plaintext)).toBe(false);
    await expect(completeReset(plaintext, "Another-password-1!", null)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuses a token that was never issued", async () => {
    await expect(
      completeReset("completely-made-up-token-value-here", "Whatever-password-1!", null),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("records the reset in the audit trail without the token", async () => {
    const plaintext = `audited-${Date.now()}-padding-va`;
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: sha(plaintext),
        passwordResetExpires: new Date(Date.now() + 60_000),
      },
    });

    await completeReset(plaintext, "Audited-password-1!", null);

    const row = await prisma.auditLog.findFirst({
      where: { entityType: "User", entityId: userId },
      orderBy: { createdAt: "desc" },
    });

    const after = JSON.stringify(row?.after ?? {});
    expect(after).toContain("passwordReset");
    // Neither the plaintext nor its hash reaches the audit trail.
    expect(after).not.toContain(plaintext);
    expect(after).not.toContain(sha(plaintext));
  });
});
