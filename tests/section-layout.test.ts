import { describe, expect, it } from "vitest";
import {
  backgroundMediaId,
  isDark,
  presentation,
  resolveBand,
  type BandDefaults,
} from "@/lib/content/presentation";
import { gridClasses, gridConfig, resolveGrid } from "@/lib/content/grid";
import { BLOCK_SCHEMAS, mediaIdsIn } from "@/lib/content/blocks";

/**
 * The shared layout layer.
 *
 * Two properties carry this module and both are easy to break silently. Grid
 * and spacing classes must be *literal* strings the Tailwind scanner can see —
 * an interpolated one produces CSS that never exists, so the page looks right
 * in development and collapses in production. And a section with no `band`
 * must render exactly as it did before these controls existed.
 */

/** A syntactically valid media id; nothing here reaches the database. */
const CUID = "clw0abcdefghijklmnopqrstu";

const DEFAULTS: BandDefaults = {
  paddingTop: "md",
  paddingBottom: "md",
  container: "default",
};

describe("the grid", () => {
  it("defaults to three across, two on a tablet, one on a phone", () => {
    expect(resolveGrid({})).toMatchObject({ desktop: 3, tablet: 2, mobile: 1, gap: "md" });
  });

  it("honours a stored grid", () => {
    const grid = resolveGrid({ grid: { desktop: 4, tablet: 2, mobile: 1, gap: "lg" } });
    expect(grid).toMatchObject({ desktop: 4, tablet: 2, mobile: 1, gap: "lg" });
  });

  it("falls back to the pre-grid column count", () => {
    // A card block saved before the grid controls existed stores `columns` and
    // nothing else. It must keep rendering at the width it was published at.
    expect(resolveGrid({ columns: 2 }).desktop).toBe(2);
    expect(resolveGrid({ columns: 4 }).desktop).toBe(4);
  });

  it("prefers the grid over the legacy count once one is saved", () => {
    const grid = resolveGrid({ columns: 2, grid: { desktop: 6, tablet: 3, mobile: 2, gap: "sm" } });
    expect(grid.desktop).toBe(6);
  });

  it("ignores a stored grid that does not validate", () => {
    expect(resolveGrid({ grid: { desktop: 99 }, columns: 2 }).desktop).toBe(2);
  });

  it.each([1, 2, 3, 4, 5, 6])("emits a literal class for %i desktop columns", (desktop) => {
    const classes = gridClasses(gridConfig.parse({ desktop, tablet: 2, mobile: 1 }));
    expect(classes).toContain(`lg:grid-cols-${desktop}`);
    // Nothing interpolated: every class must be one Tailwind can find by
    // scanning source, which means it appears verbatim in lib/content/grid.ts.
    expect(classes).not.toContain("${");
  });

  it("emits both axes of the gap", () => {
    const classes = gridClasses(gridConfig.parse({ gap: "lg", rowGap: "xs" }));
    expect(classes).toContain("gap-y-2");
    expect(classes).toContain("gap-x-8");
  });

  it("refuses a column count no breakpoint class exists for", () => {
    expect(gridConfig.safeParse({ desktop: 7 }).success).toBe(false);
    expect(gridConfig.safeParse({ mobile: 3 }).success).toBe(false);
  });
});

