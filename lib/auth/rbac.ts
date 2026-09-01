import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import type { Permission } from "@/lib/auth/permissions";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Permission resolution and enforcement.
 *
 * Permissions are read from the database per request and are deliberately NOT
 * carried in the session token: CLAUDE.md 8 requires permission changes to take
 * effect without a deploy, and a JWT carrying a permission set would keep
 * granting a revoked permission until it expired (docs/ARCHITECTURE.md 9.2).
 *
 * Two caches keep that cheap:
 *   - `cache()` dedupes the lookup within a single request
 *   - a process-level map with a short TTL absorbs the rest, and is invalidated
 *     explicitly whenever RolePermission is written
 */

const TTL_MS = 30_000;

type Entry = { permissions: ReadonlySet<string>; expiresAt: number };
const roleCache = new Map<string, Entry>();

async function loadRolePermissions(roleId: string): Promise<ReadonlySet<string>> {
  const rows = await db.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return new Set(rows.map((r) => r.permission.key));
}

/** Request-deduped, TTL-cached permission set for a role. */
export const resolvePermissions = cache(
  async (roleId: string): Promise<ReadonlySet<string>> => {
    const hit = roleCache.get(roleId);
    if (hit && hit.expiresAt > Date.now()) return hit.permissions;

    const permissions = await loadRolePermissions(roleId);
    roleCache.set(roleId, { permissions, expiresAt: Date.now() + TTL_MS });
    return permissions;
  },
);

/** Called after any RolePermission write so a change takes effect immediately. */
export function invalidatePermissionCache(roleId?: string): void {
  if (roleId) roleCache.delete(roleId);
  else roleCache.clear();
}

export function isSuperAdmin(actor: Actor): boolean {
  return actor.roleName === "SUPER_ADMIN";
}

/**
 * Non-throwing check. Use for conditional rendering *in addition to*, never
 * instead of, a server-side `requirePermission` — hiding a button is not
 * authorization (CLAUDE.md 2 rule 2).
 */
export function can(actor: Actor, permission: Permission): boolean {
  if (isSuperAdmin(actor)) return true;
  return actor.permissions.has(permission);
}

export function canAny(actor: Actor, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(actor, p));
}

/** Throws ForbiddenError unless the actor holds the permission. */
export function requirePermission(actor: Actor | null, permission: Permission): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError();
  if (!can(actor, permission)) {
    throw new ForbiddenError("You do not have permission to do that.", { permission });
  }
}

export function requireAnyPermission(
  actor: Actor | null,
  permissions: readonly Permission[],
): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError();
  if (!canAny(actor, permissions)) {
    throw new ForbiddenError("You do not have permission to do that.", { permissions });
  }
}

export function requireStaff(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") {
    throw new ForbiddenError("This area is for staff only.");
  }
}

/**
 * Portal scoping. Unlike `requirePermission`, this has NO super-admin bypass:
 * client data isolation is absolute (CLAUDE.md 2 rule 3). A staff member who
 * needs a client's data reads it through the admin surface, which is audited.
 */
export function requireOwnership(actor: Actor | null, clientId: string): asserts actor is PortalActor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.type !== "CLIENT" || !actor.clientId) {
    throw new ForbiddenError("This resource belongs to a client account.");
  }
  if (actor.clientId !== clientId) {
    throw new ForbiddenError("Not found.");
  }
}

/** Narrows a general actor to a portal actor, for client-scoped services. */
export function requirePortalActor(actor: Actor | null): PortalActor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.type !== "CLIENT" || !actor.clientId) {
    throw new ForbiddenError("This area is for client accounts.");
  }
  return actor as PortalActor;
}
