import { describe, expect, it } from "vitest";
import { BLOCK_SCHEMAS } from "@/lib/content/blocks";
import { select } from "@/lib/content/collections";

/**
 * Dynamic collection blocks.
 *
 * These exist so structured business data stays structured: a block stores a
 * *selection rule*, never a copy of a service's name or a package's price. The
 * tests below are about that rule, and about a block refusing configuration it
 * cannot render.
 */

const rows = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
  { id: "d", name: "Delta" },
];

describe("selection", () => {
  it("takes the collection's own order for latest and featured", () => {
    expect(select(rows, "latest", [], 2).map((r) => r.id)).toEqual(["a", "b"]);
    expect(select(rows, "featured", [], 3).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the editor's order when they picked by hand", () => {
    expect(select(rows, "manual", ["c", "a"], 10).map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("drops a pick whose row is no longer published", () => {
    // A service unpublished after it was chosen should thin the band, not fail
    // the page.
    expect(select(rows, "manual", ["c", "gone", "a"], 10).map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("honours the limit in every mode", () => {
    expect(select(rows, "manual", ["a", "b", "c"], 2)).toHaveLength(2);
    expect(select(rows, "latest", [], 1)).toHaveLength(1);
  });

  it("returns nothing from an empty collection", () => {
    expect(select([], "featured", ["a"], 5)).toEqual([]);
  });
});

describe("collection block schemas", () => {
  const types = [
    "serviceGrid",
    "packageGrid",
    "blogGrid",
    "caseStudyGrid",
    "testimonials",
  ] as const;

  it.each(types)("%s parses with nothing set", (type) => {
    const parsed = BLOCK_SCHEMAS[type].safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBeGreaterThan(0);
      expect(parsed.data.ids).toEqual([]);
    }
  });

  it.each(types)("%s refuses an unlimited limit", (type) => {
    expect(BLOCK_SCHEMAS[type].safeParse({ limit: 0 }).success).toBe(false);
    expect(BLOCK_SCHEMAS[type].safeParse({ limit: 1000 }).success).toBe(false);
  });

  it.each(types)("%s refuses an external link", (type) => {
    expect(
      BLOCK_SCHEMAS[type].safeParse({ linkHref: "https://evil.example.com" }).success,
    ).toBe(false);
    expect(BLOCK_SCHEMAS[type].safeParse({ linkHref: "javascript:alert(1)" }).success).toBe(false);
  });

  it("refuses a selection mode it does not implement", () => {
    expect(BLOCK_SCHEMAS.serviceGrid.safeParse({ mode: "random" }).success).toBe(false);
  });

  it("stores no copy of the entity's own content", () => {
    // The guard against the thing these blocks exist to prevent: if a field for
    // a service's name ever appears here, a price on the homepage can disagree
    // with the price on the package page.
    for (const type of types) {
      const keys = Object.keys(BLOCK_SCHEMAS[type].shape);
      for (const forbidden of ["items", "services", "packages", "posts", "price", "name"]) {
        expect(keys, `${type}.${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("stats", () => {
  it("defaults to real case-study metrics rather than typed numbers", () => {
    const parsed = BLOCK_SCHEMAS.stats.parse({});
    expect(parsed.source).toBe("entered");
    expect(parsed.items).toEqual([]);
  });

  it("accepts typed stats", () => {
    const parsed = BLOCK_SCHEMAS.stats.parse({
      source: "entered",
      items: [{ value: "500", suffix: "+", label: "Clients" }],
    });
    expect(parsed.items[0]).toMatchObject({ value: "500", suffix: "+", label: "Clients" });
  });

  it("requires a number and a label on every stat", () => {
    expect(BLOCK_SCHEMAS.stats.safeParse({ items: [{ value: "", label: "x" }] }).success).toBe(false);
    expect(BLOCK_SCHEMAS.stats.safeParse({ items: [{ value: "5", label: "" }] }).success).toBe(false);
  });
});

describe("the bands lifted out of the homepage", () => {
  it.each(["positioning", "process", "industries"] as const)(
    "%s still accepts the shape the homepage stored",
    (type) => {
      const stored = {
        positioning: {
          eyebrow: "Positioning",
          heading: "A statement.",
          paragraphs: ["One.", "Two."],
        },
        process: {
          eyebrow: "How we work",
          heading: "The sequence",
          steps: [{ title: "First", text: "Text." }],
        },
        industries: {
          eyebrow: "Industries",
          heading: "Where we work",
          body: "Copy.",
          items: ["One", "Two"],
        },
      }[type];

      const parsed = BLOCK_SCHEMAS[type].safeParse(stored);
      expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    },
  );
});

describe("the advanced tab", () => {
  it("accepts an anchor and device visibility on any block", () => {
    const parsed = BLOCK_SCHEMAS.heading.safeParse({
      text: "Heading",
      band: { anchorId: "pricing", hideMobile: true },
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["an uppercase anchor", "Pricing"],
    ["an anchor with a space", "our pricing"],
    ["an anchor starting with a digit", "1-pricing"],
    ["a quote in the anchor", 'x" onmouseover="alert(1)'],
  ])("refuses %s", (_label, anchorId) => {
    expect(
      BLOCK_SCHEMAS.heading.safeParse({ text: "Heading", band: { anchorId } }).success,
    ).toBe(false);
  });
});
