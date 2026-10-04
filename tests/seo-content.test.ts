import { describe, expect, it } from "vitest";
import { byImpact, cannibalisation, decaying, highPotential, lowCtr, needsRefresh, type Finding, type PageBlocks } from "@/lib/seo-intel/engine/content";

const none = () => null;
const urlOf = (f: Finding) => ("url" in f ? f.url : f.query);
const page = (url: string, blocks: [number, number, number | null][]): PageBlocks => ({
  url,
  blocks: blocks.map(([clicks, impressions, position]) => ({ clicks, impressions, position })) as PageBlocks["blocks"],
});

describe("decaying pages", () => {
  it("needs three falling blocks, a 25% drop and 30+ clicks to start", () => {
    const found = decaying(
      [
        page("/decay", [[100, 1000, 3], [80, 1000, 3], [60, 1000, 3]]),
        page("/dip", [[100, 1000, 3], [50, 1000, 3], [70, 1000, 3]]),
        page("/small", [[29, 300, 3], [20, 300, 3], [10, 300, 3]]),
        page("/gentle", [[100, 1000, 3], [90, 1000, 3], [76, 1000, 3]]),
        page("/edge", [[100, 1000, 3], [90, 1000, 3], [75, 1000, 3]]),
      ],
      none,
    );
    expect(found.map(urlOf)).toEqual(["/decay", "/edge"]);
    expect(found[0]).toMatchObject({ impact: 40, clicks: [100, 80, 60], drop: 0.4 });
  });
});

describe("refresh candidates", () => {
  it("wants held demand and a steady slip of two or more places", () => {
    const found = needsRefresh(
      [
        page("/slip", [[100, 1000, 3], [70, 950, 4], [40, 900, 5.5]]),
        page("/demand-fell", [[100, 1000, 3], [60, 700, 4], [30, 700, 6]]),
        page("/recovered", [[100, 1000, 3], [60, 1000, 7], [40, 1000, 5]]),
        page("/small-slip", [[100, 1000, 3], [90, 1000, 3.5], [80, 1000, 4.9]]),
        page("/little-demand", [[10, 199, 3], [8, 199, 4], [5, 199, 6]]),
      ],
      none,
    );
    expect(found.map(urlOf)).toEqual(["/slip"]);
    // 900 × (10% − 4.4%) = 50
    expect(found[0]).toMatchObject({ impact: 50, positions: [3, 4, 5.5] });
  });
});

describe("low CTR", () => {
  const curve: (number | null)[] = [null, 0.3, 0.2, 0.1, 0.08, 0.06, null];
  it("flags CTR under half of the site's own rate at that position", () => {
    const found = lowCtr(
      [
        page("/low", [[0, 0, null], [0, 0, null], [10, 500, 3]]), // 2% vs 10%
        page("/fine", [[0, 0, null], [0, 0, null], [25, 500, 3]]), // 5% = half: not flagged
        page("/few", [[0, 0, null], [0, 0, null], [0, 199, 3]]),
        page("/no-curve", [[0, 0, null], [0, 0, null], [0, 500, 6]]),
        page("/deep", [[0, 0, null], [0, 0, null], [0, 500, 25]]),
      ],
      curve,
      (url) => (url === "/low" ? { title: "Old title", description: null, indexable: true } : null),
    );
    expect(found.map(urlOf)).toEqual(["/low"]);
    expect(found[0]).toMatchObject({ impact: 40, expected: 0.1, crawl: { title: "Old title" } });
  });
});

describe("high potential pages", () => {
  const curve: (number | null)[] = [null, 0.3, 0.2, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03];
  it("adds up each page's 4–20 queries at the site's own CTR", () => {
    const found = highPotential(
      [
        { query: "a", page: "/p", clicks: 5, impressions: 500, position: 6 }, // 500 × (0.10 − 0.01) = 45
        { query: "b", page: "/p", clicks: 0, impressions: 300, position: 14 }, // 300 × 0.03 = 9
        { query: "c", page: "/p", clicks: 0, impressions: 9, position: 6 }, // too few impressions
        { query: "d", page: "/q", clicks: 50, impressions: 100, position: 2 }, // already top 3
        { query: "e", page: "/r", clicks: 0, impressions: 40, position: 12 }, // 40 × 0.03 = 1, under 5
      ],
      curve,
      none,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ url: "/p", impact: 54 });
    expect(found[0]?.type === "potential" && found[0].queries.map((q) => q.query)).toEqual(["a", "b"]);
  });
});

describe("cannibalisation", () => {
  it("needs two pages each with 20%+ of a query's 50+ impressions", () => {
    const found = cannibalisation([
      { query: "seo", page: "/a", clicks: 10, impressions: 60, position: 5 },
      { query: "seo", page: "/b", clicks: 2, impressions: 30, position: 9 },
      { query: "seo", page: "/c", clicks: 0, impressions: 10, position: 30 },
      { query: "ppc", page: "/a", clicks: 10, impressions: 90, position: 4 },
      { query: "ppc", page: "/b", clicks: 0, impressions: 10, position: 12 }, // 10%: not enough
      { query: "rare", page: "/a", clicks: 0, impressions: 20, position: 8 },
      { query: "rare", page: "/b", clicks: 0, impressions: 20, position: 8 }, // only 40 impressions
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ query: "seo", impressions: 100, impact: 30 });
    expect(found[0]?.type === "cannibalisation" && found[0].pages.map((p) => [p.url, p.share])).toEqual([["/a", 0.6], ["/b", 0.3]]);
  });

  it("orders any findings by impact", () => {
    const sorted = byImpact([
      ...decaying([page("/small", [[40, 400, 3], [35, 400, 3], [20, 400, 3]])], none),
      ...decaying([page("/big", [[200, 2000, 3], [150, 2000, 3], [100, 2000, 3]])], none),
    ]);
    expect(sorted.map(urlOf)).toEqual(["/big", "/small"]);
  });
});
