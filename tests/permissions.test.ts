import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_SET,
  ROLE_LABELS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  isPermission,
  splitPermission,
} from "@/lib/auth/permissions";

describe("permission catalogue", () => {
  it("has no duplicates", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("uses resource.action form throughout", () => {
    for (const key of PERMISSIONS) {
      expect(key).toMatch(/^[a-z]+\.[a-z.]+$/);
      const { resource, action } = splitPermission(key);
      expect(resource.length).toBeGreaterThan(0);
      expect(action.length).toBeGreaterThan(0);
      expect(`${resource}.${action}`).toBe(key);
    }
  });

  it("recognises catalogue members and rejects invented ones", () => {
    expect(isPermission("leads.view")).toBe(true);
    expect(isPermission("leads.obliterate")).toBe(false);
  });
});

describe("role mappings", () => {
  it("labels every role", () => {
    for (const role of ROLE_NAMES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("grants only permissions that exist in the catalogue", () => {
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      for (const key of keys) {
        expect(PERMISSION_SET.has(key), `${role} grants unknown permission ${key}`).toBe(true);
      }
    }
  });

  it("maps every role except SUPER_ADMIN, which is granted the full catalogue at seed time", () => {
    const mapped = new Set(Object.keys(ROLE_PERMISSIONS));
    for (const role of ROLE_NAMES) {
      if (role === "SUPER_ADMIN") {
        expect(mapped.has(role)).toBe(false);
      } else {
        expect(mapped.has(role), `${role} has no permission mapping`).toBe(true);
      }
    }
  });

  it("withholds team-wide lead visibility from sales executives", () => {
    // Phase 7 exit criterion: an executive sees their own leads only.
    expect(ROLE_PERMISSIONS.SALES_EXECUTIVE).toContain("leads.view");
    expect(ROLE_PERMISSIONS.SALES_EXECUTIVE).not.toContain("leads.view.team");
    expect(ROLE_PERMISSIONS.SALES_MANAGER).toContain("leads.view.team");
  });

  it("keeps destructive and role-editing permissions away from non-admins", () => {
    for (const role of ["SALES_EXECUTIVE", "CONTENT_MANAGER", "PROJECT_MANAGER", "STAFF"] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("roles.edit");
      expect(ROLE_PERMISSIONS[role]).not.toContain("users.delete");
      expect(ROLE_PERMISSIONS[role]).not.toContain("settings.edit");
      expect(ROLE_PERMISSIONS[role]).not.toContain("invoices.delete");
    }
  });

  it("gives STAFF read-only access", () => {
    for (const key of ROLE_PERMISSIONS.STAFF) {
      expect(key.endsWith(".view")).toBe(true);
    }
  });
});
