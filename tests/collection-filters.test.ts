import { describe, expect, it } from "vitest";
import { byName, byOldest, matches, select } from "@/lib/content/collections";
import { BLOCK_SCHEMAS } from "@/lib/content/blocks";

/**
 * Filtering and sorting a dynamic block's collection.
 *
 * The page fetches each collection once and every block selects from that one
 * cached list, so the filter runs here rather than in the query. Two properties
 * matter: a filter an editor left blank matches everything, and a manual pick
 * is exempt — an editor who chose five case studies by hand means those five,
 * not those five minus whichever no longer match a filter they also left set.
 */

type Row = {
  id: string;
  name: string;
  publishedAt: string | null;
  service?: { slug: string } | null;
  city?: { slug: string } | null;
  rating?: number | null;
};

const rows: Row[] = [
  { id: "a", name: "Charlie", publishedAt: "2026-03-01", service: { slug: "seo" }, city: { slug: "delhi" }, rating: 5 },
  { id: "b", name: "alpha", publishedAt: "2026-01-01", service: { slug: "ads" }, city: { slug: "delhi" }, rating: 3 },
  { id: "c", name: "Bravo", publishedAt: "2026-02-01", service: { slug: "seo" }, city: null, rating: null },
];

describe("matches", () => {
  it("treats a blank filter as everything", () => {
    // The trap: `row.x === value` written inline empties the band the moment
    // someone saves a block without choosing a filter.
    expect(matches(undefined, "seo")).toBe(true);
    expect(matches("", "seo")).toBe(true);
    expect(matches("", null)).toBe(true);
  });

  it("matches exactly when a filter is set", () => {
    expect(matches("seo", "seo")).toBe(true);
    expect(matches("seo", "ads")).toBe(false);
    expect(matches("seo", null)).toBe(false);
  });
});

describe("select", () => {
  it("filters before limiting, so a filtered band still fills up", () => {
    const picked = select(rows, "latest", [], 2, {
      where: (row) => matches("seo", row.service?.slug),
    });
    expect(picked.map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("sorts after filtering", () => {
    const picked = select(rows, "latest", [], 3, {
      where: (row) => matches("delhi", row.city?.slug),
      sort: byName,
    });
    expect(picked.map((row) => row.name)).toEqual(["alpha", "Charlie"]);
  });

  it("exempts a manual pick from both, and keeps the editor's order", () => {
    const picked = select(rows, "manual", ["c", "b"], 5, {
      where: (row) => matches("seo", row.service?.slug),
      sort: byName,
    });
    expect(picked.map((row) => row.id)).toEqual(["c", "b"]);
  });

  it("drops a manual pick whose row is gone, rather than failing the page", () => {
    const picked = select(rows, "manual", ["a", "deleted", "b"], 5);
    expect(picked.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("returns everything when nothing is set", () => {
    expect(select(rows, "latest", [], 10)).toHaveLength(3);
  });

  it("does not mutate the collection it was given", () => {
    const before = rows.map((row) => row.id);
    select(rows, "latest", [], 10, { sort: byName });
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe("sorts", () => {
  it("orders names case-insensitively", () => {
    expect([...rows].sort(byName).map((row) => row.name)).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("puts the oldest first and an unpublished row last", () => {
    const withUnpublished = [...rows, { id: "d", name: "Delta", publishedAt: null }];
    expect([...withUnpublished].sort(byOldest).map((row) => row.id)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("the block schemas carry the filters", () => {
  it("defaults every filter to blank, which means everything", () => {
    const blog = BLOCK_SCHEMAS.blogGrid.parse({});
    expect(blog.categorySlug).toBeUndefined();
    expect(blog.tagSlug).toBeUndefined();
    expect(blog.sort).toBe("newest");

    const studies = BLOCK_SCHEMAS.caseStudyGrid.parse({});
    expect(studies.serviceSlug).toBeUndefined();
    expect(studies.citySlug).toBeUndefined();

    const quotes = BLOCK_SCHEMAS.testimonials.parse({});
    expect(quotes.minRating).toBeUndefined();

    const packages = BLOCK_SCHEMAS.packageGrid.parse({});
    expect(packages.recommendedOnly).toBe(false);

    expect(BLOCK_SCHEMAS.serviceGrid.parse({}).sort).toBe("order");
  });

  it("keeps a block saved before the filters existed parsing unchanged", () => {
    const legacy = { mode: "latest", ids: [], limit: 3, layout: "cards" };
    const parsed = BLOCK_SCHEMAS.caseStudyGrid.parse(legacy);
    expect(parsed.limit).toBe(3);
    expect(parsed.serviceSlug).toBeUndefined();
  });

  it("refuses a rating outside one to five", () => {
    expect(BLOCK_SCHEMAS.testimonials.safeParse({ minRating: 9 }).success).toBe(false);
    expect(BLOCK_SCHEMAS.testimonials.safeParse({ minRating: 0 }).success).toBe(false);
  });
});
