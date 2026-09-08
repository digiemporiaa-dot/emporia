import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  DEFAULT_NAVIGATION,
  NAV_KEYS,
  getNavigationSettings,
  siteNavigation,
  updateNavigationSettings,
} from "@/lib/services/navigation.service";
import type { NavigationSettingsInput } from "@/lib/validation/navigation";
import type { Actor } from "@/lib/actor/types";

/**
 * Admin-managed header and footer.
 *
 * The risk this covers is a blank site. Navigation renders on every page, so a
 * missing row, a row written by an older shape, or a row someone hand-edited
 * must all degrade to the built-in defaults rather than removing the menu. The
 * rest is the ordinary contract: the write is permission-checked, audited, and
 * what comes back out is what went in.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Admin",
    email: null,
    type: "STAFF",
    roleName: "ADMIN",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const INPUT: NavigationSettingsInput = {
  brandName: "Emporia Digital",
  tagline: "Growth that compounds",
  contactEmail: "hello@emporia.test",
  contactPhone: "+91 98765 43210",
  contactAddress: "Mumbai",
  headerLinks: [
    { label: "Services", href: "/services", newTab: false },
    { label: "Partners", href: "https://partners.example.com", newTab: true },
  ],
  ctaEnabled: true,
  ctaLabel: "Talk to us",
  ctaHref: "/contact",
  footerCompanyLinks: [{ label: "About", href: "/about", newTab: false }],
  footerLegalLinks: [{ label: "Privacy", href: "/privacy-policy", newTab: false }],
  socialLinks: [{ platform: "linkedin", url: "https://www.linkedin.com/company/emporia" }],
  copyrightName: "Emporia Digital Pvt Ltd",
};

async function wipe() {
  await db.siteSetting.deleteMany({ where: { key: { in: Object.values(NAV_KEYS) } } });
}

describeDb("site navigation", () => {
  let admin: Actor;
  let reader: Actor;

  beforeEach(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    admin = actorWith(staff.id, ["settings.view", "settings.edit"]);
    reader = actorWith(staff.id, ["settings.view"]);
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    // `site.name` and `site.tagline` are seeded rows this suite deletes to test
    // the unconfigured case; put them back so the shared test database is left
    // as the seed leaves it.
    await db.siteSetting.createMany({
      data: [
        { key: NAV_KEYS.brandName, value: "Emporia", group: "general" },
        { key: NAV_KEYS.tagline, value: "Digital marketing that compounds", group: "general" },
      ],
      skipDuplicates: true,
    });
  });

  it("renders the built-in defaults when nothing has been saved", async () => {
    const nav = await siteNavigation();

    expect(nav.headerLinks).toEqual(DEFAULT_NAVIGATION.headerLinks);
    expect(nav.footerLegalLinks).toEqual(DEFAULT_NAVIGATION.footerLegalLinks);
    expect(nav.cta).toEqual(DEFAULT_NAVIGATION.cta);
    expect(nav.brandName).toBe(DEFAULT_NAVIGATION.brandName);
    // Nothing was ever saved, so the footer simply has no contact block.
    expect(nav.contactEmail).toBe("");
    expect(nav.socialLinks).toEqual([]);
  });

  it("round-trips everything an editor changed", async () => {
    await updateNavigationSettings(admin, INPUT);

    const nav = await siteNavigation();
    expect(nav.brandName).toBe("Emporia Digital");
    expect(nav.tagline).toBe("Growth that compounds");
    expect(nav.copyrightName).toBe("Emporia Digital Pvt Ltd");
    expect(nav.headerLinks).toEqual(INPUT.headerLinks);
    expect(nav.cta).toEqual({ enabled: true, label: "Talk to us", href: "/contact" });
    expect(nav.footerCompanyLinks).toEqual(INPUT.footerCompanyLinks);
    expect(nav.socialLinks).toEqual(INPUT.socialLinks);
    expect(nav.contactEmail).toBe("hello@emporia.test");
    expect(nav.contactPhone).toBe("+91 98765 43210");
  });

  it("lets an editor empty a list, and does not resurrect the defaults", async () => {
    // The distinction that matters: "saved as empty" is a choice, "never saved"
    // is not. A footer someone deliberately cleared must stay cleared.
    await updateNavigationSettings(admin, { ...INPUT, footerLegalLinks: [], socialLinks: [] });

    const nav = await siteNavigation();
    expect(nav.footerLegalLinks).toEqual([]);
    expect(nav.socialLinks).toEqual([]);
  });

  it("switching the button off leaves it off, whatever the stored label says", async () => {
    await updateNavigationSettings(admin, { ...INPUT, ctaEnabled: false });
    expect((await siteNavigation()).cta.enabled).toBe(false);
  });

  it("falls back to the defaults for a row that no longer validates", async () => {
    await updateNavigationSettings(admin, INPUT);
    // A hand-edited row, or one left behind by an older shape.
    await db.siteSetting.update({
      where: { key: NAV_KEYS.headerLinks },
      data: { value: [{ label: "Broken", href: "javascript:alert(1)" }] },
    });

    const nav = await siteNavigation();
    expect(nav.headerLinks).toEqual(DEFAULT_NAVIGATION.headerLinks);
    // Only the broken key falls back; the rest of the navigation is unaffected.
    expect(nav.brandName).toBe("Emporia Digital");
  });

  it("falls back when a list row holds something that is not a list at all", async () => {
    await updateNavigationSettings(admin, INPUT);
    await db.siteSetting.update({
      where: { key: NAV_KEYS.footerCompanyLinks },
      data: { value: "About" },
    });

    expect((await siteNavigation()).footerCompanyLinks).toEqual(
      DEFAULT_NAVIGATION.footerCompanyLinks,
    );
  });

  it("refuses to save without settings.edit", async () => {
    await expect(updateNavigationSettings(reader, INPUT)).rejects.toBeInstanceOf(ForbiddenError);
    // And nothing was written on the way to the refusal.
    expect(await db.siteSetting.count({ where: { key: NAV_KEYS.headerLinks } })).toBe(0);
  });

  it("refuses to read without settings.view", async () => {
    const nobody = actorWith(admin.userId, []);
    await expect(getNavigationSettings(nobody)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("audits the change", async () => {
    await updateNavigationSettings(admin, INPUT);

    const entry = await db.auditLog.findFirst({
      where: { entityType: "SiteNavigation", entityId: "navigation" },
      orderBy: { createdAt: "desc" },
      select: { action: true, actorId: true, before: true, after: true },
    });

    expect(entry?.action).toBe("UPDATE");
    expect(entry?.actorId).toBe(admin.userId);
    expect((entry?.after as { brandName?: string } | null)?.brandName).toBe("Emporia Digital");
  });

  it("keeps the seed's group when it takes over an existing key", async () => {
    await updateNavigationSettings(admin, INPUT);

    const brand = await db.siteSetting.findUniqueOrThrow({
      where: { key: NAV_KEYS.brandName },
      select: { group: true },
    });
    // `site.name` predates this screen and belongs to the general group; an
    // edit here must not move it.
    expect(brand.group).toBe("general");
  });
});
