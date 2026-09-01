import { describe, expect, it } from "vitest";
import { findSection, parseSections, type RawSection } from "@/lib/content/sections";

/**
 * CMS section content is stored as JSON. Bad data should degrade one band of a
 * page, never take the route down — so these tests are mostly about what gets
 * dropped rather than what gets through.
 */

const hero: RawSection = {
  id: "s1",
  type: "hero",
  order: 1,
  content: { eyebrow: "About", heading: "A heading", body: "Some body copy." },
};

const cta: RawSection = {
  id: "s2",
  type: "cta",
  order: 2,
  content: { heading: "Talk to us", ctaLabel: "Contact", ctaHref: "/contact" },
};

describe("parseSections", () => {
  it("parses known section types in order", () => {
    const parsed = parseSections([hero, cta]);
    expect(parsed.map((s) => s.type)).toEqual(["hero", "cta"]);
  });

  it("drops a section whose type has no schema", () => {
    const parsed = parseSections([hero, { id: "x", type: "carousel", order: 2, content: {} }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type).toBe("hero");
  });

  it("drops a section missing a required field rather than throwing", () => {
    const broken: RawSection = { id: "b", type: "hero", order: 1, content: { body: "no heading" } };
    expect(() => parseSections([broken])).not.toThrow();
    expect(parseSections([broken])).toHaveLength(0);
  });

  it("drops a section whose content is the wrong shape entirely", () => {
    const rubbish: RawSection[] = [
      { id: "a", type: "hero", order: 1, content: "a string" },
      { id: "b", type: "cta", order: 2, content: null },
      { id: "c", type: "values", order: 3, content: { items: "not an array" } },
    ];
    expect(parseSections(rubbish)).toHaveLength(0);
  });

  it("keeps the good sections when one is broken", () => {
    const parsed = parseSections([hero, { id: "bad", type: "cta", order: 2, content: {} }, cta]);
    expect(parsed.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("returns an empty array for no sections", () => {
    expect(parseSections([])).toEqual([]);
  });

  it("allows a roles section with no openings, so an empty state can render", () => {
    const roles: RawSection = {
      id: "r",
      type: "roles",
      order: 1,
      content: { heading: "Open roles", items: [], emptyMessage: "Nothing right now." },
    };
    const parsed = parseSections([roles]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type === "roles" && parsed[0].content.items).toEqual([]);
  });
});

describe("findSection", () => {
  it("returns typed content for a present section", () => {
    const parsed = parseSections([hero, cta]);
    const found = findSection(parsed, "cta");
    expect(found?.ctaHref).toBe("/contact");
  });

  it("returns null when the section is absent", () => {
    expect(findSection(parseSections([hero]), "process")).toBeNull();
  });
});
