import { describe, expect, it } from "vitest";
import { combine, ctr, normalizeGscRows } from "@/lib/seo-intel/normalize/gsc";
import { percentChange, resolvePeriod } from "@/lib/seo-intel/periods";
import { GSC_HISTORY_DAYS, planGscSync } from "@/lib/seo-intel/sync-plan";
import { siteMatchesDomain } from "@/lib/seo-intel/gsc-site";
import { addDays, daysBetween, eachDay, todayIn } from "@/lib/seo-intel/dates";
import { DEFAULT_CHANGE_THRESHOLDS, detectChanges, type ChangeInput } from "@/lib/seo-intel/engine/changes";
import type { GscMetrics } from "@/lib/seo-intel/normalize/gsc";

/** SEO Phase 2, the pure half: nothing here touches the network or the database. */

describe("normalising Search Console rows", () => {
  it("keeps well-formed rows, typed by dimension", () => {
    const { rows, dropped } = normalizeGscRows(
      [
        { keys: ["2026-09-01", "MOBILE"], clicks: 5, impressions: 100, ctr: 0.05, position: 3.25 },
        { keys: ["2026-09-01", "desktop"], clicks: 0, impressions: 7, ctr: 0, position: 12 },
      ],
      ["date", "device"],
    );
    expect(dropped).toBe(0);
    expect(rows).toEqual([
      { date: "2026-09-01", device: "MOBILE", clicks: 5, impressions: 100, position: 3.25 },
      { date: "2026-09-01", device: "DESKTOP", clicks: 0, impressions: 7, position: 12 },
    ]);
  });

  it.each([
    [{ keys: ["2026-09-01"], clicks: -1, impressions: 10, position: 2 }, "negative clicks"],
    [{ keys: ["2026-09-01"], clicks: 1.5, impressions: 10, position: 2 }, "fractional clicks"],
    [{ keys: ["2026-09-01"], clicks: 11, impressions: 10, position: 2 }, "more clicks than impressions"],
    [{ keys: ["2026-09-01"], clicks: 1, impressions: 10, position: 0.5 }, "position below 1"],
    [{ keys: ["2026-09-01"], clicks: 1, impressions: 10, position: Number.NaN }, "position not a number"],
    [{ keys: ["2026-02-30"], clicks: 1, impressions: 10, position: 2 }, "impossible date"],
    [{ keys: ["01/09/2026"], clicks: 1, impressions: 10, position: 2 }, "wrong date format"],
    [{ keys: [], clicks: 1, impressions: 10, position: 2 }, "missing key"],
    [{ clicks: 1, impressions: 10, position: 2 }, "no keys at all"],
    [{ keys: ["2026-09-01"], clicks: "1", impressions: 10, position: 2 }, "a string where a number belongs"],
  ])("drops a row with %s… (%s)", (row, _why) => {
    expect(normalizeGscRows([row], ["date"])).toEqual({ rows: [], dropped: 1 });
  });

  it("validates each dimension's own shape", () => {
    expect(normalizeGscRows([{ keys: ["not-a-url"], clicks: 1, impressions: 2, position: 1 }], ["page"]).dropped).toBe(1);
    expect(normalizeGscRows([{ keys: ["IN"], clicks: 1, impressions: 2, position: 1 }], ["country"]).dropped).toBe(1);
    expect(normalizeGscRows([{ keys: ["IND"], clicks: 1, impressions: 2, position: 1 }], ["country"]).rows[0]?.country).toBe("ind");
    expect(normalizeGscRows([{ keys: ["TV"], clicks: 1, impressions: 2, position: 1 }], ["device"]).dropped).toBe(1);
    expect(normalizeGscRows([{ keys: ["  "], clicks: 1, impressions: 2, position: 1 }], ["query"]).dropped).toBe(1);
  });

  it("caps very long queries and URLs rather than storing anything unbounded", () => {
    const long = normalizeGscRows([{ keys: ["q".repeat(900)], clicks: 1, impressions: 2, position: 1 }], ["query"]);
    expect(long.rows[0]?.query).toHaveLength(500);
  });
});

describe("combining days", () => {
  it("weights position by impressions instead of averaging averages", () => {
    // 900 impressions at position 2 and 100 at position 12: 3.0, not 7.0.
    const total = combine([
      { clicks: 90, impressions: 900, position: 2 },
      { clicks: 1, impressions: 100, position: 12 },
    ]);
    expect(total.position).toBeCloseTo(3);
    expect(total.clicks).toBe(91);
    expect(total.ctr).toBeCloseTo(0.091);
  });

  it("has no CTR without impressions", () => {
    expect(ctr({ clicks: 0, impressions: 0 })).toBeNull();
    expect(combine([]).position).toBe(0);
  });

  it("percent change has no answer from zero", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(80, 100)).toBeCloseTo(-0.2);
  });
});

