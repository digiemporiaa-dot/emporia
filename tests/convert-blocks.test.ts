import { describe, expect, it } from "vitest";
import {
  BLOCK_GROUPS,
  BLOCK_LIBRARY,
  BLOCK_SCHEMAS,
  blockWarnings,
  mediaIdsIn,
} from "@/lib/content/blocks";
import { parseSections } from "@/lib/content/sections";

/**
 * The conversion, trust and rich-content blocks.
 *
 * Content is stored as JSON, so what matters is that each schema accepts its
 * own defaults, rejects the shapes that would render badly, and that the media
 * a block references is collected for batch resolution — a miss there is not a
 * type error, it is an image that silently does not appear.
 */

const NEW_BLOCKS = [
  "leadForm",
  "stickyCta",
  "team",
  "gallery",
  "video",
  "tabs",
  "timeline",
  "comparisonTable",
] as const;

describe("the new blocks", () => {
  it("are all in the library, with a schema each", () => {
    for (const type of NEW_BLOCKS) {
      expect(BLOCK_SCHEMAS[type], type).toBeDefined();
      expect(
        BLOCK_LIBRARY.find((block) => block.type === type),
        type,
      ).toBeDefined();
    }
  });

  it("are reachable from the Add Section list", () => {
    // The bug this pins: the modal renders groups from an ordered array, and a
    // block whose group is missing from it is invisible — schema, renderer and
    // all. Found by opening the modal, not by reading the code.
    const groups = new Set(BLOCK_GROUPS);
    for (const definition of BLOCK_LIBRARY) {
      expect(
        groups.has(definition.group),
        `${definition.type} is in group "${definition.group}"`,
      ).toBe(true);
    }
  });

  it("accept their own defaults — a block added from the library must parse", () => {
    for (const type of NEW_BLOCKS) {
      const definition = BLOCK_LIBRARY.find((block) => block.type === type);
      const result = BLOCK_SCHEMAS[type].safeParse(definition?.defaults);
      expect(result.success, `${type}: ${result.success ? "" : result.error.message}`).toBe(true);
    }
  });

  it("accept every preset", () => {
    for (const definition of BLOCK_LIBRARY) {
      for (const preset of definition.presets ?? []) {
        const merged = { ...definition.defaults, ...preset.defaults };
        const result = BLOCK_SCHEMAS[definition.type].safeParse(merged);
        expect(
          result.success,
          `${definition.type} / ${preset.label}: ${result.success ? "" : result.error.message}`,
        ).toBe(true);
      }
    }
  });
});

describe("leadForm", () => {
  it("defaults to the full enquiry variant", () => {
    const parsed = BLOCK_SCHEMAS.leadForm.parse({ submitLabel: "Send" });
    expect(parsed.variant).toBe("lead");
    expect(parsed.successMessage.length).toBeGreaterThan(0);
  });

  it("keeps a configured service, which the capture path reads instead of the request body", () => {
    const parsed = BLOCK_SCHEMAS.leadForm.parse({ serviceSlug: "seo", submitLabel: "Send" });
    expect(parsed.serviceSlug).toBe("seo");
  });

  it("rejects a variant it has no fields for", () => {
    expect(BLOCK_SCHEMAS.leadForm.safeParse({ variant: "payment" }).success).toBe(false);
  });
});

describe("stickyCta", () => {
  it("requires somewhere to go", () => {
    expect(
      BLOCK_SCHEMAS.stickyCta.safeParse({ text: "Hi", buttonLabel: "Go", target: "" }).success,
    ).toBe(false);
  });

  it("caps the scroll trigger so a bar cannot be configured never to appear", () => {
    expect(
      BLOCK_SCHEMAS.stickyCta.safeParse({
        text: "Hi",
        buttonLabel: "Go",
        target: "/contact",
        showAfterScroll: 200,
      }).success,
    ).toBe(false);
  });
});

describe("comparisonTable", () => {
  it("takes a tick, a cross or free text in a cell", () => {
    const parsed = BLOCK_SCHEMAS.comparisonTable.parse({
      columns: [{ label: "Starter" }, { label: "Growth" }],
      rows: [{ label: "Reports", cells: [true, "Weekly"] }],
    });
    expect(parsed.rows[0]?.cells).toEqual([true, "Weekly"]);
  });

  it("refuses a column with no label, which would render as a blank heading", () => {
    expect(
      BLOCK_SCHEMAS.comparisonTable.safeParse({ columns: [{ label: "" }], rows: [] }).success,
    ).toBe(false);
  });

  it("accepts an empty table on the way in and back out again", () => {
    // The trap this pins: `.min(1).default([])` parses on the way in, because
    // zod does not re-validate a default, and then fails on the way back out —
    // which drops the block from the page rather than showing it empty.
    const parsed = BLOCK_SCHEMAS.comparisonTable.parse({});
    expect(BLOCK_SCHEMAS.comparisonTable.safeParse(parsed).success).toBe(true);
  });

  it("says in the builder when a table has nothing in it", () => {
    expect(blockWarnings("comparisonTable", { columns: [], rows: [] })).toEqual([
      "No columns yet",
      "No rows yet",
    ]);
  });
});

describe("media collection", () => {
  it("collects every image a team block references", () => {
    const ids = mediaIdsIn("team", {
      items: [
        { name: "A", mediaId: "media-1" },
        { name: "B", mediaId: "media-2" },
      ],
    });
    expect(ids).toEqual(["media-1", "media-2"]);
  });

  it("collects every image a gallery references, including its background", () => {
    const ids = mediaIdsIn("gallery", {
      items: [{ mediaId: "media-1" }, { mediaId: "media-2" }],
      band: { background: { kind: "image", mediaId: "media-bg" } },
    });
    expect(ids).toContain("media-1");
    expect(ids).toContain("media-2");
    expect(ids).toContain("media-bg");
  });
});

describe("builder warnings", () => {
  it("says when a video has no URL yet", () => {
    expect(blockWarnings("video", { provider: "youtube", video: "" })).toContain("No video chosen");
  });

  it("says when a video URL is one we cannot embed, rather than leaving a gap on the page", () => {
    const warnings = blockWarnings("video", {
      provider: "youtube",
      video: "https://evil.example/watch?v=dQw4w9WgXcQ",
    });
    expect(warnings.join(" ")).toMatch(/cannot embed|not one we can embed/);
  });

  it("says nothing when the URL is good", () => {
    expect(
      blockWarnings("video", {
        provider: "youtube",
        video: "https://youtu.be/dQw4w9WgXcQ",
      }),
    ).toEqual([]);
  });
});

describe("rendering safety", () => {
  it("drops a block whose stored content no longer validates, rather than the page", () => {
    const sections = parseSections([
      { id: "a", type: "timeline", order: 0, content: { items: [{ title: "Step one" }] } },
      // A row that has lost its required label.
      { id: "b", type: "comparisonTable", order: 1, content: { columns: [{}], rows: [] } },
    ]);
    expect(sections.map((section) => section.id)).toEqual(["a"]);
  });
});