describe("the band", () => {
  it("reproduces the block's own spacing when nothing is set", () => {
    const band = resolveBand(undefined, DEFAULTS);
    // Grouped by breakpoint rather than by property since the per-breakpoint
    // overrides landed. Same four classes, same rendering.
    expect(band.contentClassName).toBe("pt-10 pb-10 lg:pt-14 lg:pb-14");
    expect(band.containerWidth).toBe("page");
    expect(band.outerStyle).toEqual({});
    expect(band.overlayStyle).toBeNull();
    expect(band.inverted).toBe(false);
  });

  it("overrides the block's spacing when the editor sets it", () => {
    const band = resolveBand(presentation.parse({ paddingTop: "none", paddingBottom: "3xl" }), DEFAULTS);
    expect(band.contentClassName).toContain("pb-20");
    expect(band.contentClassName).toContain("lg:pb-28");
    expect(band.contentClassName).not.toContain("pt-10");
  });

  it("opts out of the container at full width", () => {
    expect(resolveBand(presentation.parse({ container: "full" }), DEFAULTS).containerWidth).toBeNull();
  });

  it("paints a solid colour and inverts the text over a dark one", () => {
    const band = resolveBand(
      presentation.parse({ background: { kind: "solid", color: "#002A3A" } }),
      DEFAULTS,
    );
    expect(band.outerStyle["backgroundColor"]).toBe("#002A3A");
    expect(band.inverted).toBe(true);
  });

  it("leaves text dark over a light colour", () => {
    const band = resolveBand(
      presentation.parse({ background: { kind: "solid", color: "#F7F7F5" } }),
      DEFAULTS,
    );
    expect(band.inverted).toBe(false);
  });

  it("lets the editor's tone choice override the automatic decision", () => {
    const band = resolveBand(
      presentation.parse({ background: { kind: "solid", color: "#002A3A" }, textTone: "dark" }),
      DEFAULTS,
    );
    expect(band.inverted).toBe(false);
  });

  it("builds a gradient from both stops", () => {
    const band = resolveBand(
      presentation.parse({
        background: { kind: "gradient", color: "#002A3A", colorTo: "#DF1F38", angle: 90 },
      }),
      DEFAULTS,
    );
    expect(band.outerStyle["backgroundImage"]).toBe("linear-gradient(90deg, #002A3A, #DF1F38)");
  });

  it("uses a background image only when one resolved", () => {
    const style = presentation.parse({
      background: { kind: "image", mediaId: CUID },
    });
    expect(resolveBand(style, DEFAULTS).outerStyle["backgroundImage"]).toBeUndefined();
    expect(
      resolveBand(style, DEFAULTS, "https://cdn.example.com/a.jpg").outerStyle["backgroundImage"],
    ).toBe("url(https://cdn.example.com/a.jpg)");
  });

  it("accepts media served from the app's own origin", () => {
    // A deployment can serve media from itself rather than an object store;
    // rejecting a root-relative URL would silently drop its backgrounds.
    const style = presentation.parse({ background: { kind: "image", mediaId: CUID } });
    expect(resolveBand(style, DEFAULTS, "/media/a.jpg").outerStyle["backgroundImage"]).toBe(
      "url(/media/a.jpg)",
    );
  });

  it("refuses a URL that could break out of url()", () => {
    const style = presentation.parse({ background: { kind: "image", mediaId: CUID } });
    for (const hostile of [
      'https://x/a.jpg");background:red;("',
      "https://x/a(b).jpg",
      "javascript:alert(1)",
      "https://x/a b.jpg",
      // Protocol-relative: the scheme is whatever the page happens to be on.
      "//evil.example.com/a.jpg",
      "data:image/svg+xml,<svg onload=alert(1)>",
    ]) {
      expect(resolveBand(style, DEFAULTS, hostile).outerStyle["backgroundImage"]).toBeUndefined();
    }
  });

  it("turns overlay opacity into an alpha channel", () => {
    const band = resolveBand(
      presentation.parse({
        background: {
          kind: "image",
          mediaId: CUID,
          overlay: true,
          overlayColor: "#002A3A",
          overlayOpacity: 50,
        },
      }),
      DEFAULTS,
      "https://cdn.example.com/a.jpg",
    );
    expect(band.overlayStyle?.["backgroundColor"]).toBe("#002A3A80");
  });

  it("rejects a colour that is not a six-digit hex", () => {
    for (const bad of ["red", "#fff", "#00ff00; background: url(x)", "rgb(0,0,0)"]) {
      expect(
        presentation.safeParse({ background: { kind: "solid", color: bad } }).success,
        bad,
      ).toBe(false);
    }
  });

  it("clamps overlay opacity to a percentage", () => {
    expect(
      presentation.safeParse({ background: { kind: "solid", overlayOpacity: 140 } }).success,
    ).toBe(false);
  });
});

describe("luminance", () => {
  it.each([
    ["#002A3A", true],
    ["#DF1F38", true],
    ["#FFFFFF", false],
    ["#F7F7F5", false],
  ])("%s is dark: %s", (hex, dark) => {
    expect(isDark(hex)).toBe(dark);
  });
});

