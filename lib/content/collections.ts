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
  return section.type === "stats" && (section.content as { source?: string }).source === "metrics";
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
 * The order is filter → sort → limit, and `manual` skips the first two: an
 * editor who picked five case studies by hand means those five, not those five
 * minus whichever no longer match a filter they also left set. A stale pick is
 * still dropped silently, because a row that has since been unpublished should
 * thin a band rather than fail the page.
 *
 * `featured` is the collection's own order, which every one of these queries
 * already returns sorted the way the entity intends (an explicit `order`
 * column, or newest first). `latest` is the same list. They are separate names
 * because they mean different things to an editor, and because a real
 * `isFeatured` column on any of these entities would change one and not the
 * other.
 *
 * Filtering happens here rather than in the query for the reason the whole
 * module exists: the page fetches each collection once and every block selects
 * from that one cached list. A per-block `where` would mean a query per block
 * and a cache entry per filter combination.
 */
export function select<T extends { id: string }>(
  rows: readonly T[],
  mode: "latest" | "featured" | "manual",
  ids: readonly string[],
  limit: number,
  options?: {
    /** Applied before the limit, so a filtered band still fills up. */
    where?: (row: T) => boolean;
    sort?: (a: T, b: T) => number;
  },
): T[] {
  if (mode === "manual") {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is T => row !== undefined)
      .slice(0, limit);
  }

  let selected = options?.where ? rows.filter(options.where) : [...rows];
  if (options?.sort) selected = [...selected].sort(options.sort);
  return selected.slice(0, limit);
}

/**
 * A filter an editor left blank matches everything.
 *
 * Written out because the alternative — `!value || row.x === value` inline at
 * every call site — is the sort of thing that gets typed as `row.x === value`
 * once and silently empties a band the moment someone saves without choosing.
 */
export function matches(value: string | undefined, actual: string | null | undefined): boolean {
  return !value || actual === value;
}

/** Sorts a name-bearing collection alphabetically, case-insensitively. */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Oldest first. A null date sorts last either way — it was never published. */
export function byOldest<T extends { publishedAt: string | null }>(a: T, b: T): number {
  if (!a.publishedAt) return 1;
  if (!b.publishedAt) return -1;
  return a.publishedAt.localeCompare(b.publishedAt);
}
