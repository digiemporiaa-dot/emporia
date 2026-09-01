import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/errors";
import { PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/actor/types";
import type { RoleNameLiteral } from "@/lib/auth/permissions";

/**
 * Integration test against the seeded database.
 *
 * This is the Phase 2 exit criterion in executable form: permissions are read
 * from Postgres — not from the TypeScript catalogue — and a non-permitted role
 * is rejected server-side.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("RBAC against the seeded database", () => {
  let prisma: PrismaClient;
  const permissionsByRole = new Map<RoleNameLiteral, Set<string>>();

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const roles = await prisma.role.findMany({
      select: {
        name: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });

    for (const role of roles) {
      permissionsByRole.set(
        role.name as RoleNameLiteral,
        new Set(role.permissions.map((rp) => rp.permission.key)),
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function actorFor(roleName: RoleNameLiteral): Actor {
    return {
      userId: `user-${roleName}`,
      name: roleName,
      email: `${roleName}@example.test`,
      type: "STAFF",
      roleName,
      roleId: `role-${roleName}`,
      clientId: null,
      permissions: permissionsByRole.get(roleName) ?? new Set(),
      ip: null,
      userAgent: null,
    };
  }

  it("seeds every catalogue permission into the database", async () => {
    const rows = await prisma.permission.findMany({ select: { key: true } });
    const seeded = new Set(rows.map((r) => r.key));
    for (const key of PERMISSIONS) {
      expect(seeded.has(key), `missing permission ${key}`).toBe(true);
    }
    expect(seeded.size).toBe(PERMISSIONS.length);
  });

  it("seeds all eight roles", () => {
    for (const role of ROLE_NAMES) {
      expect(permissionsByRole.has(role), `missing role ${role}`).toBe(true);
    }
  });

  it("grants SUPER_ADMIN the entire catalogue", () => {
    expect(permissionsByRole.get("SUPER_ADMIN")?.size).toBe(PERMISSIONS.length);
  });

  it("matches the seed mapping for every other role", () => {
    for (const role of ROLE_NAMES) {
      if (role === "SUPER_ADMIN") continue;
      const fromDb = permissionsByRole.get(role) ?? new Set();
      const expected = new Set(ROLE_PERMISSIONS[role as Exclude<RoleNameLiteral, "SUPER_ADMIN">]);
      expect([...fromDb].sort()).toEqual([...expected].sort());
    }
  });

  it("rejects a sales executive from assigning leads", () => {
    const actor = actorFor("SALES_EXECUTIVE");
    expect(can(actor, "leads.view")).toBe(true);
    expect(can(actor, "leads.assign")).toBe(false);
    expect(() => requirePermission(actor, "leads.assign")).toThrow(ForbiddenError);
  });

  it("rejects a sales executive from team-wide lead visibility", () => {
    expect(can(actorFor("SALES_EXECUTIVE"), "leads.view.team")).toBe(false);
    expect(can(actorFor("SALES_MANAGER"), "leads.view.team")).toBe(true);
  });

  it("rejects every non-super-admin role from editing roles", () => {
    for (const role of ROLE_NAMES) {
      if (role === "SUPER_ADMIN") continue;
      expect(() => requirePermission(actorFor(role), "roles.edit")).toThrow(ForbiddenError);
    }
  });

  it("rejects STAFF from every write permission", () => {
    const actor = actorFor("STAFF");
    for (const key of PERMISSIONS) {
      if (key.endsWith(".view")) continue;
      expect(can(actor, key), `STAFF unexpectedly holds ${key}`).toBe(false);
    }
  });

  it("creates an active super admin with a hashed password", async () => {
    const user = await prisma.user.findUnique({
      where: { email: "test-admin@emporia.test" },
      select: { status: true, type: true, passwordHash: true, role: { select: { name: true } } },
    });

    expect(user).not.toBeNull();
    expect(user?.status).toBe("ACTIVE");
    expect(user?.type).toBe("STAFF");
    expect(user?.role.name).toBe("SUPER_ADMIN");
    // argon2id hashes are prefixed; the plaintext must never be stored.
    expect(user?.passwordHash?.startsWith("$argon2id$")).toBe(true);
    expect(user?.passwordHash).not.toContain("test-password-1234");
  });
});
