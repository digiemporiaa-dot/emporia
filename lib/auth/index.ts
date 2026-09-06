import "server-only";
import NextAuth from "next-auth";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { burnPasswordComparison, verifyPassword } from "@/lib/auth/password";
import { buildAuthConfig, type AuthorizedUser } from "@/lib/auth/config";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import type { RoleNameLiteral } from "@/lib/auth/permissions";

const authLog = log("auth");

/**
 * Credential verification.
 *
 * Failures are deliberately indistinguishable to the caller — unknown email,
 * wrong password, suspended account and a passwordless (invited) user all
 * return null, so the login form cannot be used to enumerate accounts.
 */
async function authorize(
  credentials: { email: string; password: string },
  request: Request,
): Promise<AuthorizedUser | null> {
  const email = credentials.email.trim().toLowerCase();
  const ip = clientIpFrom(request.headers);

  // Rate limit on the IP and on the email separately: the first blunts
  // credential stuffing, the second blunts a distributed attack on one account.
  const byIp = await checkRateLimit(`login:ip:${ip ?? "unknown"}`, { limit: 10, windowMs: 60_000 });
  const byEmail = await checkRateLimit(`login:email:${email}`, { limit: 5, windowMs: 60_000 });
  if (!byIp.allowed || !byEmail.allowed) {
    authLog.warn({ email, ip }, "login rate limited");
    return null;
  }

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      type: true,
      status: true,
      passwordHash: true,
      clientId: true,
      roleId: true,
      role: { select: { name: true } },
    },
  });

  if (!user || !user.passwordHash || user.status !== "ACTIVE") {
    // Spend the same time an existing account would, so the response time does
    // not reveal whether the address is registered (CLAUDE.md 11).
    await burnPasswordComparison(credentials.password);
    authLog.info({ email, ip, reason: "no-active-user" }, "login failed");
    return null;
  }

  const ok = await verifyPassword(user.passwordHash, credentials.password);
  if (!ok) {
    authLog.info({ email, ip, reason: "bad-password" }, "login failed");
    return null;
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      ip,
      userAgent: request.headers.get("user-agent"),
    },
  });

  authLog.info({ userId: user.id }, "login succeeded");

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    type: user.type,
    roleId: user.roleId,
    roleName: user.role.name as RoleNameLiteral,
    clientId: user.clientId,
  };
}

/** Best-effort client IP from proxy headers. */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig(authorize));
