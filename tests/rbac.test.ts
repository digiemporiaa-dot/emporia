import { describe, expect, it } from "vitest";
import { can, canAny, isSuperAdmin, requireOwnership, requirePermission, requirePortalActor, requireStaff } from "@/lib/auth/rbac";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";
import type { RoleNameLiteral } from "@/lib/auth/permissions";

function actorWith(
  roleName: RoleNameLiteral | null,
  permissions: string[],
  overrides: Partial<Actor> = {},
): Actor {
  return {
    userId: "u1",
    name: "Test User",
    email: "u1@example.com",
    type: "STAFF",
    roleName,
    roleId: "r1",
    clientId: null,
    permissions: new Set(permissions),
    ip: "127.0.0.1",
    userAgent: "vitest",
    ...overrides,
  };
}

describe("permission checks", () => {
  it("grants a held permission", () => {
    const actor = actorWith("SALES_EXECUTIVE", ["leads.view"]);
    expect(can(actor, "leads.view")).toBe(true);
    expect(() => requirePermission(actor, "leads.view")).not.toThrow();
  });

  it("denies a permission that is not held", () => {
    const actor = actorWith("SALES_EXECUTIVE", ["leads.view"]);
    expect(can(actor, "leads.assign")).toBe(false);
    expect(() => requirePermission(actor, "leads.assign")).toThrow(ForbiddenError);
  });

  it("throws UnauthenticatedError, not Forbidden, for a null actor", () => {
    expect(() => requirePermission(null, "leads.view")).toThrow(UnauthenticatedError);
  });

  it("canAny passes when at least one permission is held", () => {
    const actor = actorWith("STAFF", ["media.view"]);
    expect(canAny(actor, ["media.upload", "media.view"])).toBe(true);
    expect(canAny(actor, ["media.upload", "media.delete"])).toBe(false);
  });
});

describe("SUPER_ADMIN bypass", () => {
  const superAdmin = actorWith("SUPER_ADMIN", []);

  it("is recognised", () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
  });

  it("passes every permission even with an empty permission set", () => {
    expect(can(superAdmin, "invoices.delete")).toBe(true);
    expect(can(superAdmin, "roles.edit")).toBe(true);
    expect(() => requirePermission(superAdmin, "settings.edit")).not.toThrow();
  });

  it("does not extend to any other role", () => {
    for (const role of ["ADMIN", "SALES_MANAGER", "PROJECT_MANAGER", "STAFF"] as const) {
      const actor = actorWith(role, []);
      expect(can(actor, "settings.edit")).toBe(false);
    }
  });
});

describe("client isolation", () => {
  const portalActor = actorWith("STAFF", [], {
    type: "CLIENT",
    clientId: "client-a",
    roleName: null,
  });

  it("allows a portal user to reach their own client", () => {
    expect(() => requireOwnership(portalActor, "client-a")).not.toThrow();
  });

  it("blocks a portal user from another client", () => {
    expect(() => requireOwnership(portalActor, "client-b")).toThrow(ForbiddenError);
  });

  it("has NO super-admin bypass — isolation is absolute", () => {
    const superAdmin = actorWith("SUPER_ADMIN", []);
    expect(() => requireOwnership(superAdmin, "client-a")).toThrow(ForbiddenError);
  });

  it("blocks a staff actor from portal-scoped queries", () => {
    const staff = actorWith("ADMIN", ["clients.view"]);
    expect(() => requirePortalActor(staff)).toThrow(ForbiddenError);
  });

  it("narrows a portal actor to a non-nullable clientId", () => {
    const narrowed = requirePortalActor(portalActor);
    expect(narrowed.clientId).toBe("client-a");
    expect(narrowed.type).toBe("CLIENT");
  });

  it("rejects a CLIENT actor with no clientId rather than matching loosely", () => {
    const broken = actorWith(null, [], { type: "CLIENT", clientId: null });
    expect(() => requireOwnership(broken, "client-a")).toThrow(ForbiddenError);
    expect(() => requirePortalActor(broken)).toThrow(ForbiddenError);
  });
});

describe("staff gate", () => {
  it("admits staff and system actors", () => {
    expect(() => requireStaff(actorWith("ADMIN", []))).not.toThrow();
    expect(() => requireStaff(actorWith(null, [], { type: "SYSTEM" }))).not.toThrow();
  });

  it("rejects portal users", () => {
    expect(() => requireStaff(actorWith(null, [], { type: "CLIENT", clientId: "c1" }))).toThrow(
      ForbiddenError,
    );
  });
});
