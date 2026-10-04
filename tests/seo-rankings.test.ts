import { describe, expect, it } from "vitest";
import {
  bandOf,
  findOpportunities,
  movementOf,
  normalizeKeyword,
  ownCtrCurve,
  parseKeywordList,
  parseTags,
  MAX_KEYWORD_LENGTH,
} from "@/lib/seo-intel/engine/rankings";

describe("keyword input", () => {
  it("normalises to Search Console's form", () => {
    expect(normalizeKeyword("  SEO   Agency\tDubai ")).toBe("seo agency dubai");
    expect(normalizeKeyword("Ｓｅｏ")).toBe("seo");
    expect(normalizeKeyword("   ")).toBeNull();
    expect(normalizeKeyword("x".repeat(MAX_KEYWORD_LENGTH + 1))).toBeNull();
  });

  it("parses a pasted list, collapsing duplicates and reporting junk", () => {
    const { keywords, rejected } = parseKeywordList(`seo agency\nSEO Agency, ppc dubai\n\n${"y".repeat(300)}`);
    expect(keywords).toEqual(["seo agency", "ppc dubai"]);
    expect(rejected).toHaveLength(1);
  });

  it("parses tags", () => {
    expect(parseTags(" Dubai, seo ,dubai,, ")).toEqual(["dubai", "seo"]);
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(","))).toHaveLength(10);
  });
});

describe("movement", () => {
  const m = (position: number | null, impressions = 100) => ({ clicks: 1, impressions: position === null ? 0 : impressions, position });

  it("bands by rounded average position", () => {
    expect(bandOf(3.4)).toBe("top3");
    expect(bandOf(3.5)).toBe("top10");
    expect(bandOf(10.4)).toBe("top10");
    expect(bandOf(20.6)).toBe("beyond");
    expect(bandOf(null)).toBe("none");
  });

  it("measures change as places moved up, ignoring sub-half-place noise", () => {
    expect(movementOf(m(4), m(9))).toMatchObject({ change: 5, status: "improved", entered: null, left: null });
    expect(movementOf(m(4), m(14))).toMatchObject({ change: 10, status: "improved", entered: "top10", left: null });
    expect(movementOf(m(12), m(2))).toMatchObject({ change: -10, status: "declined", entered: null, left: "top3" });
    expect(movementOf(m(5.2), m(5.6))).toMatchObject({ status: "steady" });
  });

  it("reports the best band entered, not every band crossed", () => {
    expect(movementOf(m(2), m(25)).entered).toBe("top3");
    expect(movementOf(m(25), m(2)).left).toBe("top3");
  });

  it("knows new, lost and absent keywords", () => {
    expect(movementOf(m(8), m(null))).toMatchObject({ status: "new", change: null, entered: "top10" });
    expect(movementOf(m(null), m(8))).toMatchObject({ status: "lost", change: null, left: "top10" });
    expect(movementOf(m(null), m(null)).status).toBe("absent");
  });
});

describe("own CTR curve and opportunities", () => {
  const rows = [
    { position: 1, clicks: 300, impressions: 1_000 },
    { position: 3.2, clicks: 100, impressions: 1_000 },
    { position: 4, clicks: 150, impressions: 1_000 }, // noisy: better than 3
    { position: 8, clicks: 20, impressions: 1_000 },
    { position: 6, clicks: 5, impressions: 50 }, // too few impressions to trust
  ];

  it("uses the site's own rates, capped so lower positions never beat higher ones", () => {
    const curve = ownCtrCurve(rows);
    expect(curve[1]).toBeCloseTo(0.3);
    expect(curve[3]).toBeCloseTo(0.1);
    expect(curve[4]).toBeCloseTo(0.1);
    expect(curve[6]).toBeNull();
    expect(curve[8]).toBeCloseTo(0.02);
  });

  it("finds 4–10 and 11–20 queries with enough impressions, best estimate first", () => {
    const curve = ownCtrCurve(rows);
    const found = findOpportunities(
      [
        { query: "a", clicks: 10, impressions: 1_000, position: 6 },
        { query: "b", clicks: 0, impressions: 400, position: 14 },
        { query: "c", clicks: 0, impressions: 49, position: 6 },
        { query: "d", clicks: 50, impressions: 500, position: 2 },
        { query: "e", clicks: 0, impressions: 300, position: 25 },
      ],
      curve,
    );
    expect(found.map((o) => o.query)).toEqual(["a", "b"]);
    // 1000 × (0.10 − 0.01) = 90; 400 × (0.02 − 0) = 8
    expect(found[0]).toMatchObject({ band: "near-top", extraClicks: 90 });
    expect(found[1]).toMatchObject({ band: "page-two", extraClicks: 8 });
  });

  it("gives no estimate rather than a guess when the site has no data at the target", () => {
    const found = findOpportunities([{ query: "a", clicks: 0, impressions: 500, position: 6 }], ownCtrCurve([]));
    expect(found[0]?.extraClicks).toBeNull();
  });

  it("never estimates negative extra clicks", () => {
    const found = findOpportunities([{ query: "a", clicks: 400, impressions: 1_000, position: 5 }], ownCtrCurve(rows));
    expect(found[0]?.extraClicks).toBe(0);
  });
});
