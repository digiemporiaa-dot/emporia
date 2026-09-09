import { describe, expect, it } from "vitest";
import {
  CURRENT_VERSION,
  contentVersion,
  migrateContent,
  stampVersion,
} from "@/lib/content/migrations";
import { parseSections } from "@/lib/content/sections";

/**
 * Block content versioning.
 *
 * The mechanism ships before the first schema change needs it, so what can be
 * tested today is the ladder's behaviour rather than a real migration: content
 * written before versioning existed is treated as version 1, current content is
 * returned untouched, and content from a newer deployment is left alone rather
 * than mangled by a build that does not understand it.
 */

describe("content version", () => {
  it("treats content written before versioning as version 1", () => {
    expect(contentVersion({ heading: "Written last year" })).toBe(1);
    expect(contentVersion({ heading: "x", version: 0 })).toBe(1);
    expect(contentVersion({ heading: "x", version: "2" })).toBe(1);
  });

  it("reads a stamped version", () => {
    expect(contentVersion({ heading: "x", version: 3 })).toBe(3);
  });

  it("assumes current for something that is not an object at all", () => {
    expect(contentVersion(null)).toBe(CURRENT_VERSION);
    expect(contentVersion("nonsense")).toBe(CURRENT_VERSION);
  });
});

describe("migrateContent", () => {
  it("returns current content unchanged, allocating nothing", () => {
    const content = { heading: "Current", version: CURRENT_VERSION };
    expect(migrateContent(content, "heading")).toBe(content);
  });

  it("leaves content from a newer deployment alone", () => {
    // A build running behind the database must not rewrite a shape it does not
    // understand; the schema parse decides whether it still renders.
    const future = { heading: "From tomorrow", version: CURRENT_VERSION + 5 };
    expect(migrateContent(future, "heading")).toBe(future);
  });

  it("passes non-objects straight through", () => {
    expect(migrateContent(null, "heading")).toBeNull();
    expect(migrateContent([1, 2], "heading")).toEqual([1, 2]);
  });
});

describe("stampVersion", () => {
  it("records the version that produced the content", () => {
    expect(stampVersion({ heading: "New" })).toEqual({
      heading: "New",
      version: CURRENT_VERSION,
    });
  });

  it("survives a round trip through the renderer", () => {
    // The stamp lives outside the block schema, so parsing strips it — which is
    // fine, because migrateContent reads it off the raw row beforehand.
    const stored = stampVersion({ body: "Hello" });
    const [section] = parseSections([
      { id: "a", type: "richText", order: 0, content: stored },
    ]);
    expect(section?.type).toBe("richText");
    expect((section?.content as { body?: string }).body).toBe("Hello");
  });
});
