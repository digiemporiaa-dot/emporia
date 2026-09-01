import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import {
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  splitPermission,
  type RoleNameLiteral,
} from "../lib/auth/permissions.js";

/**
 * Seed: roles, permissions and the initial super admin.
 *
 * Idempotent — safe to re-run. Credentials come from the environment and are
 * never hardcoded (docs/BUILD-PLAN.md, "Seed data").
 *
 * This seeds *configuration* only. Demo content (services, cities, packages,
 * leads, case studies) is seeded by the phase that introduces it, and will be
 * clearly flagged as demo.
 *
 * Note this file does not import from lib/db or lib/auth/password: those are
 * marked `server-only`, which throws outside a Next server runtime.
 */

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function seedPermissions(): Promise<Map<string, string>> {
  for (const key of PERMISSIONS) {
    const { resource, action } = splitPermission(key);
    await prisma.permission.upsert({
      where: { key },
      update: { resource, action },
      create: { key, resource, action },
    });
  }

  const rows = await prisma.permission.findMany({ select: { id: true, key: true } });
  console.log(`  permissions: ${rows.length}`);
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function seedRoles(permissionIds: Map<string, string>): Promise<void> {
  for (const name of ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { label: ROLE_LABELS[name] },
      create: { name, label: ROLE_LABELS[name], isSystem: true },
    });

    // SUPER_ADMIN receives the whole catalogue, so it is never accidentally
    // narrower than the permissions that exist. It also bypasses
    // requirePermission in code — the grants are belt and braces.
    const keys: readonly string[] =
      name === "SUPER_ADMIN" ? PERMISSIONS : ROLE_PERMISSIONS[name as Exclude<RoleNameLiteral, "SUPER_ADMIN">];

    const wanted = new Set(keys);

    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true, permission: { select: { key: true } } },
    });
    const existingKeys = new Set(existing.map((e) => e.permission.key));

    const toAdd = [...wanted].filter((k) => !existingKeys.has(k));
    const toRemove = existing.filter((e) => !wanted.has(e.permission.key));

    if (toAdd.length > 0) {
      await prisma.rolePermission.createMany({
        data: toAdd.flatMap((key) => {
          const permissionId = permissionIds.get(key);
          return permissionId ? [{ roleId: role.id, permissionId }] : [];
        }),
        skipDuplicates: true,
      });
    }

    if (toRemove.length > 0) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove.map((r) => r.permissionId) } },
      });
    }

    console.log(`  role ${name}: ${wanted.size} permissions`);
  }
}

async function seedSuperAdmin(): Promise<void> {
  const email = process.env["SEED_SUPER_ADMIN_EMAIL"];
  const password = process.env["SEED_SUPER_ADMIN_PASSWORD"];
  const name = process.env["SEED_SUPER_ADMIN_NAME"] ?? "Super Admin";

  if (!email || !password) {
    console.log(
      "  super admin: SKIPPED — set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD to create one",
    );
    return;
  }

  if (password.length < 12) {
    throw new Error("SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { name: "SUPER_ADMIN" } });
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    raw: false,
  });

  const normalised = email.trim().toLowerCase();
  await prisma.user.upsert({
    where: { email: normalised },
    update: { passwordHash, name, roleId: role.id, status: "ACTIVE", type: "STAFF" },
    create: {
      email: normalised,
      passwordHash,
      name,
      roleId: role.id,
      status: "ACTIVE",
      type: "STAFF",
    },
  });

  console.log(`  super admin: ${normalised}`);
}

/** Lead sources are platform configuration, not demo data. */
async function seedLeadSources(): Promise<void> {
  const sources = [
    { slug: "website-form", name: "Website form", type: "WEBSITE_FORM" as const },
    { slug: "popup", name: "Popup", type: "POPUP" as const },
    { slug: "phone", name: "Phone", type: "PHONE" as const },
    { slug: "email", name: "Email", type: "EMAIL" as const },
    { slug: "referral", name: "Referral", type: "REFERRAL" as const },
    { slug: "paid-ads", name: "Paid ads", type: "ADS" as const },
    { slug: "social", name: "Social", type: "SOCIAL" as const },
    { slug: "other", name: "Other", type: "OTHER" as const },
  ];

  for (const s of sources) {
    await prisma.leadSource.upsert({
      where: { slug: s.slug },
      update: { name: s.name, type: s.type },
      create: s,
    });
  }
  console.log(`  lead sources: ${sources.length}`);
}

async function seedSiteSettings(): Promise<void> {
  const settings = [
    { key: "site.name", value: "Emporia", group: "general" },
    { key: "site.tagline", value: "Digital marketing that compounds", group: "general" },
    { key: "seo.defaultMetaTitle", value: "Emporia", group: "seo" },
    { key: "seo.defaultMetaDescription", value: "", group: "seo" },
  ];

  for (const s of settings) {
    await prisma.siteSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }
  console.log(`  site settings: ${settings.length}`);
}

async function main(): Promise<void> {
  console.log("Seeding:");
  const permissionIds = await seedPermissions();
  await seedRoles(permissionIds);
  await seedSuperAdmin();
  await seedLeadSources();
  await seedSiteSettings();
  console.log("Done.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
