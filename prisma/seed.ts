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
import { DEFAULT_TEMPLATES } from "../lib/email/templates.js";
import { migrateHomepage } from "./migrate-homepage.js";

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

/**
 * Email templates.
 *
 * Seeded from the defaults, then owned by admin: an existing template is left
 * alone so a re-seed never overwrites someone's edit. Only the declared
 * variable list is refreshed, because that is code, not content.
 */
async function seedEmailTemplates(): Promise<void> {
  let created = 0;

  for (const template of DEFAULT_TEMPLATES) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { key: template.key },
      select: { key: true },
    });

    if (existing) {
      await prisma.emailTemplate.update({
        where: { key: template.key },
        data: { variables: template.variables },
      });
      continue;
    }

    await prisma.emailTemplate.create({
      data: {
        key: template.key,
        name: template.name,
        subject: template.subject,
        html: template.html,
        text: template.text,
        variables: template.variables,
      },
    });
    created++;
  }

  console.log(`  email templates: ${DEFAULT_TEMPLATES.length} (${created} new)`);
}


/**
 * The two workflows the build plan names, pre-built and **switched off**.
 *
 * They are seeded rather than hard-coded so they can be read, edited and turned
 * on from admin like any other rule — which is the point of the engine. Off by
 * default because a fresh install should not start assigning leads and emailing
 * people before anyone has looked at what the rules say.
 *
 * Idempotent: a rule that already exists by name is left exactly as it is, so
 * re-seeding never overwrites someone's edits.
 */
async function seedAutomations(): Promise<void> {
  const rules = [
    {
      name: "New lead: assign, chase, and tell the manager",
      description:
        "Fills in an owner if capture did not, books a follow-up for tomorrow, and puts it in front of sales management.",
      order: 10,
      trigger: "LEAD_CREATED" as const,
      conditions: [] as { field: string; operator: string; value: unknown }[],
      actions: [
        { type: "ASSIGN_LEAD", strategy: "ROUND_ROBIN", onlyIfUnassigned: true },
        {
          type: "CREATE_LEAD_TASK",
          title: "Call {{lead.company}}",
          detail: "First contact within one working day.",
          dueInDays: 1,
          assignTo: "LEAD_OWNER",
          priority: "HIGH",
        },
        { type: "SEND_EMAIL", templateKey: "NEW_LEAD", to: "LEAD_OWNER" },
        {
          type: "NOTIFY_USER",
          to: "ROLE",
          roleName: "SALES_MANAGER",
          title: "New enquiry: {{lead.company}}",
          body: "Score {{lead.score}} from {{lead.sourceSlug}}.",
        },
      ],
    },
    {
      name: "Proposal accepted: open the project and onboard",
      description:
        "The client already exists by this point — accepting creates it. This opens the project, lays out the onboarding checklist, tells the manager and welcomes the client.",
      order: 20,
      trigger: "PROPOSAL_ACCEPTED" as const,
      conditions: [] as { field: string; operator: string; value: unknown }[],
      actions: [
        { type: "CREATE_CLIENT" },
        {
          type: "CREATE_PROJECT",
          nameTemplate: "{{client.name}} onboarding",
          startInDays: 0,
          dueInDays: 30,
        },
        {
          type: "CREATE_PROJECT_TASKS",
          titles: [
            "Kick-off call",
            "Collect brand assets and access",
            "Agree the reporting cadence",
            "Draft the first month plan",
          ],
          dueInDays: 7,
        },
        {
          type: "NOTIFY_USER",
          to: "PROJECT_MANAGER",
          title: "New project: {{client.name}}",
          body: "Won from {{proposal.title}}.",
        },
        {
          type: "SEND_EMAIL",
          templateKey: "CLIENT_NOTIFICATION",
          to: "CLIENT_PRIMARY",
          subject: "Welcome aboard",
          body: "Thank you for choosing us. Your project is open and we will be in touch to arrange the kick-off.",
        },
      ],
    },
  ];

  let created = 0;

  for (const rule of rules) {
    const existing = await prisma.automation.findFirst({
      where: { name: rule.name },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.automation.create({
      data: {
        name: rule.name,
        description: rule.description,
        // Deliberately off. An admin reads it, tries it, then switches it on.
        isActive: false,
        order: rule.order,
        triggers: { create: { type: rule.trigger } },
        conditions: {
          create: rule.conditions.map((condition, index) => ({
            field: condition.field,
            operator: condition.operator,
            value: condition.value as object,
            order: index,
          })),
        },
        actions: {
          create: rule.actions.map((action, index) => ({
            type: action.type as never,
            config: action as object,
            order: index,
          })),
        },
      },
    });
    created++;
  }

  console.log(`  automations: ${rules.length} (${created} new, all switched off)`);
}

async function main(): Promise<void> {
  console.log("Seeding:");
  const permissionIds = await seedPermissions();
  await seedRoles(permissionIds);
  await seedSuperAdmin();
  await seedLeadSources();
  await seedSiteSettings();
  await seedEmailTemplates();
  await seedAutomations();
  // Additive and idempotent: it inserts the homepage bands that became section
  // types and touches nothing an editor has arranged (prisma/migrate-homepage).
  console.log(`  ${await migrateHomepage(prisma)}`);
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
