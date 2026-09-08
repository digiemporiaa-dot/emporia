import "server-only";
import {
  publishedCaseStudies,
  publishedPackages,
  publishedPosts,
  publishedServices,
  publishedTestimonials,
  type CaseStudySummary,
  type PackageSummary,
  type PostSummary,
  type ServiceSummary,
  type TestimonialSummary,
} from "@/lib/content/queries";
import type { ParsedSection } from "@/lib/content/sections";

/**
 * Live business data for the dynamic section blocks.
 *
 * The rule these blocks exist to keep: a service's name, a package's price and
 * a case study's metrics live in their own tables and are read from there. A
 * dynamic block stores a *selection rule*, never a copy — so a price changed on
 * the package page is changed on the homepage too, and a block cannot advertise
 * something that is not published (CLAUDE.md 2 rule 5).
 *
 * Everything here goes through the existing cached, tagged queries in
 * `queries.ts`. Nothing new is fetched per block: the page asks once for each
 * collection it actually uses, and the blocks select from what came back. A
 * page with three service blocks issues one services query, not three.
 */

export type PageCollections = {
  services: readonly ServiceSummary[];
  packages: readonly PackageSummary[];
  caseStudies: readonly CaseStudySummary[];
  posts: readonly PostSummary[];
  testimonials: readonly TestimonialSummary[];
};

export const EMPTY_COLLECTIONS: PageCollections = {
  services: [],
  packages: [],
  caseStudies: [],
  posts: [],
  testimonials: [],
};

/** Which collection each dynamic block type needs. */
const NEEDS = {
  serviceGrid: "services",
  packageGrid: "packages",
  blogGrid: "posts",
  caseStudyGrid: "caseStudies",
  clientStrip: "caseStudies",
  testimonials: "testimonials",
} as const;

/** `stats` reads case-study metrics, but only when set to that source. */
function statsNeedsMetrics(section: ParsedSection): boolean {
  return (
    section.type === "stats" &&
    (section.content as { source?: string }).source === "metrics"
  );
}

export async function resolveCollections(
  sections: readonly ParsedSection[],
): Promise<PageCollections> {
  const wanted = new Set<keyof PageCollections>();
  for (const section of sections) {
    const need = NEEDS[section.type as keyof typeof NEEDS];
    if (need) wanted.add(need);
    if (statsNeedsMetrics(section)) wanted.add("caseStudies");
  }

  if (wanted.size === 0) return EMPTY_COLLECTIONS;

  // Fetched whole and sliced per block. The lists are small and already cached,
  // and a per-block `take` would defeat the shared cache entry.
  const [services, packages, caseStudies, posts, testimonials] = await Promise.all([
    wanted.has("services") ? publishedServices() : Promise.resolve([]),
    wanted.has("packages") ? publishedPackages() : Promise.resolve([]),
    wanted.has("caseStudies") ? publishedCaseStudies() : Promise.resolve([]),
    wanted.has("posts") ? publishedPosts() : Promise.resolve([]),
    wanted.has("testimonials") ? publishedTestimonials() : Promise.resolve([]),
  ]);

  return { services, packages, caseStudies, posts, testimonials };
}

/**
 * Apply a block's selection rule to a collection.
 *
 * `manual` keeps the editor's order, and silently drops an id whose row has
 * since been unpublished or deleted — a stale pick should thin a band, not
 * fail the page.
 *
 * `featured` is the collection's own order, which every one of these queries
 * already returns sorted the way the entity intends (an explicit `order`
 * column, or newest first). `latest` is the same list. They are separate names
 * because they mean different things to an editor, and because a real
 * `isFeatured` column on any of these entities would change one and not the
 * other.
 */
export function select<T extends { id: string }>(
  rows: readonly T[],
  mode: "latest" | "featured" | "manual",
  ids: readonly string[],
  limit: number,
): T[] {
  if (mode === "manual") {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is T => row !== undefined)
      .slice(0, limit);
  }
  return rows.slice(0, limit);
}
