import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { ensureStarterPages, STARTER_PAGES } from "@/prisma/ensure-starter-pages";
import { setPageStatus } from "@/lib/services/page.service";
import { publicNavigation, withoutPaths, DEFAULT_NAVIGATION, NAV_KEYS } from "@/lib/services/navigation.service";
import { STARTER_MARKER, internalPath, starterSectionCount } from "@/lib/content/starter";
import { BLOCK_SCHEMAS, blockWarnings, isBlockType } from "@/lib/content/blocks";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor/types";

/**
 * Starter pages (launch prep): a fresh install gets About, Careers, Privacy
 * Policy and Terms as drafts — their slugs are reserved, so nothing else can
 * create them — with every paragraph marked as starter text. A marked page
 * cannot be published, and the header and footer hide links to pages that are
 * not live, so a visitor never meets a placeholder or a 404 from a menu.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const prisma = db as unknown as PrismaClient;
const SLUGS = STARTER_PAGES.map((page) => page.slug);

describe("starter text, pure", () => {
  it("counts sections carrying the marker", () => {
    expect(starterSectionCount([{ content: { body: `${STARTER_MARKER} write this` } }, { content: { body: "Real text" } }, { content: null }])).toBe(1);
    expect(starterSectionCount([{ content: { items: [{ text: `x ${STARTER_MARKER}` }] } }])).toBe(1);
  });

  it("normalises internal link paths and ignores external ones", () => {
    expect(internalPath("/about")).toBe("/about");
    expect(internalPath("/about/")).toBe("/about");
    expect(internalPath("/about?x=1#team")).toBe("/about");
    expect(internalPath("/")).toBe("/");
    for (const href of ["https://example.com/about", "//evil.example/about", "mailto:a@b.c", "#top"]) expect(internalPath(href)).toBeNull();
  });

  it("drops only the hidden paths, and switches the button off if it points at one", () => {
    const nav = {
      ...DEFAULT_NAVIGATION,
      headerLinks: [{ label: "About", href: "/about", newTab: false }, { label: "Services", href: "/services", newTab: false }],
      footerLegalLinks: [{ label: "Privacy", href: "/privacy-policy/", newTab: false }, { label: "Elsewhere", href: "https://example.com/privacy-policy", newTab: true }],
      cta: { enabled: true, label: "Careers", href: "/careers" },
    };
    const out = withoutPaths(nav, new Set(["/about", "/privacy-policy", "/careers"]));
    expect(out.headerLinks.map((l) => l.href)).toEqual(["/services"]);
    expect(out.footerLegalLinks.map((l) => l.href)).toEqual(["https://example.com/privacy-policy"]);
    expect(out.cta.enabled).toBe(false);
    expect(withoutPaths(nav, new Set())).toBe(nav);
  });

  it("builds every starter page from builder blocks that validate and warn", () => {
    for (const page of STARTER_PAGES) {
      expect(starterSectionCount(page.sections)).toBe(page.sections.length);
      for (const section of page.sections) {
        expect(isBlockType(section.type)).toBe(true);
        if (!isBlockType(section.type)) continue;
        expect(BLOCK_SCHEMAS[section.type].safeParse(section.content).success).toBe(true);
        expect(blockWarnings(section.type, section.content)).toContain("Starter text to replace before publishing");
      }
    }
  });
});

describeDb("starter pages", () => {
  let staffId = "";
  const publisher = (): Actor =>
    ({ userId: staffId, name: "Editor", email: "e@x.test", type: "STAFF", roleName: "CONTENT_MANAGER", roleId: null, clientId: null, ip: null, userAgent: "vitest", permissions: new Set(["pages.view", "pages.edit", "pages.publish"]) }) as Actor;

  let savedNav: { key: string; value: unknown; group: string }[] = [];
  beforeAll(async () => {
    savedNav = await db.siteSetting.findMany({ where: { key: { in: [NAV_KEYS.headerLinks, NAV_KEYS.footerLegalLinks] } }, select: { key: true, value: true, group: true } });
  });

  const drop = async () => {
    await db.page.deleteMany({ where: { slug: { in: SLUGS } } });
  };

  beforeEach(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    await drop();
  });

  afterAll(async () => {
    // Leave the database as the sync leaves it.
    await drop();
    await db.siteSetting.deleteMany({ where: { key: { in: [NAV_KEYS.headerLinks, NAV_KEYS.footerLegalLinks] } } });
    for (const row of savedNav) await db.siteSetting.create({ data: { key: row.key, group: row.group, value: row.value as object } });
    await ensureStarterPages(prisma);
  });

  it("creates the four pages as drafts, once, and never touches one that exists", async () => {
    expect(await ensureStarterPages(prisma)).toContain("created about, careers, privacy-policy, terms-and-conditions");
    const pages = await db.page.findMany({ where: { slug: { in: SLUGS } }, select: { slug: true, status: true, publishedAt: true, sections: { select: { type: true, content: true } } } });
    expect(pages).toHaveLength(4);
    for (const page of pages) {
      expect(page.status).toBe("DRAFT");
      expect(page.publishedAt).toBeNull();
      expect(starterSectionCount(page.sections)).toBe(page.sections.length);
    }
    expect(await ensureStarterPages(prisma)).toBe("starter pages: already exist.");

    // A soft-deleted page keeps its slug: not recreated, not resurrected.
    await db.page.update({ where: { slug: "careers" }, data: { deletedAt: new Date() } });
    await db.page.delete({ where: { slug: "about" } });
    expect(await ensureStarterPages(prisma)).toContain("created about as drafts");
    expect((await db.page.findUniqueOrThrow({ where: { slug: "careers" } })).deletedAt).not.toBeNull();
  });

  it("refuses to publish while starter text remains, and publishes once it is replaced", async () => {
    await ensureStarterPages(prisma);
    const page = await db.page.findUniqueOrThrow({ where: { slug: "privacy-policy" }, select: { id: true, sections: { select: { id: true, type: true, content: true } } } });
    await expect(setPageStatus(publisher(), page.id, "PUBLISHED")).rejects.toThrow(/7 sections still have starter text/);
    await expect(setPageStatus(publisher(), page.id, "PUBLISHED")).rejects.toBeInstanceOf(ValidationError);

    // Replace all but one: still refused, and says so in the singular.
    const [last, ...rest] = page.sections;
    for (const section of rest) await db.pageSection.update({ where: { id: section.id }, data: { content: { ...(section.content as object), body: "Real policy text." } } });
    await expect(setPageStatus(publisher(), page.id, "PUBLISHED")).rejects.toThrow(/1 section still has starter text/);

    await db.pageSection.update({ where: { id: last!.id }, data: { content: { ...(last!.content as object), body: "Real policy text." } } });
    expect((await setPageStatus(publisher(), page.id, "PUBLISHED")).status).toBe("PUBLISHED");
    // Unpublishing is never blocked.
    expect((await setPageStatus(publisher(), page.id, "DRAFT")).status).toBe("DRAFT");
  });

  it("hides header and footer links to pages that are not live, and shows them once published", async () => {
    await ensureStarterPages(prisma);
    await db.siteSetting.upsert({
      where: { key: NAV_KEYS.headerLinks },
      create: { key: NAV_KEYS.headerLinks, group: "navigation", value: [{ label: "About", href: "/about", newTab: false }, { label: "Services", href: "/services", newTab: false }] },
      update: { value: [{ label: "About", href: "/about", newTab: false }, { label: "Services", href: "/services", newTab: false }] },
    });
    await db.siteSetting.upsert({
      where: { key: NAV_KEYS.footerLegalLinks },
      create: { key: NAV_KEYS.footerLegalLinks, group: "navigation", value: [{ label: "Privacy", href: "/privacy-policy", newTab: false }] },
      update: { value: [{ label: "Privacy", href: "/privacy-policy", newTab: false }] },
    });

    let nav = await publicNavigation();
    expect(nav.headerLinks.map((l) => l.href)).toEqual(["/services"]);
    expect(nav.footerLegalLinks).toEqual([]);

    await db.page.update({ where: { slug: "about" }, data: { status: "PUBLISHED" } });
    nav = await publicNavigation();
    expect(nav.headerLinks.map((l) => l.href)).toEqual(["/about", "/services"]);

    // A deleted page is hidden even if its status says published.
    await db.page.update({ where: { slug: "about" }, data: { deletedAt: new Date() } });
    expect((await publicNavigation()).headerLinks.map((l) => l.href)).toEqual(["/services"]);
  });
});
