import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { record } from "@/lib/services/audit.service";
import { sendTemplate } from "@/lib/services/email.service";
import { env } from "@/lib/config/env";
import { log } from "@/lib/logger";

/**
 * Password reset.
 *
 * Three things this deliberately does not do:
 *
 *  - **It does not say whether an address exists.** `requestReset` returns the
 *    same thing either way. An endpoint that answers "no such account" is an
 *    account enumeration oracle, and it is unauthenticated.
 *  - **It does not store the token.** Only a SHA-256 of it is written, so a
 *    leaked database backup does not hand over live reset links. The plaintext
 *    exists only in the email.
 *  - **It does not leave the token usable.** It is cleared in the same update
 *    that sets the password, so a link cannot be replayed.
 *
 * Rate limiting is applied at the action, alongside login (CLAUDE.md 11).
 */

const resetLog = log("auth");

/** Long enough that guessing is not a strategy. */
const TOKEN_BYTES = 32;
const TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Start a reset.
 *
 * Always resolves. The caller shows the same message whatever happened here.
 */
export async function requestReset(email: string, ip: string | null): Promise<void> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true, status: true },
  });

  // A suspended or invited account is not a live login, so it gets no link —
  // and the caller is told nothing either way.
  if (!user || user.status !== "ACTIVE") {
    resetLog.info({ found: Boolean(user) }, "reset requested for a non-resettable address");
    return;
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expires = new Date(Date.now() + TTL_MS);

  await db.user.update({
    where: { id: user.id },
    data: { passwordResetToken: hashToken(token), passwordResetExpires: expires },
  });

  const url = `${env().SITE_URL.replace(/\/$/, "")}/auth/reset/${token}`;

  await sendTemplate("PASSWORD_RESET", {
    to: user.email,
    variables: {
      name: user.name,
      resetUrl: url,
      expiresAt: expires.toUTCString(),
    },
  });

  await record({
    actor: {
      userId: user.id,
      name: user.name,
      email: user.email,
      type: "STAFF",
      roleName: null,
      roleId: null,
      clientId: null,
      permissions: new Set<string>(),
      ip,
      userAgent: null,
    },
    action: "UPDATE",
    entityType: "User",
    entityId: user.id,
    // Never the token, not even the hash.
    after: { passwordResetRequested: true, expiresAt: expires.toISOString() },
  });

  resetLog.info({ userId: user.id }, "password reset link issued");
}

/** Whether a token is currently good, without revealing whose it is. */
export async function resetTokenIsValid(token: string): Promise<boolean> {
  if (!token || token.length < 20) return false;

  const user = await db.user.findFirst({
    where: {
      passwordResetToken: hashToken(token),
      passwordResetExpires: { gt: new Date() },
      status: "ACTIVE",
    },
    select: { id: true },
  });

  return Boolean(user);
}

/**
 * Complete a reset.
 *
 * The token is matched on its hash and cleared in the same update as the new
 * password, so it is single-use even if two requests race — the second finds
 * no row.
 */
export async function completeReset(
  token: string,
  password: string,
  ip: string | null,
): Promise<void> {
  const hashed = hashToken(token);

  const user = await db.user.findFirst({
    where: { passwordResetToken: hashed, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      email: true,
      passwordResetToken: true,
      passwordResetExpires: true,
    },
  });

  if (
    !user ||
    !user.passwordResetToken ||
    !user.passwordResetExpires ||
    user.passwordResetExpires < new Date() ||
    !safeEqual(user.passwordResetToken, hashed)
  ) {
    throw new ValidationError("That reset link has expired. Ask for a new one.");
  }

  const passwordHash = await hashPassword(password);

  const updated = await db.user.updateMany({
    // Matched on the token again: whichever request gets here first clears it,
    // and the loser updates nothing.
    where: { id: user.id, passwordResetToken: hashed },
    data: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
  });

  if (updated.count === 0) {
    throw new ValidationError("That reset link has already been used.");
  }

  await record({
    actor: {
      userId: user.id,
      name: user.name,
      email: user.email,
      type: "STAFF",
      roleName: null,
      roleId: null,
      clientId: null,
      permissions: new Set<string>(),
      ip,
      userAgent: null,
    },
    action: "UPDATE",
    entityType: "User",
    entityId: user.id,
    after: { passwordReset: true },
  });

  resetLog.info({ userId: user.id }, "password reset completed");
}
