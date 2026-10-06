import type { PrismaClient } from "../generated/prisma/client.js";
import {
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  splitPermission,
  type RoleNameLiteral,
} from "../lib/auth/permissions.js";
import { DEFAULT_TEMPLATES } from "../lib/email/templates.js";
import { ensureHomepage } from "./ensure-homepage.js";
import { ensureStarterPages } from "./ensure-starter-pages.js";
import { migrateHomepage } from "./migrate-homepage.js";
import { linkCityCountries } from "../lib/geo/country-rows.js";

/**
 * Platform data the running code depends on.
 *
 * This is the half of the seed that is **owned by the source tree**: the
 * permission catalogue, which permissions each system role holds, the lead
 * source types, the default site settings, the email templates' variable lists,
 * the two example automations, and the homepage.
 *
 * It is separated from prisma/seed.ts because it is safe to run unattended, and
 * the container entrypoint does exactly that after `migrate deploy`
 * (docs/ARCHITECTURE.md 17.4). A release that adds a permission has to grant it
 * to the roles that need it, or the feature 403s for everyone until somebody
 * remembers to run a command by hand — and "somebody remembers" is not a
 * deployment step.
 *
 * Every function here is idempotent, and none of them overwrite content a
 * person has written:
 *
 *   permissions       upserted; the catalogue is code
 *   system roles      reconciled against ROLE_PERMISSIONS — see below
 *   lead sources      upserted by slug
 *   site settings     created if absent, never updated
 *   email templates   created if absent; only `variables` is refreshed
 *   automations       created if absent, and switched off
 *   homepage          created only when no `home` page exists at all
 *   city countries    a city with no `countryId` is linked from its country
 *                     name when recognised; nothing else about it changes
 *
 * The one thing that *removes* anything is the role reconciliation, and it
 * removes only from the nine `isSystem` roles this file creates. That is
 * deliberate: a permission dropped from the code must stop being granted, or a
 * release that revokes access silently does not. When a roles editor is built,
 * it belongs on non-system roles, which nothing here touches.
 *
 * What is NOT here: the super admin (prisma/seed.ts, because it sets a
 * password) and demo content (prisma/seed-demo.ts).
 */

