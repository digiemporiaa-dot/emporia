import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, clientIpFrom } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolvePermissions } from "@/lib/auth/rbac";
import { UnauthenticatedError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";
import type { RoleNameLiteral } from "@/lib/auth/permissions";

export * from "@/lib/actor/types";

/**
 * Assemble the Actor for the current request: identity read live from the
 * database, plus request metadata and permissions.
 *
 * **Only the user id is taken from the session.** Everything that decides what
 * the request may do — whether the account is still active, which role it
 * holds, which client it belongs to — is read from the database on every
 * request. Sessions are JWTs with an eight-hour life, so trusting the token for
 * any of that would mean:
 *
 *  - a suspended or deleted account keeps working until its token expires;
 *  - a demotion, or a move to another role, does not take effect until the user
 *    signs in again;
 *  - a portal user moved or revoked keeps reading their old client's data.
 *
 * The cost is one indexed lookup, deduped with `cache()` so a page that calls
 * this from several components pays for it once (CLAUDE.md 2 rules 2 and 3).
 */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      type: true,
      status: true,
      clientId: true,
      roleId: true,
      role: { select: { name: true } },
    },
  });

  // Deleted, suspended or still invited: the session is no longer a live
  // identity, so it is treated exactly as no session at all.
  if (!user || user.status !== "ACTIVE") return null;

  const h = await headers();
  const permissions = user.roleId ? await resolvePermissions(user.roleId) : new Set<string>();

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    type: user.type,
    roleName: (user.role?.name as RoleNameLiteral) ?? null,
    roleId: user.roleId,
    clientId: user.clientId,
    permissions,
    ip: clientIpFrom(h),
    userAgent: h.get("user-agent"),
  };
});

/**
 * Throws when there is no session. Use in **server actions and route
 * handlers**, where an exception is the right signal.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/**
 * Page equivalent: sends an unauthenticated visitor to the login screen.
 *
 * Pages must redirect rather than throw. A layout and its page render in
 * parallel, so if the layout issues a redirect while the page throws, the
 * thrown error reaches the error boundary first and the response is a rendered
 * 200 instead of a redirect — which would silently defeat the guard. Both sides
 * raising the same NEXT_REDIRECT signal keeps that consistent.
 */
export async function requireActorPage(redirectTo: string): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) {
    const target = redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/admin";
    redirect(`/auth/login?redirectTo=${encodeURIComponent(target)}`);
  }
  return actor;
}
