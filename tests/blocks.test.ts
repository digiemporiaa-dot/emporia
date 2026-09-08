import { describe, expect, it } from "vitest";
import { BLOCK_LIBRARY, BLOCK_SCHEMAS, blockWarnings, isBlockType, mediaIdsIn } from "@/lib/content/blocks";
import { ICON_LABELS, ICON_NAMES } from "@/lib/content/icons";
import { SECTION_SCHEMAS, parseSections } from "@/lib/content/sections";

/**
 * Block registry invariants.
 *
 * The library and the schema map are two hand-maintained lists that must agree;
 * a block present in one and missing from the other fails at runtime, in the
 * builder, in front of an editor.
 */

describe("block library", () => {
  it("every library entry has a schema, and every schema an entry", () => {
    const libraryTypes = BLOCK_LIBRARY.map((block) => block.type).sort();
    const schemaTypes = Object.keys(BLOCK_SCHEMAS).sort();
    expect(libraryTypes).toEqual(schemaTypes);
  });

  it("every block's defaults satisfy its own schema", () => {
    for (const block of BLOCK_LIBRARY) {
      const result = BLOCK_SCHEMAS[block.type].safeParse(block.defaults);
      expect(result.success, `${block.type}: ${result.success ? "" : result.error.message}`).toBe(true);
    }
  });

  it("blocks are all reachable from the section registry", () => {
    for (const block of BLOCK_LIBRARY) {
      expect(Object.keys(SECTION_SCHEMAS)).toContain(block.type);
    }
  });

  it("does not treat a bespoke section type as a builder block", () => {
    for (const type of ["hero", "legal", "roles", "positioning"]) {
      expect(isBlockType(type)).toBe(false);
    }
  });

  it("ships the fourteen blocks the CMS promises", () => {
    expect(BLOCK_LIBRARY).toHaveLength(14);
  });

  it("every icon in the set has a label", () => {
    for (const name of ICON_NAMES) {
      expect(ICON_LABELS[name], name).toBeTruthy();
    }
    expect(Object.keys(ICON_LABELS).sort()).toEqual([...ICON_NAMES].sort());
  });

  it("refuses an icon outside the curated set", () => {
    expect(BLOCK_SCHEMAS.icon.safeParse({ heading: "Heading", icon: "skull" }).success).toBe(false);
    expect(BLOCK_SCHEMAS.icon.safeParse({ heading: "Heading", icon: "target" }).success).toBe(true);
  });

  it("keeps every card grid to a layout that exists", () => {
    expect(BLOCK_SCHEMAS.iconCards.safeParse({ columns: 5, items: [{ title: "a" }] }).success).toBe(
      false,
    );
    expect(BLOCK_SCHEMAS.imageCards.safeParse({ columns: 4, items: [{ title: "a" }] }).success).toBe(
      false,
    );
  });

  it("caps builder headings at h2 so the page keeps one h1", () => {
    expect(BLOCK_SCHEMAS.heading.safeParse({ text: "Heading", level: 1 }).success).toBe(false);
    expect(BLOCK_SCHEMAS.heading.safeParse({ text: "Heading", level: 2 }).success).toBe(true);
  });

  it("refuses an external call-to-action link", () => {
    const external = BLOCK_SCHEMAS.feature.safeParse({
      heading: "Heading",
      ctaHref: "https://example.com",
    });
    expect(external.success).toBe(false);

    const internal = BLOCK_SCHEMAS.feature.safeParse({ heading: "Heading", ctaHref: "/contact" });
    expect(internal.success).toBe(true);
  });
});

describe("blockWarnings", () => {
  it("reports an image block with no image", () => {
    expect(blockWarnings("image", { width: "container" })).toContain("No image chosen");
    expect(blockWarnings("image", { mediaId: "abc", width: "container" })).toEqual([]);
  });

  it("reports a half-configured call to action, either way round", () => {
    expect(blockWarnings("feature", { heading: "x", ctaLabel: "Go" })).toContain("Button has no link");
    expect(blockWarnings("feature", { heading: "x", ctaHref: "/x" })).toContain(
      "Link has no button label",
    );
  });

  it("reports a table whose cells are all empty", () => {
    expect(blockWarnings("table", { headers: ["a"], rows: [[""], [""]] })).toContain(
      "Every cell is empty",
    );
    expect(blockWarnings("table", { headers: ["a"], rows: [["v"], [""]] })).toEqual([]);
  });

  it("counts image cards that have no image", () => {
    expect(
      blockWarnings("imageCards", { items: [{ title: "a" }, { mediaId: "m", title: "b" }] }),
    ).toContain("1 card without an image");
  });

  it("reports a half-configured second call-to-action button", () => {
    expect(
      blockWarnings("cta", { heading: "x", ctaLabel: "a", ctaHref: "/a", secondaryLabel: "b" }),
    ).toContain("Second button has no link");
  });

  it("says nothing about a bespoke section type", () => {
    expect(blockWarnings("legal", {})).toEqual([]);
  });
});

describe("the promoted cta block", () => {
  /**
   * `cta` existed as a bespoke section before the builder had one. The homepage
   * and two other pages already hold rows in the old shape, so the block schema
   * has to be a superset of it or those sections vanish from live pages.
   */
  it("still parses a row written before the block existed", () => {
    const legacy = {
      heading: "Ready when you are",
      body: "Tell us what you are trying to grow.",
      ctaLabel: "Start a conversation",
      ctaHref: "/contact",
    };
    const result = BLOCK_SCHEMAS.cta.safeParse(legacy);
    expect(result.success).toBe(true);
    // And defaults to the tone those rows already render with.
    expect(result.success && result.data.tone).toBe("navy");
  });

  it("is a builder block now, not a bespoke type", () => {
    expect(isBlockType("cta")).toBe(true);
  });
});

describe("mediaIdsIn", () => {
  it("finds the referenced image", () => {
    expect(mediaIdsIn("image", { mediaId: "m1" })).toEqual(["m1"]);
  });

  it("finds one id per card in an image grid", () => {
    expect(
      mediaIdsIn("imageCards", {
        items: [{ mediaId: "m1", title: "a" }, { title: "b" }, { mediaId: "m2", title: "c" }],
      }),
    ).toEqual(["m1", "m2"]);
  });

  it("returns nothing for a block with no image or a non-block type", () => {
    expect(mediaIdsIn("image", {})).toEqual([]);
    expect(mediaIdsIn("legal", { mediaId: "m1" })).toEqual([]);
    expect(mediaIdsIn("image", null)).toEqual([]);
  });
});

describe("parseSections with blocks", () => {
  it("keeps valid blocks and drops ones that do not match their schema", () => {
    const parsed = parseSections([
      { id: "1", type: "heading", order: 0, content: { text: "Good", level: 2, align: "left" } },
      { id: "2", type: "heading", order: 1, content: { text: "" } },
      { id: "3", type: "table", order: 2, content: { headers: ["A"], rows: [["1"]] } },
      { id: "4", type: "nonsense", order: 3, content: {} },
    ]);

    expect(parsed.map((s) => s.id)).toEqual(["1", "3"]);
  });
});
