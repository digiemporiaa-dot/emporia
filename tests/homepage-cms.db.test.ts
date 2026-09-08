import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { migrateHomepage } from "@/prisma/migrate-homepage";
import { parseSections } from "@/lib/content/sections";
import * as pageService from "@/lib/services/page.service";
import type { Actor } from "@/lib/actor/types";

/**
 * The homepage as a CMS page.
 *
 * The migration runs against production data, so what is tested here is the
 * three properties that make that safe: it never blanks a page, it never edits
 * what an editor arranged, and running it twice does the same thing as running
 * it once.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Editor",
    email: null,
    type: "STAFF",
    roleName: "CONTENT_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

/** The five sections the hand-composed homepage read, as it stored them. */
const LEGACY = [
  {
    type: "hero",
    content: {
      eyebrow: "Independent digital marketing",
      heading: "Marketing that survives the question.",
      body: "We run SEO, paid media, content and analytics.",
      ctaLabel: "Start a project",
      ctaHref: "/contact",
      secondaryLabel: "See the work",
      secondaryHref: "/case-studies",
      facts: [{ label: "Founded", value: "2019" }],
    },
  },
  {
    type: "positioning",
    content: { eyebrow: "Positioning", heading: "A statement.", paragraphs: ["One.", "Two."] },
  },
  {
    type: "process",
    content: { eyebrow: "How", heading: "The sequence", steps: [{ title: "First", text: "T." }] },
  },
  {
    type: "industries",
    content: { eyebrow: "Industries", heading: "Where", body: "", items: ["One"] },
  },
  {
    type: "cta",
    content: { heading: "Ready?", ctaLabel: "Talk to us", ctaHref: "/contact" },
  },
];

describeDb("homepage migration", () => {
  const pages: string[] = [];
  let editor: Actor;

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(user.id, ["pages.view", "pages.create", "pages.edit", "pages.publish"]);
  });

  afterAll(async () => {
    if (pages.length > 0) await db.page.deleteMany({ where: { id: { in: pages } } });
    await db.siteSetting.deleteMany({ where: { key: "cms.homepageMigratedAt" } });
  });

  /** A stand-in for the live `home` page, in the state the old code left it. */
  async function legacyHomepage() {
    await db.page.deleteMany({ where: { slug: "home" } });
    const page = await db.page.create({
      data: {
        slug: "home",
        title: "Home",
        status: "PUBLISHED",
        publishedAt: new Date(),
        sections: {
          create: LEGACY.map((section, order) => ({ ...section, order })),
        },
      },
      select: { id: true },
    });
    pages.push(page.id);
    return page.id;
  }

  const typesOf = async (pageId: string) =>
    (
      await db.pageSection.findMany({
        where: { pageId },
        orderBy: { order: "asc" },
        select: { type: true },
      })
    ).map((section) => section.type);

  it("adds the bands the old page composed by hand, in the order it rendered them", async () => {
    const pageId = await legacyHomepage();
    await migrateHomepage(db);

    expect(await typesOf(pageId)).toEqual([
      "hero",
      "clientStrip",
      "positioning",
      "serviceGrid",
      "stats",
      "caseStudyGrid",
      "process",
      "industries",
      "packageGrid",
      "testimonials",
      "blogGrid",
      "cta",
    ]);
  });

  it("keeps every section it found", async () => {
    const pageId = await legacyHomepage();
    await migrateHomepage(db);
    const types = await typesOf(pageId);
    for (const legacy of LEGACY) expect(types).toContain(legacy.type);
  });

  it("does nothing the second time", async () => {
    const pageId = await legacyHomepage();
    await migrateHomepage(db);
    const first = await typesOf(pageId);

    const message = await migrateHomepage(db);
    expect(message).toContain("already CMS-driven");
    expect(await typesOf(pageId)).toEqual(first);
  });

  it("leaves an order an editor has already changed alone", async () => {
    const pageId = await legacyHomepage();
    await migrateHomepage(db);

    // An editor moves the CTA to the top and hides the stats.
    const sections = await db.pageSection.findMany({
      where: { pageId },
      orderBy: { order: "asc" },
      select: { id: true, type: true },
    });
    const cta = sections.find((s) => s.type === "cta")!;
    await db.pageSection.update({ where: { id: cta.id }, data: { order: -1 } });

    await migrateHomepage(db);
    expect((await typesOf(pageId))[0]).toBe("cta");
  });

  it("does nothing at all when there is no home page", async () => {
    await db.page.deleteMany({ where: { slug: "home" } });
    const message = await migrateHomepage(db);
    expect(message).toContain("nothing to migrate");
  });

  it("produces sections that all validate and render", async () => {
    const pageId = await legacyHomepage();
    await migrateHomepage(db);

    const rows = await db.pageSection.findMany({
      where: { pageId },
      orderBy: { order: "asc" },
      select: { id: true, type: true, order: true, content: true },
    });
    const parsed = parseSections(rows);

    // Every row survives validation: a band the migration wrote that did not
    // parse would silently vanish from the live homepage.
    expect(parsed).toHaveLength(rows.length);
  });

  it("still lets the builder edit the migrated bands", async () => {
    const pageId = await legacyHomepage();
    await migrateHomepage(db);

    const services = await db.pageSection.findFirstOrThrow({
      where: { pageId, type: "serviceGrid" },
      select: { id: true },
    });

    const saved = await pageService.updateSection(editor, services.id, {
      content: { eyebrow: "Services", heading: "Changed", mode: "latest", layout: "cards", limit: 4 },
    });
    expect((saved.content as { heading: string }).heading).toBe("Changed");
  });
});
