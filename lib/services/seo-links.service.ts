import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { containsPhrase } from "@/lib/seo/keyword";
import { sectionText, inlineLinks } from "@/lib/content/text";
import type { Actor } from "@/lib/actor/types";

/**
 * Internal linking, from the relationships that already exist.
 *
 * CLAUDE.md 9: "Internal linking is contextual and derived from relationships.
 * No site-wide link dumps." So this does not propose a footer of every page on
 * the site. It looks at what this page actually says, and names the published
 * things it mentions by name but does not link to.
 *
 * Everything here is a **suggestion**. Nothing is applied, and nothing can be:
 * these functions read. Rewriting an editor's copy to insert a link is the kind
 * of helpfulness that quietly changes what a page claims, and the master brief
 * is explicit that suggestions stay suggestions.
 */

/** Something worth linking to, and where it lives. */
export type LinkTarget = {
  kind: "Service" | "City" | "Blog post" | "Case study" | "Package";
  name: string;
  path: string;
};

export type LinkSuggestion = LinkTarget & {
  /** How many times the page names it without linking. */
  mentions: number;
};

/**
 * Every path a link could legitimately point at.
 *
 * Used by the analyzer's broken-link check, which is why it includes the fixed
 * routes and active redirects as well as content: a link to `/contact` is not
 * broken, and neither is one to an address that redirects.
 */
const FIXED_PATHS = [
  "/",
  "/about",
  "/services",
  "/cities",
  "/packages",
  "/case-studies",
  "/blog",
  "/contact",
  "/careers",
  "/privacy-policy",
  "/terms-and-conditions",
];

export async function knownPaths(): Promise<Set<string>> {
  const [pages, services, cities, serviceCities, packages, posts, caseStudies, redirects] =
    await Promise.all([
      db.page.findMany({
        where: { status: "PUBLISHED", deletedAt: null },
        select: { slug: true },
      }),
      db.service.findMany({ where: { status: "PUBLISHED" }, select: { slug: true } }),
      db.city.findMany({ where: { isActive: true }, select: { slug: true } }),
      db.serviceCityPage.findMany({
        where: { status: "PUBLISHED" },
        select: { service: { select: { slug: true } }, city: { select: { slug: true } } },
      }),
      db.servicePackage.findMany({ where: { status: "PUBLISHED" }, select: { slug: true } }),
      db.blogPost.findMany({ where: { status: "PUBLISHED" }, select: { slug: true } }),
      db.caseStudy.findMany({ where: { status: "PUBLISHED" }, select: { slug: true } }),
      db.redirect.findMany({ where: { isActive: true }, select: { fromPath: true } }),
    ]);

  const paths = new Set<string>(FIXED_PATHS);
  for (const row of pages) paths.add(`/${row.slug}`);
  for (const row of services) paths.add(`/services/${row.slug}`);
  for (const row of cities) paths.add(`/cities/${row.slug}`);
  for (const row of serviceCities) {
    paths.add(`/services/${row.service.slug}/${row.city.slug}`);
  }
  for (const row of packages) paths.add(`/packages/${row.slug}`);
  for (const row of posts) paths.add(`/blog/${row.slug}`);
  for (const row of caseStudies) paths.add(`/case-studies/${row.slug}`);
  for (const row of redirects) paths.add(row.fromPath);

  return paths;
}

/** Everything published that a page could contextually link to. */
async function linkTargets(): Promise<LinkTarget[]> {
  const [services, cities, posts, caseStudies, packages] = await Promise.all([
    db.service.findMany({ where: { status: "PUBLISHED" }, select: { name: true, slug: true } }),
    db.city.findMany({ where: { isActive: true }, select: { name: true, slug: true } }),
    db.blogPost.findMany({
      where: { status: "PUBLISHED" },
      select: { title: true, slug: true },
      take: 200,
    }),
    db.caseStudy.findMany({
      where: { status: "PUBLISHED" },
      select: { title: true, slug: true },
      take: 200,
    }),
    db.servicePackage.findMany({
      where: { status: "PUBLISHED" },
      select: { name: true, slug: true },
    }),
  ]);

  return [
    ...services.map((row) => ({
      kind: "Service" as const,
      name: row.name,
      path: `/services/${row.slug}`,
    })),
    ...cities.map((row) => ({
      kind: "City" as const,
      name: row.name,
      path: `/cities/${row.slug}`,
    })),
    ...posts.map((row) => ({
      kind: "Blog post" as const,
      name: row.title,
      path: `/blog/${row.slug}`,
    })),
    ...caseStudies.map((row) => ({
      kind: "Case study" as const,
      name: row.title,
      path: `/case-studies/${row.slug}`,
    })),
    ...packages.map((row) => ({
      kind: "Package" as const,
      name: row.name,
      path: `/packages/${row.slug}`,
    })),
  ];
}

/**
 * What this page names but does not link to.
 *
 * A one-word name is skipped. "Design" is a service and also an ordinary
 * English word, and a suggestion that fires on every page that says "design" is
 * a suggestion an editor learns to dismiss without reading — at which point the
 * genuinely useful ones go with it.
 */
export async function linkSuggestions(
  actor: Actor,
  pageId: string,
  limit = 8,
): Promise<LinkSuggestion[]> {
  requirePermission(actor, "pages.view");

  const page = await db.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: {
      slug: true,
      sections: {
        where: { isVisible: true },
        select: { type: true, content: true },
      },
    },
  });
  if (!page) return [];

  let text = "";
  const linked = new Set<string>();
  for (const section of page.sections) {
    const extracted = sectionText(section.type, section.content);
    text += ` ${extracted.text}`;
    for (const href of extracted.links) if (href.startsWith("/")) linked.add(href);

    const content = (section.content ?? {}) as Record<string, unknown>;
    if (typeof content["body"] === "string") {
      for (const href of inlineLinks(content["body"])) linked.add(href);
    }
  }

  const ownPath = `/${page.slug}`;
  const targets = await linkTargets();

  const suggestions: LinkSuggestion[] = [];
  for (const target of targets) {
    if (target.path === ownPath) continue;
    if (linked.has(target.path)) continue;
    if (target.name.trim().split(/\s+/).length < 2) continue;
    if (!containsPhrase(text, target.name)) continue;
    suggestions.push({ ...target, mentions: 1 });
  }

  // Most specific first: a case study or post named in the copy is a better
  // link than the service it belongs to, which the page probably links already.
  const order: Record<LinkTarget["kind"], number> = {
    "Case study": 0,
    "Blog post": 1,
    Package: 2,
    Service: 3,
    City: 4,
  };
  suggestions.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));

  return suggestions.slice(0, limit);
}