async function seedPermissions(prisma: PrismaClient): Promise<Map<string, string>> {
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

async function seedRoles(prisma: PrismaClient, permissionIds: Map<string, string>): Promise<void> {
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
      name === "SUPER_ADMIN"
        ? PERMISSIONS
        : ROLE_PERMISSIONS[name as Exclude<RoleNameLiteral, "SUPER_ADMIN">];

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
/**
 * The occasion library a fresh install starts with.
 *
 * Created if absent, never overwritten: an editor may have renamed one or
 * archived another, and a release must not undo that.
 *
 * Only fixed-date days carry a date. Moving festivals — Diwali, Holi, Eid,
 * Raksha Bandhan and the rest — are seeded **without dates**: many follow a
 * lunar calendar or a moon sighting, and a wrong date shipped in a release
 * would put a client's festive post on the wrong day. A person enters each
 * year's date in the library; until then the occasion does not appear in that
 * year's calendar.
 */
const DEFAULT_OCCASIONS: {
  slug: string;
  name: string;
  category: "FESTIVAL" | "NATIONAL_DAY" | "AWARENESS_DAY" | "INDUSTRY_EVENT" | "BRAND";
  fixed?: [month: number, day: number];
}[] = [
  { slug: "new-years-day", name: "New Year's Day", category: "FESTIVAL", fixed: [1, 1] },
  { slug: "republic-day-india", name: "Republic Day (India)", category: "NATIONAL_DAY", fixed: [1, 26] },
  { slug: "valentines-day", name: "Valentine's Day", category: "FESTIVAL", fixed: [2, 14] },
  { slug: "international-womens-day", name: "International Women's Day", category: "AWARENESS_DAY", fixed: [3, 8] },
  { slug: "world-health-day", name: "World Health Day", category: "AWARENESS_DAY", fixed: [4, 7] },
  { slug: "earth-day", name: "Earth Day", category: "AWARENESS_DAY", fixed: [4, 22] },
  { slug: "world-environment-day", name: "World Environment Day", category: "AWARENESS_DAY", fixed: [6, 5] },
  { slug: "international-yoga-day", name: "International Yoga Day", category: "AWARENESS_DAY", fixed: [6, 21] },
  { slug: "independence-day-india", name: "Independence Day (India)", category: "NATIONAL_DAY", fixed: [8, 15] },
  { slug: "teachers-day-india", name: "Teachers' Day (India)", category: "AWARENESS_DAY", fixed: [9, 5] },
  { slug: "gandhi-jayanti", name: "Gandhi Jayanti", category: "NATIONAL_DAY", fixed: [10, 2] },
  { slug: "childrens-day-india", name: "Children's Day (India)", category: "AWARENESS_DAY", fixed: [11, 14] },
  { slug: "christmas", name: "Christmas", category: "FESTIVAL", fixed: [12, 25] },
  { slug: "new-years-eve", name: "New Year's Eve", category: "FESTIVAL", fixed: [12, 31] },
  // Moving: dates entered per year, never guessed.
  { slug: "makar-sankranti", name: "Makar Sankranti / Pongal", category: "FESTIVAL" },
  { slug: "holi", name: "Holi", category: "FESTIVAL" },
  { slug: "eid-al-fitr", name: "Eid al-Fitr", category: "FESTIVAL" },
  { slug: "eid-al-adha", name: "Eid al-Adha", category: "FESTIVAL" },
  { slug: "raksha-bandhan", name: "Raksha Bandhan", category: "FESTIVAL" },
  { slug: "janmashtami", name: "Janmashtami", category: "FESTIVAL" },
  { slug: "ganesh-chaturthi", name: "Ganesh Chaturthi", category: "FESTIVAL" },
  { slug: "onam", name: "Onam", category: "FESTIVAL" },
  { slug: "navratri", name: "Navratri", category: "FESTIVAL" },
  { slug: "dussehra", name: "Dussehra", category: "FESTIVAL" },
  { slug: "diwali", name: "Diwali", category: "FESTIVAL" },
  { slug: "bhai-dooj", name: "Bhai Dooj", category: "FESTIVAL" },
  { slug: "guru-nanak-jayanti", name: "Guru Nanak Jayanti", category: "FESTIVAL" },
  { slug: "mothers-day", name: "Mother's Day", category: "AWARENESS_DAY" },
  { slug: "fathers-day", name: "Father's Day", category: "AWARENESS_DAY" },
  { slug: "black-friday", name: "Black Friday", category: "INDUSTRY_EVENT" },
];

async function seedOccasions(prisma: PrismaClient): Promise<void> {
  let created = 0;
  for (const occasion of DEFAULT_OCCASIONS) {
    const existing = await prisma.contentOccasion.findUnique({ where: { slug: occasion.slug }, select: { id: true } });
    if (existing) continue;
    await prisma.contentOccasion.create({
      data: {
        slug: occasion.slug,
        name: occasion.name,
        category: occasion.category,
        fixedMonth: occasion.fixed?.[0] ?? null,
        fixedDay: occasion.fixed?.[1] ?? null,
      },
    });
    created += 1;
  }
  console.log(`  occasions: ${DEFAULT_OCCASIONS.length} (${created} new; moving dates are entered per year)`);
}

/** Lead sources are platform configuration, not demo data. */
async function seedLeadSources(prisma: PrismaClient): Promise<void> {
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

async function seedSiteSettings(prisma: PrismaClient): Promise<void> {
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
async function seedEmailTemplates(prisma: PrismaClient): Promise<void> {
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
async function seedAutomations(prisma: PrismaClient): Promise<void> {
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

/**
 * Bring the database in line with the deployed code.
 *
 * Ordered: roles need the permission rows, and the homepage steps run last so
 * they see the settings the site name is read from.
 */
export async function syncPlatform(prisma: PrismaClient): Promise<void> {
  console.log("Syncing platform data:");
  const permissionIds = await seedPermissions(prisma);
  await seedRoles(prisma, permissionIds);
  await seedLeadSources(prisma);
  await seedSiteSettings(prisma);
  await seedEmailTemplates(prisma);
  await seedAutomations(prisma);
  await seedOccasions(prisma);
  const countries = await linkCityCountries(prisma);
  console.log(
    `  city countries: ${countries.linked} linked` +
      (countries.unrecognised.length ? `; not recognised, left unlinked: ${countries.unrecognised.join(", ")}` : ""),
  );
  console.log(`  ${await ensureHomepage(prisma)}`);
  // About, Careers and the legal pages hold reserved slugs, so only this can
  // create them. Drafts with marked starter text; never published from here.
  console.log(`  ${await ensureStarterPages(prisma)}`);
  // Additive and idempotent: it inserts the homepage bands that became section
  // types and touches nothing an editor has arranged (prisma/migrate-homepage).
  console.log(`  ${await migrateHomepage(prisma)}`);
}
