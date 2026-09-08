import "server-only";
import { revalidateTag } from "next/cache";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { CACHE_TAGS } from "@/lib/content/queries";
import {
  navItemSchema,
  socialLinkSchema,
  type NavItemInput,
  type NavigationSettingsInput,
  type SocialLinkInput,
} from "@/lib/validation/navigation";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { Actor } from "@/lib/actor/types";

/**
 * Header, footer and navigation content.
 *
 * Stored in `SiteSetting`, the existing key/value/group table, rather than in a
 * second settings model (CLAUDE.md 2 rule 10). The site name and tagline reuse
 * the `site.name` and `site.tagline` keys the seed already writes and the
 * contact page already reads, so this screen edits the same rows the rest of
 * the site does instead of shadowing them.
 *
 * The defaults below are the exact links the header and footer were hardcoded
 * with. That matters for a deployment that upgrades into this feature: with no
 * rows written, the public site renders precisely what it rendered before, and
 * the admin form opens pre-filled with it rather than blank.
 */

export const NAVIGATION_TAG = "site-navigation";

export const NAV_KEYS = {
  brandName: "site.name",
  tagline: "site.tagline",
  contactEmail: "site.email",
  contactPhone: "site.phone",
  contactAddress: "site.address",
  headerLinks: "nav.headerLinks",
  cta: "nav.cta",
  footerCompanyLinks: "nav.footerCompanyLinks",
  footerLegalLinks: "nav.footerLegalLinks",
  socialLinks: "nav.socialLinks",
  copyrightName: "nav.copyrightName",
} as const;

export type SiteNavigation = {
  brandName: string;
  tagline: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  headerLinks: NavItemInput[];
  cta: { enabled: boolean; label: string; href: string };
  footerCompanyLinks: NavItemInput[];
  footerLegalLinks: NavItemInput[];
  socialLinks: SocialLinkInput[];
  copyrightName: string;
};

const link = (label: string, href: string): NavItemInput => ({ label, href, newTab: false });