describe("days", () => {
  it("knows today in Los Angeles is not today in Kolkata", () => {
    const now = new Date("2026-10-03T03:00:00Z"); // 08:30 in India, 20:00 the day before in LA
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-10-02");
    expect(todayIn("Asia/Kolkata", now)).toBe("2026-10-03");
  });

  it("counts and lists days across month and leap-year edges", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
    expect(eachDay("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("comparison periods", () => {
  it("anchors on the latest day with data", () => {
    expect(resolvePeriod("28d", "2026-09-30")).toMatchObject({
      current: { start: "2026-09-03", end: "2026-09-30" },
      previous: { start: "2026-08-06", end: "2026-09-02" },
    });
    expect(resolvePeriod("7d", "2026-09-30").previous).toEqual({ start: "2026-09-17", end: "2026-09-23" });
    expect(resolvePeriod("day", "2026-09-01").previous).toEqual({ start: "2026-08-31", end: "2026-08-31" });
  });

  it("year over year steps back 364 days, keeping weekdays aligned", () => {
    const { current, previous } = resolvePeriod("yoy", "2026-09-30");
    expect(daysBetween(previous.end, current.end)).toBe(364);
    expect(new Date(`${previous.end}T00:00:00Z`).getUTCDay()).toBe(new Date(`${current.end}T00:00:00Z`).getUTCDay());
  });

  it("month over month compares month-to-date with the same days, clamped to a shorter month", () => {
    expect(resolvePeriod("mom", "2026-09-15")).toMatchObject({ current: { start: "2026-09-01", end: "2026-09-15" }, previous: { start: "2026-08-01", end: "2026-08-15" } });
    expect(resolvePeriod("mom", "2026-03-30").previous).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(resolvePeriod("mom", "2026-01-10").previous).toEqual({ start: "2025-12-01", end: "2025-12-10" });
    // A complete month against the complete month before, whatever its length.
    expect(resolvePeriod("mom", "2028-03-31").previous).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(resolvePeriod("mom", "2026-04-30").previous).toEqual({ start: "2026-03-01", end: "2026-03-31" });
  });
});

describe("planning a sync", () => {
  it("first run: the recent days, then one month further back", () => {
    const plan = planGscSync({ today: "2026-10-03", backfilledFrom: null });
    expect(plan.end).toBe("2026-10-02");
    expect(plan.ranges).toEqual([
      { start: "2026-09-28", end: "2026-10-02", kind: "recent" },
      { start: "2026-08-29", end: "2026-09-27", kind: "backfill" },
    ]);
    expect(plan.nextBackfilledFrom).toBe("2026-08-29");
    expect(plan.backfillComplete).toBe(false);
    expect(daysBetween(plan.oldest, plan.end)).toBe(GSC_HISTORY_DAYS - 1);
  });

  it("later runs continue from the cursor", () => {
    const plan = planGscSync({ today: "2026-10-04", backfilledFrom: "2026-08-29" });
    expect(plan.ranges[1]).toEqual({ start: "2026-07-30", end: "2026-08-28", kind: "backfill" });
  });

  it("stops at the oldest day Google keeps, and then only re-reads the recent days", () => {
    const first = planGscSync({ today: "2026-10-03", backfilledFrom: null });
    const nearly = planGscSync({ today: "2026-10-03", backfilledFrom: addDays(first.oldest, 10) });
    expect(nearly.ranges[1]).toEqual({ start: first.oldest, end: addDays(first.oldest, 9), kind: "backfill" });
    expect(nearly.backfillComplete).toBe(true);
    const done = planGscSync({ today: "2026-10-03", backfilledFrom: first.oldest });
    expect(done.ranges).toHaveLength(1);
  });

  it("a cursor from long ago cannot reach past what Google keeps", () => {
    const plan = planGscSync({ today: "2026-10-03", backfilledFrom: "2020-01-01" });
    expect(plan.ranges).toHaveLength(1);
    expect(plan.nextBackfilledFrom).toBe(plan.oldest);
  });
});

describe("matching a Search Console property to a website", () => {
  it.each([
    ["sc-domain:example.com", "example.com", true],
    ["sc-domain:example.com", "www.example.com", true],
    ["sc-domain:example.com", "shop.example.com", true],
    ["sc-domain:example.com", "notexample.com", false],
    ["sc-domain:example.com", "example.com.evil.net", false],
    ["sc-domain:shop.example.com", "example.com", false],
    ["https://www.example.com/", "www.example.com", true],
    ["https://www.example.com/", "example.com", true],
    ["https://example.com/", "www.example.com", true],
    ["https://blog.example.com/", "example.com", false],
    ["https://example.com/blog/", "example.com", true],
    ["https://other.com/", "example.com", false],
    ["ftp://example.com/", "example.com", false],
    ["sc-domain:", "example.com", false],
    ["garbage", "example.com", false],
  ])("%s for %s → %s", (site, domain, expected) => {
    expect(siteMatchesDomain(site, domain)).toBe(expected);
  });
});

describe("what changed", () => {
  const period = resolvePeriod("28d", "2026-09-30");
  const m = (clicks: number, impressions: number, position: number): GscMetrics => ({ clicks, impressions, position });
  const input = (overrides: Partial<ChangeInput> = {}): ChangeInput => ({
    period,
    totals: { current: m(1000, 50_000, 8), previous: m(1000, 50_000, 8) },
    pages: { current: new Map(), previous: new Map() },
    queries: { current: new Map(), previous: new Map() },
    ...overrides,
  });

  it("says nothing when nothing moved", () => {
    expect(detectChanges(input())).toEqual([]);
  });

  it("reports an 18% click drop only when the threshold allows it", () => {
    const changed = input({ totals: { current: m(820, 50_000, 8), previous: m(1000, 50_000, 8) } });
    expect(detectChanges(changed)).toEqual([]);
    const loose = detectChanges(changed, { ...DEFAULT_CHANGE_THRESHOLDS, trafficPct: 0.15 });
    expect(loose[0]?.title).toBe("Organic clicks decreased 18% compared with the previous 28 days.");
    expect(loose[0]).toMatchObject({ severity: "low", direction: "down", source: "Search Console", entity: { type: "property" } });
  });

  it("grades a large drop as high and carries the date ranges", () => {
    const [first] = detectChanges(input({ totals: { current: m(500, 50_000, 8), previous: m(1000, 50_000, 8) } }));
    expect(first).toMatchObject({ key: "total-clicks", severity: "high", direction: "down" });
    expect(first?.range).toEqual({ current: period.current, previous: period.previous });
  });

  it("ignores big percentages on tiny numbers", () => {
    expect(detectChanges(input({ totals: { current: m(2, 50_000, 8), previous: m(10, 50_000, 8) } })).some((c) => c.key === "total-clicks")).toBe(false);
  });

  it("treats a rising position number as a decline", () => {
    const changes = detectChanges(input({ totals: { current: m(1000, 50_000, 11.5), previous: m(1000, 50_000, 8) } }));
    expect(changes.find((c) => c.key === "total-position")).toMatchObject({ direction: "down", severity: "high" });
    expect(changes.find((c) => c.key === "total-position")?.title).toBe("Average position worsened from 8.0 to 11.5.");
  });

  it("reports CTR movement", () => {
    const changes = detectChanges(input({ totals: { current: m(700, 50_000, 8), previous: m(1000, 50_000, 8) } }));
    expect(changes.find((c) => c.key === "total-ctr")?.title).toBe("Click-through rate fell from 2.0% to 1.4%.");
  });

  it("counts pages that lost more than 30% of their clicks, naming them", () => {
    const pages = {
      previous: new Map([
        ["https://x.com/a", m(100, 1000, 3)],
        ["https://x.com/b", m(50, 800, 4)],
        ["https://x.com/c", m(5, 100, 9)], // too small to judge
        ["https://x.com/d", m(40, 400, 5)],
      ]),
      current: new Map([
        ["https://x.com/a", m(60, 1000, 3)],
        ["https://x.com/b", m(5, 800, 6)],
        ["https://x.com/c", m(0, 100, 9)],
        ["https://x.com/d", m(39, 400, 5)],
      ]),
    };
    const losing = detectChanges(input({ pages })).find((c) => c.key === "pages-losing");
    expect(losing?.title).toBe("2 pages lost more than 30% of their organic clicks.");
    expect(losing?.entity).toEqual({ type: "page", keys: ["https://x.com/b", "https://x.com/a"] });
    expect(losing?.view).toBe("pages");
  });

  it("flags pages whose impressions grew while CTR fell", () => {
    const pages = {
      previous: new Map([["https://x.com/a", m(50, 1000, 5)]]),
      current: new Map([["https://x.com/a", m(52, 2000, 5)]]),
    };
    expect(detectChanges(input({ pages })).find((c) => c.key === "pages-ctr-slipping")?.entity.keys).toEqual(["https://x.com/a"]);
  });

  it("tracks queries entering and leaving the top 10, and new and lost queries", () => {
    const queries = {
      previous: new Map([
        ["seo agency dubai", m(5, 200, 14)],
        ["digital marketing", m(30, 900, 6)],
        ["old query", m(1, 50, 20)],
        ["rare", m(0, 3, 40)],
      ]),
      current: new Map([
        ["seo agency dubai", m(20, 260, 7)],
        ["digital marketing", m(10, 900, 13)],
        ["brand new", m(2, 40, 9)],
      ]),
    };
    const changes = detectChanges(input({ queries }));
    const keys = (key: string) => changes.find((c) => c.key === key)?.entity.keys;
    expect(keys("queries-entered-top10")?.sort()).toEqual(["brand new", "seo agency dubai"]);
    expect(keys("queries-left-top10")).toEqual(["digital marketing"]);
    expect(keys("queries-new")).toEqual(["brand new"]);
    // "rare" never had enough impressions to count as ranking.
    expect(keys("queries-lost")).toEqual(["old query"]);
  });

  it("puts serious declines first", () => {
    const changes = detectChanges(
      input({
        totals: { current: m(1500, 80_000, 8), previous: m(1000, 50_000, 8) },
        pages: { previous: new Map([["https://x.com/a", m(100, 1000, 3)]]), current: new Map([["https://x.com/a", m(10, 1000, 3)]]) },
      }),
    );
    expect(changes[0]?.direction).toBe("down");
    expect(changes.at(-1)?.direction).toBe("up");
  });
});
