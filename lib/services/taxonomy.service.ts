import "server-only";
import { db } from "@/lib/db";
import type { TaxonomyOptions } from "@/lib/content/taxonomy";

/**
 * What the block editor offers as filter options.
 *
 * Loaded once per editor screen and passed down, rather than fetched per block:
 * a page with four dynamic blocks would otherwise issue four identical queries
 * while someone is typing in one of them.
 *
 * Deliberately unfiltered by status. An editor setting up a band for a service
 * that goes live next week should be able to choose it; the *public* query is
 * what enforces publication, and always will — a filter naming a draft service
 * simply matches nothing until it is published.
 */
export async function taxonomyOptions(): Promise<TaxonomyOptions> {
  const [services, cities, categories, tags] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { slug: true, name: true } }),
    db.city.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true } }),
    db.blogCategory.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true } }),
    db.blogTag.findMany({
      orderBy: { name: "asc" },
      take: 200,
      select: { slug: true, name: true },
    }),
  ]);

  return { services, cities, categories, tags };
}