export const DEFAULT_NAVIGATION: SiteNavigation = {
  brandName: "Emporia",
  tagline: "",
  contactEmail: "",
  contactPhone: "",
  contactAddress: "",
  headerLinks: [
    link("Services", "/services"),
    link("Packages", "/packages"),
    link("Work", "/case-studies"),
    link("Locations", "/cities"),
    link("Insights", "/blog"),
    link("About", "/about"),
  ],
  cta: { enabled: true, label: "Start a project", href: "/contact" },
  footerCompanyLinks: [
    link("About", "/about"),
    link("Work", "/case-studies"),
    link("Insights", "/blog"),
    link("Careers", "/careers"),
    link("Contact", "/contact"),
  ],
  footerLegalLinks: [
    link("Privacy policy", "/privacy-policy"),
    link("Terms", "/terms-and-conditions"),
  ],
  socialLinks: [],
  copyrightName: "Emporia",
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** A value that is legitimately empty: blank stays blank, absent stays blank. */
function readOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/**
 * Parse a stored list, falling back to the default if it will not validate.
 *
 * A row that has been hand-edited, half-migrated or written by an older shape
 * must not take the navigation down: the site keeps rendering the defaults, and
 * the admin sees the defaults in the form. Silence here is deliberate — this
 * runs on every public request, and a log line per request would be noise.
 */
function readList<T>(
  value: unknown,
  parse: (raw: unknown) => { success: true; data: T } | { success: false },
  fallback: T,
): T {
  if (!Array.isArray(value)) return fallback;
  const result = parse(value);
  return result.success ? result.data : fallback;
}

function readCta(value: unknown): SiteNavigation["cta"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_NAVIGATION.cta;
  const raw = value as Record<string, unknown>;
  const href = typeof raw["href"] === "string" ? raw["href"].trim() : "";
  const label = typeof raw["label"] === "string" ? raw["label"].trim() : "";
  const enabled = raw["enabled"] === true && href !== "" && label !== "";
  return { enabled, label, href };
}

/** Uncached loader. Both the public read and the admin read go through this. */
async function loadNavigation(): Promise<SiteNavigation> {
  const rows = await db.siteSetting.findMany({
    where: { key: { in: Object.values(NAV_KEYS) } },
    select: { key: true, value: true },
  });

  const byKey = new Map(rows.map((row) => [row.key, row.value as unknown]));
  const items = (raw: unknown) => navItemSchema.array().safeParse(raw);

  return {
    brandName: readText(byKey.get(NAV_KEYS.brandName), DEFAULT_NAVIGATION.brandName),
    // An empty tagline is a legitimate choice, so this one does not fall back
    // to a default when the row exists and is blank.
    tagline:
      typeof byKey.get(NAV_KEYS.tagline) === "string"
        ? (byKey.get(NAV_KEYS.tagline) as string).trim()
        : DEFAULT_NAVIGATION.tagline,
    contactEmail: readOptionalText(byKey.get(NAV_KEYS.contactEmail)),
    contactPhone: readOptionalText(byKey.get(NAV_KEYS.contactPhone)),
    contactAddress: readOptionalText(byKey.get(NAV_KEYS.contactAddress)),
    headerLinks: readList(byKey.get(NAV_KEYS.headerLinks), items, DEFAULT_NAVIGATION.headerLinks),
    cta: byKey.has(NAV_KEYS.cta) ? readCta(byKey.get(NAV_KEYS.cta)) : DEFAULT_NAVIGATION.cta,
    footerCompanyLinks: readList(
      byKey.get(NAV_KEYS.footerCompanyLinks),
      items,
      DEFAULT_NAVIGATION.footerCompanyLinks,
    ),
    footerLegalLinks: readList(
      byKey.get(NAV_KEYS.footerLegalLinks),
      items,
      DEFAULT_NAVIGATION.footerLegalLinks,
    ),
    socialLinks: readList(
      byKey.get(NAV_KEYS.socialLinks),
      (raw) => socialLinkSchema.array().safeParse(raw),
      DEFAULT_NAVIGATION.socialLinks,
    ),
    copyrightName: readText(byKey.get(NAV_KEYS.copyrightName), DEFAULT_NAVIGATION.copyrightName),
  };
}

/**
 * What the public header and footer render.
 *
 * Cached, unauthenticated, and safe to call from a layout: it reads eight
 * key/value rows and returns plain JSON, so nothing here has to cross the cache
 * boundary as anything but a string, a boolean or an array of them.
 */
export const siteNavigation = unstable_cache(loadNavigation, ["site-navigation"], {
  revalidate: 3600,
  tags: [NAVIGATION_TAG],
});

export async function getNavigationSettings(actor: Actor): Promise<SiteNavigation> {
  requirePermission(actor, "settings.view");
  return loadNavigation();
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function updateNavigationSettings(
  actor: Actor,
  input: NavigationSettingsInput,
): Promise<SiteNavigation> {
  requirePermission(actor, "settings.edit");

  const before = await loadNavigation();

  const values: { key: string; group: string; value: InputJsonValue }[] = [
    { key: NAV_KEYS.brandName, group: "general", value: input.brandName },
    { key: NAV_KEYS.tagline, group: "general", value: input.tagline },
    { key: NAV_KEYS.contactEmail, group: "general", value: input.contactEmail },
    { key: NAV_KEYS.contactPhone, group: "general", value: input.contactPhone },
    { key: NAV_KEYS.contactAddress, group: "general", value: input.contactAddress },
    { key: NAV_KEYS.headerLinks, group: "navigation", value: input.headerLinks },
    {
      key: NAV_KEYS.cta,
      group: "navigation",
      value: { enabled: input.ctaEnabled, label: input.ctaLabel, href: input.ctaHref },
    },
    { key: NAV_KEYS.footerCompanyLinks, group: "navigation", value: input.footerCompanyLinks },
    { key: NAV_KEYS.footerLegalLinks, group: "navigation", value: input.footerLegalLinks },
    { key: NAV_KEYS.socialLinks, group: "navigation", value: input.socialLinks },
    { key: NAV_KEYS.copyrightName, group: "navigation", value: input.copyrightName },
  ];

  await db.$transaction(async (tx) => {
    for (const row of values) {
      await tx.siteSetting.upsert({
        where: { key: row.key },
        // The group is only set on create: a key the seed already placed in a
        // group keeps it rather than being moved by an unrelated edit.
        create: { key: row.key, group: row.group, value: row.value },
        update: { value: row.value },
      });
    }

    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "SiteNavigation",
        entityId: "navigation",
        before,
        after: input,
      },
      tx,
    );
  });

  revalidateTag(NAVIGATION_TAG);
  // The tagline and the site name are read through `siteSettings()` too, which
  // is cached under the pages tag.
  revalidateTag(CACHE_TAGS.pages);

  return loadNavigation();
}
