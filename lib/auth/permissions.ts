/**
 * The permission catalogue.
 *
 * Permissions are granular `resource.action` strings (CLAUDE.md 8). Roles map
 * to permission sets *in the database*, so the mapping below is seed data — the
 * starting point — not a compile-time authority. An admin can change a role's
 * permissions without a deploy, and `resolvePermissions()` reads the database,
 * never this file.
 *
 * This module is safe to import from anywhere: it contains no secrets and no
 * database access.
 */

export const PERMISSIONS = [
  // CRM
  "leads.view",
  "leads.view.team",
  "leads.create",
  "leads.edit",
  "leads.delete",
  "leads.assign",
  "leads.export",

  // Sales
  "opportunities.view",
  "opportunities.create",
  "opportunities.edit",
  "opportunities.delete",
  "proposals.view",
  "proposals.create",
  "proposals.edit",
  "proposals.delete",
  "proposals.send",
  "contracts.view",
  "contracts.create",
  "contracts.edit",
  "contracts.delete",
  "clients.view",
  "clients.create",
  "clients.edit",
  "clients.delete",

  // Delivery
  "projects.view",
  "projects.view.team",
  "projects.create",
  "projects.edit",
  "projects.delete",
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.delete",
  "tasks.assign",
  "timeentries.view",
  "timeentries.create",
  "timeentries.edit",
  "approvals.view",
  "approvals.request",
  "approvals.decide",

  // Content and catalogue
  "content.view",
  "content.create",
  "content.edit",
  "content.delete",
  "content.publish",
  "catalog.view",
  "catalog.create",
  "catalog.edit",
  "catalog.delete",
  "catalog.publish",

  // Marketing
  "campaigns.view",
  "campaigns.create",
  "campaigns.edit",
  "campaigns.delete",
  "popups.view",
  "popups.create",
  "popups.edit",
  "popups.delete",
  "popups.publish",

  // Finance
  "invoices.view",
  "invoices.create",
  "invoices.edit",
  "invoices.delete",
  "invoices.send",
  "payments.view",
  "payments.record",
  "payments.refund",
  "retainers.view",
  "retainers.create",
  "retainers.edit",

  // Platform
  "media.view",
  "media.upload",
  "media.edit",
  "media.delete",
  "seo.view",
  "seo.edit",
  "redirects.view",
  "redirects.edit",
  "automation.view",
  "automation.edit",
  "emails.view",
  "emails.edit",
  "emails.send",
  "analytics.view",
  "audit.view",
  "settings.view",
  "settings.edit",
  "users.view",
  "users.create",
  "users.edit",
  "users.delete",
  "roles.view",
  "roles.edit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export function splitPermission(key: Permission): { resource: string; action: string } {
  const idx = key.indexOf(".");
  return { resource: key.slice(0, idx), action: key.slice(idx + 1) };
}

export const ROLE_NAMES = [
  "SUPER_ADMIN",
  "ADMIN",
  "SALES_MANAGER",
  "SALES_EXECUTIVE",
  "MARKETING_MANAGER",
  "CONTENT_MANAGER",
  "PROJECT_MANAGER",
  "STAFF",
  /**
   * Portal accounts. Deliberately holds no permission at all: the portal is not
   * gated by the staff catalogue, it is gated by `type === "CLIENT"` plus the
   * session's own `clientId` (CLAUDE.md 2 rule 3). The role exists because
   * every User needs one, and because a portal account with zero admin
   * permissions can never reach /admin even if it somehow got there.
   */
  "CLIENT_USER",
] as const;

export type RoleNameLiteral = (typeof ROLE_NAMES)[number];

export const ROLE_LABELS: Record<RoleNameLiteral, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Admin",
  SALES_MANAGER: "Sales manager",
  SALES_EXECUTIVE: "Sales executive",
  MARKETING_MANAGER: "Marketing manager",
  CONTENT_MANAGER: "Content manager",
  PROJECT_MANAGER: "Project manager",
  STAFF: "Staff",
  CLIENT_USER: "Client portal user",
};

const READ_ONLY_BASELINE: Permission[] = [
  "leads.view",
  "projects.view",
  "tasks.view",
  "media.view",
  "content.view",
  "catalog.view",
];

/**
 * Seed mapping of role to permissions.
 *
 * SUPER_ADMIN is deliberately absent: it bypasses `requirePermission` in code
 * and is granted every permission at seed time, so it is never accidentally
 * narrower than the catalogue.
 */
export const ROLE_PERMISSIONS: Record<Exclude<RoleNameLiteral, "SUPER_ADMIN">, Permission[]> = {
  // Empty by design — see ROLE_NAMES above.
  CLIENT_USER: [],

  ADMIN: PERMISSIONS.filter(
    (p) => p !== "roles.edit" && p !== "users.delete",
  ) as Permission[],

  SALES_MANAGER: [
    "leads.view",
    "leads.view.team",
    "leads.create",
    "leads.edit",
    "leads.assign",
    "leads.export",
    "opportunities.view",
    "opportunities.create",
    "opportunities.edit",
    "opportunities.delete",
    "proposals.view",
    "proposals.create",
    "proposals.edit",
    "proposals.send",
    "contracts.view",
    "contracts.create",
    "contracts.edit",
    "clients.view",
    "clients.create",
    "clients.edit",
    "invoices.view",
    "payments.view",
    "analytics.view",
    "media.view",
    "media.upload",
    "catalog.view",
    "content.view",
    "projects.view",
    "tasks.view",
  ],

  // No `leads.view.team`: a sales executive sees their own leads only. This is
  // the Phase 7 exit criterion and it is enforced in the service layer.
  SALES_EXECUTIVE: [
    "leads.view",
    "leads.create",
    "leads.edit",
    "opportunities.view",
    "opportunities.create",
    "opportunities.edit",
    "proposals.view",
    "proposals.create",
    "proposals.edit",
    "clients.view",
    "media.view",
    "media.upload",
    "catalog.view",
    "content.view",
  ],

  MARKETING_MANAGER: [
    "leads.view",
    "leads.view.team",
    "campaigns.view",
    "campaigns.create",
    "campaigns.edit",
    "campaigns.delete",
    "popups.view",
    "popups.create",
    "popups.edit",
    "popups.delete",
    "popups.publish",
    "content.view",
    "content.create",
    "content.edit",
    "content.publish",
    "catalog.view",
    "catalog.edit",
    "seo.view",
    "seo.edit",
    "redirects.view",
    "redirects.edit",
    "analytics.view",
    "media.view",
    "media.upload",
    "media.edit",
    "emails.view",
  ],

  CONTENT_MANAGER: [
    "content.view",
    "content.create",
    "content.edit",
    "content.delete",
    "content.publish",
    "catalog.view",
    "catalog.create",
    "catalog.edit",
    "catalog.publish",
    "seo.view",
    "seo.edit",
    "media.view",
    "media.upload",
    "media.edit",
    "approvals.view",
    "approvals.request",
    "projects.view",
    "tasks.view",
  ],

  PROJECT_MANAGER: [
    "projects.view",
    "projects.view.team",
    "projects.create",
    "projects.edit",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "tasks.delete",
    "tasks.assign",
    "timeentries.view",
    "timeentries.create",
    "timeentries.edit",
    "approvals.view",
    "approvals.request",
    "approvals.decide",
    "clients.view",
    "content.view",
    "content.create",
    "content.edit",
    "media.view",
    "media.upload",
    "analytics.view",
  ],

  STAFF: READ_ONLY_BASELINE,
};