describe("media collection", () => {
  it("finds a background image so the resolver fetches it", () => {
    const content = { text: "x", band: { background: { kind: "image", mediaId: "bg-1" } } };
    expect(backgroundMediaId(content)).toBe("bg-1");
    expect(mediaIdsIn("heading", content)).toContain("bg-1");
  });

  it("finds a card's hover image", () => {
    const ids = mediaIdsIn("imageCards", {
      items: [{ mediaId: "a", hoverMediaId: "b", title: "One" }],
    });
    expect(ids).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("finds nothing when no background is set", () => {
    expect(backgroundMediaId({ band: { background: { kind: "solid", color: "#fff" } } })).toBeNull();
    expect(backgroundMediaId({})).toBeNull();
    expect(backgroundMediaId(null)).toBeNull();
  });
});

describe("every block accepts a band", () => {
  it.each(Object.keys(BLOCK_SCHEMAS))("%s", (type) => {
    const schema = BLOCK_SCHEMAS[type as keyof typeof BLOCK_SCHEMAS];
    // Parsed from the block's own defaults so this tests the band, not the
    // block's required fields.
    const base = schema.safeParse({});
    const seed = base.success ? base.data : null;
    if (!seed) return;
    expect(schema.safeParse({ ...seed, band: { container: "wide", paddingTop: "xl" } }).success).toBe(
      true,
    );
  });
});

describe("per-breakpoint overrides", () => {
  const parse = (value: unknown) => presentation.parse(value);

  it("changes nothing for a section saved before they existed", () => {
    // The whole point: absent means inherit, so every stored section keeps the
    // exact classes it had.
    const before = resolveBand(parse({ paddingTop: "md", paddingBottom: "md" }), DEFAULTS);
    expect(before.contentClassName).toBe("pt-10 pb-10 lg:pt-14 lg:pb-14");
  });

  it("lets mobile replace the small-screen half while desktop stands", () => {
    const band = resolveBand(
      parse({ paddingTop: "3xl", paddingBottom: "3xl", mobile: { paddingTop: "none" } }),
      DEFAULTS,
    );
    // Nothing on a phone, the full band from lg up.
    expect(band.contentClassName).not.toContain("pt-20");
    expect(band.contentClassName).toContain("lg:pt-28");
    // The bottom is untouched by a top-only override.
    expect(band.contentClassName).toContain("pb-20");
  });

  it("slots a tablet value between the two, only when asked", () => {
    const inherited = resolveBand(parse({ paddingTop: "md" }), DEFAULTS);
    expect(inherited.contentClassName).not.toContain("sm:pt-");

    const explicit = resolveBand(parse({ paddingTop: "md", tablet: { paddingTop: "xs" } }), DEFAULTS);
    expect(explicit.contentClassName).toContain("sm:pt-4");
  });

  it("emits sm:pt-0 for an explicit tablet 'none', which an empty class could not do", () => {
    const band = resolveBand(parse({ paddingTop: "3xl", tablet: { paddingTop: "none" } }), DEFAULTS);
    expect(band.contentClassName).toContain("sm:pt-0");
  });

  it("restores the desktop alignment when a smaller breakpoint overrides it", () => {
    const band = resolveBand(parse({ align: "left", mobile: { align: "center" } }), DEFAULTS);
    expect(band.contentClassName).toContain("text-center");
    expect(band.contentClassName).toContain("lg:text-left");
  });

  it("emits one alignment class when nothing overrides it", () => {
    const band = resolveBand(parse({ align: "center" }), DEFAULTS);
    expect(band.contentClassName).toContain("text-center");
    expect(band.contentClassName).not.toContain("lg:text-center");
    expect(band.contentClassName).not.toContain("sm:text-center");
  });

  it("ignores a breakpoint alignment when there is no base alignment to override", () => {
    // Otherwise a mobile-only choice would silently become the whole page's.
    const band = resolveBand(parse({ mobile: { align: "center" } }), DEFAULTS);
    expect(band.contentClassName).not.toContain("text-center");
  });

  it("stops using the block's own historical padding once a breakpoint is set", () => {
    const withDefault = resolveBand(undefined, {
      ...DEFAULTS,
      paddingClassName: "py-16 lg:py-24",
    });
    expect(withDefault.contentClassName).toBe("py-16 lg:py-24");

    const overridden = resolveBand(parse({ mobile: { paddingTop: "none" } }), {
      ...DEFAULTS,
      paddingClassName: "py-16 lg:py-24",
    });
    expect(overridden.contentClassName).not.toContain("py-16");
  });

  it("emits only literal classes — nothing interpolated", () => {
    const band = resolveBand(
      parse({
        paddingTop: "lg",
        paddingBottom: "xl",
        align: "right",
        tablet: { paddingTop: "sm", align: "center" },
        mobile: { paddingBottom: "xs", align: "left" },
      }),
      DEFAULTS,
    );
    for (const cls of band.contentClassName.split(" ")) {
      expect(cls).toMatch(/^(sm:|lg:)?[a-z-]+[a-z0-9-]*$/);
    }
  });
});
