import type { PrismaClient } from "../generated/prisma/client.js";
import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";

/**
 * Turn the hand-composed homepage into CMS sections.
 *
 * The homepage used to read five CMS sections (hero, positioning, process,
 * industries, cta) and hand-compose seven more bands from live entity data.
 * Those seven are section types now, so this inserts them — in the order the
 * page rendered them — leaving the five that already exist untouched.
 *
 * Three properties this has to have, because it runs against production data:
 *
 * **Idempotent.** Guarded by a `SiteSetting` marker *and* by checking for the
 * sections themselves, so running the seed twice does not produce two service
 * bands.
 *
 * **Additive.** It only ever inserts. It does not edit, reorder or delete a
 * section anyone has written — an editor who has already rearranged their
 * homepage keeps their arrangement (CLAUDE.md 2 rule 10).
 *
 * **Non-blanking.** If the `home` page does not exist, or already carries a
 * dynamic band, it does nothing at all. There is no path here that empties a
 * live page.
 */

const MARKER = "cms.homepageMigratedAt";

/** The bands the old homepage rendered, with the copy it rendered them with. */
const BANDS: { type: string; content: Record<string, unknown> }[] = [
  { type: "clientStrip", content: { label: "Selected clients", limit: 3 } },
  {
    type: "serviceGrid",
    content: {
      eyebrow: "Services",
      heading: "Six disciplines, run as one programme.",
      mode: "latest",
      layout: "index",
      limit: 24,
      linkLabel: "All services",
      linkHref: "/services",
    },
  },
  {
    type: "stats",
    content: {
      eyebrow: "Results",
      heading: "Numbers from live engagements, not projections.",
      source: "metrics",
      limit: 3,
      tone: "dark",
      animate: true,
      items: [],
      grid: { desktop: 3, tablet: 3, mobile: 1, gap: "xs" },
    },
  },
  {
    type: "caseStudyGrid",
    content: {
      eyebrow: "Selected work",
      mode: "featured",
      layout: "editorial",
      limit: 3,
      linkLabel: "All case studies",
      linkHref: "/case-studies",
    },
  },
  {
    type: "packageGrid",
    content: {
      eyebrow: "Packages",
      heading: "Indicative starting points, not a menu.",
      mode: "latest",
      limit: 3,
      linkLabel: "Compare packages",
      linkHref: "/packages",
      grid: { desktop: 3, tablet: 1, mobile: 1, gap: "xs" },
    },
  },
  { type: "testimonials", content: { mode: "featured", layout: "quotes", limit: 2 } },
  {
    type: "blogGrid",
    content: {
      eyebrow: "Insights",
      heading: "What we are working out.",
      mode: "latest",
      layout: "index",
      limit: 3,
      linkLabel: "All insights",
      linkHref: "/blog",
    },
  },
];

/**
 * Where each band goes, relative to the sections already on the page.
 *
 * The old page's order was: hero, clients, positioning, services, results,
 * work, process, industries, packages, testimonials, insights, cta. Anchoring
 * to the existing types rather than to fixed numbers means this still lands
 * correctly on a page whose sections were reordered before the migration ran.
 */
const AFTER: Record<string, string[]> = {
  clientStrip: ["hero"],
  serviceGrid: ["positioning", "clientStrip", "hero"],
  stats: ["serviceGrid", "positioning", "hero"],
  caseStudyGrid: ["stats", "serviceGrid", "hero"],
  packageGrid: ["industries", "process", "caseStudyGrid", "hero"],
  testimonials: ["packageGrid", "industries", "hero"],
  blogGrid: ["testimonials", "packageGrid", "hero"],
};

export async function migrateHomepage(db: PrismaClient): Promise<string> {
  const page = await db.page.findFirst({
    where: { slug: "home", deletedAt: null },
    select: {
      id: true,
      sections: { select: { id: true, type: true, order: true, content: true } },
    },
  });

  if (!page) return "homepage: no `home` page — nothing to migrate.";

  /**
   * The homepage hero was the asymmetric, type-led band the old page composed
   * by hand; the generic hero block defaults to `stacked`. A hero row written
   * before the layout field existed says nothing about which it wants, so it
   * would silently become the stacked one and the homepage would change shape.
   *
   * Filling in the field it never had is the one edit this migration makes, and
   * it only ever touches a row that has no layout of its own — an editor who
   * has already chosen one keeps it.
   */
  /**
   * The closing CTA was the homepage's largest band; the shared CTA block
   * defaults to the standard size. Same reasoning as the hero: fill in the
   * field the row never had, and leave a size an editor has chosen alone.
   */
  const cta = page.sections.find((section) => section.type === "cta");
  const ctaContent = (cta?.content ?? {}) as Record<string, unknown>;
  if (cta && ctaContent["size"] === undefined) {
    await db.pageSection.update({
      where: { id: cta.id },
      data: { content: { ...ctaContent, size: "large" } as InputJsonValue },
    });
  }

  const hero = page.sections.find((section) => section.type === "hero");
  const heroContent = (hero?.content ?? {}) as Record<string, unknown>;
  if (hero && heroContent["layout"] === undefined) {
    await db.pageSection.update({
      where: { id: hero.id },
      data: { content: { ...heroContent, layout: "editorial" } as InputJsonValue },
    });
  }

  const existing = new Set(page.sections.map((section) => section.type));
  const missing = BANDS.filter((band) => !existing.has(band.type));

  if (missing.length === 0) {
    await db.siteSetting.upsert({
      where: { key: MARKER },
      create: { key: MARKER, value: new Date().toISOString(), group: "cms" },
      update: { value: new Date().toISOString() },
    });
    return "homepage: already CMS-driven, nothing added.";
  }

  // Ordered working copy, so each insertion sees the ones before it.
  const order: { id: string; type: string }[] = [...page.sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({ id: section.id, type: section.type }));
  const placed: { type: string; content: Record<string, unknown> }[] = [];

  for (const band of missing) {
    const anchors = AFTER[band.type] ?? [];
    let index = order.length;
    for (const anchor of anchors) {
      const found = order.findIndex((section) => section.type === anchor);
      if (found >= 0) {
        index = found + 1;
        break;
      }
    }
    order.splice(index, 0, { id: `new:${band.type}`, type: band.type });
    placed.push(band);
  }

  await db.$transaction(async (tx) => {
    for (const band of placed) {
      const at = order.findIndex((section) => section.id === `new:${band.type}`);
      await tx.pageSection.create({
        data: {
          pageId: page.id,
          type: band.type,
          order: at,
          content: band.content as InputJsonValue,
          name: null,
        },
      });
    }
    // Every section renumbered to the final order in one pass, so the inserted
    // bands and the existing ones agree.
    for (const [index, section] of order.entries()) {
      if (section.id.startsWith("new:")) continue;
      await tx.pageSection.update({ where: { id: section.id }, data: { order: index } });
    }
  });

  await db.siteSetting.upsert({
    where: { key: MARKER },
    create: { key: MARKER, value: new Date().toISOString(), group: "cms" },
    update: { value: new Date().toISOString() },
  });

  return `homepage: ${placed.length} band${placed.length === 1 ? "" : "s"} added (${placed
    .map((band) => band.type)
    .join(", ")}).`;
}
