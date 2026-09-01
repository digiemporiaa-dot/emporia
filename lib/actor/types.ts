import type { RoleNameLiteral } from "@/lib/auth/permissions";

/**
 * The authenticated caller, assembled once per request and passed explicitly
 * into every service function.
 *
 * Services never read the session themselves (docs/ARCHITECTURE.md 8): they
 * receive an Actor and re-check ownership. That keeps them testable without a
 * request context, and lets cron jobs and automations run the same code paths
 * with a SYSTEM actor — audited like any other.
 */
export type ActorType = "STAFF" | "CLIENT" | "SYSTEM";

export type Actor = {
  userId: string;
  name: string;
  email: string | null;
  type: ActorType;
  roleName: RoleNameLiteral | null;
  roleId: string | null;
  /** Non-null only for portal users. */
  clientId: string | null;
  permissions: ReadonlySet<string>;
  ip: string | null;
  userAgent: string | null;
};

/**
 * A portal caller. `clientId` is non-nullable here so a staff actor cannot be
 * passed into a client-scoped query by accident — the type system rejects it
 * (docs/ARCHITECTURE.md 10, point 5).
 */
export type PortalActor = Omit<Actor, "type" | "clientId"> & {
  type: "CLIENT";
  clientId: string;
};

export const SYSTEM_USER_ID = "system";

/** Actor for automation, cron and seeding. Audited under its own identity. */
export function systemActor(options?: { ip?: string | null }): Actor {
  return {
    userId: SYSTEM_USER_ID,
    name: "System",
    email: null,
    type: "SYSTEM",
    roleName: null,
    roleId: null,
    clientId: null,
    permissions: new Set<string>(),
    ip: options?.ip ?? null,
    userAgent: "emporia/system",
  };
}
