import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, clientIpFrom } from "@/lib/auth";
import { resolvePermissions } from "@/lib/auth/rbac";
import { UnauthenticatedError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";
import type { RoleNameLiteral } from "@/lib/auth/permissions";

export * from "@/lib/actor/types";

/**
 * Assemble the Actor for the current request: session identity plus request
 * metadata, with permissions resolved live from the database.
 *
 * Deduped with `cache()` so a page that calls it from several components pays
 * for one lookup.
 */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  const h = await headers();
  const roleId = session.user.roleId || null;
  const permissions = roleId ? await resolvePermissions(roleId) : new Set<string>();

  return {
    userId: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? null,
    type: session.user.type,
    roleName: (session.user.roleName as RoleNameLiteral) || null,
    roleId,
    clientId: session.user.clientId,
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
