/**
 * The things a dynamic block can filter by.
 *
 * Every one already exists as a table — services, cities, blog categories, blog
 * tags. There is no separate taxonomy system and there should not be one: a
 * "category" that is not the same row the blog index links to is a second
 * source of truth for the same idea (CLAUDE.md 4).
 *
 * Types and the empty value live here, with no database import, because the
 * block editor is a client component and needs them. The query that fills them
 * is lib/services/taxonomy.service.ts.
 *
 * Slugs, not ids, because that is what a block stores — see the note on
 * `serviceGridBlock` in lib/content/blocks.ts.
 */

export type TaxonomyOption = { slug: string; name: string };

export type TaxonomyOptions = {
  services: TaxonomyOption[];
  cities: TaxonomyOption[];
  categories: TaxonomyOption[];
  tags: TaxonomyOption[];
};

export const EMPTY_TAXONOMY: TaxonomyOptions = {
  services: [],
  cities: [],
  categories: [],
  tags: [],
};
