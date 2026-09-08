import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { syncPlatform } from "./platform.js";

/**
 * Seed: everything prisma/platform.ts syncs, plus the initial super admin.
 *
 * The split is the point. `syncPlatform` is data the source tree owns —
 * permissions, roles, templates, the homepage — and the container runs it
 * unattended on every boot. This file adds the one step that must never run
 * unattended: creating a staff account and setting its password. Re-running the
 * seed with SEED_SUPER_ADMIN_PASSWORD set *resets* that account's password,
 * which is fine as a deliberate act and would be a serious surprise as a side
 * effect of a redeploy (docs/ARCHITECTURE.md 17.4).
 *
 * Idempotent either way. Credentials come from the environment and are never
 * hardcoded (docs/BUILD-PLAN.md, "Seed data").
 *
 * This seeds *configuration* only. Demo content (services, cities, packages,
 * leads, case studies) lives in prisma/seed-demo.ts and is clearly flagged as
 * demo.
 *
 * Note this file does not import from lib/db or lib/auth/password: those are
 * marked `server-only`, which throws outside a Next server runtime.
 */

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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

async function main(): Promise<void> {
  await syncPlatform(prisma);
  console.log("Seeding:");
  await seedSuperAdmin();
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
