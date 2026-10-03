import { ctr, type GscMetrics } from "@/lib/seo-intel/normalize/gsc";
import { percentChange, type ResolvedPeriod } from "@/lib/seo-intel/periods";

/**
 * "What changed?" — meaningful movements between two periods. Pure.
 *
 * Every insight names its source, its date ranges, what it is about, how
 * serious it is and where to look. The thresholds are explicit and passed in:
 * a change below them is not reported, because a dashboard that calls every
 * wobble a finding teaches people to ignore it. Phase 10 stores the thresholds
 * per property and keeps a history of these events; the rules live here once.
 */

export type ChangeThresholds = {
  /** Relative change in clicks or impressions worth reporting (0.2 = 20%). */
  trafficPct: number;
  /** Ignore click changes where neither period reached this many clicks. */
  minClicks: number;
  /** Ignore impression changes where neither period reached this many. */
  minImpressions: number;
  /** Relative CTR change worth reporting. */
  ctrPct: number;
  /** Average-position movement worth reporting (places). */
  positionDelta: number;
  /** A page "lost traffic" when its clicks fell by at least this much… */
  pageLossPct: number;
  /** …from at least this many clicks. */
  pageMinClicks: number;
  /** A query needs this many impressions to count as ranking. */
  queryMinImpressions: number;
};

export const DEFAULT_CHANGE_THRESHOLDS: ChangeThresholds = {
  trafficPct: 0.2,
  minClicks: 20,
  minImpressions: 200,
  ctrPct: 0.2,
  positionDelta: 1,
  pageLossPct: 0.3,
  pageMinClicks: 10,
  queryMinImpressions: 10,
};

export type Severity = "high" | "medium" | "low";

export type ChangeInsight = {
  key: string;
  severity: Severity;
  direction: "up" | "down";
  title: string;
  source: "Search Console";
  range: { current: { start: string; end: string }; previous: { start: string; end: string } };
  entity: { type: "property" | "page" | "query"; keys: string[] };
  /** Where the evidence is, relative to the property's SEO section. */
  view: "overview" | "pages" | "queries";
};

export type ChangeInput = {
  period: ResolvedPeriod;
  totals: { current: GscMetrics; previous: GscMetrics };
  pages: { current: Map<string, GscMetrics>; previous: Map<string, GscMetrics> };
  queries: { current: Map<string, GscMetrics>; previous: Map<string, GscMetrics> };
};

const pct = (value: number) => `${Math.round(Math.abs(value) * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const severityFor = (magnitude: number): Severity => (magnitude >= 0.4 ? "high" : magnitude >= 0.2 ? "medium" : "low");
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function detectChanges(input: ChangeInput, thresholds: ChangeThresholds = DEFAULT_CHANGE_THRESHOLDS): ChangeInsight[] {
  const { period, totals } = input;
  const range = { current: period.current, previous: period.previous };
  const insights: (ChangeInsight & { magnitude: number })[] = [];
  const property = { type: "property" as const, keys: [] };

  // --- Whole-site traffic -------------------------------------------------
  for (const [metric, label, floor] of [
    ["clicks", "Organic clicks", thresholds.minClicks],
    ["impressions", "Impressions", thresholds.minImpressions],
  ] as const) {
    const now = totals.current[metric];
    const before = totals.previous[metric];
    const change = percentChange(now, before);
    if (change === null || Math.max(now, before) < floor || Math.abs(change) < thresholds.trafficPct) continue;
    const down = change < 0;
    insights.push({
      key: `total-${metric}`,
      severity: down ? severityFor(Math.abs(change)) : "low",
      direction: down ? "down" : "up",
      title: `${label} ${down ? "decreased" : "increased"} ${pct(change)} compared with ${period.comparedWith}.`,
      source: "Search Console",
      range,
      entity: property,
      view: "overview",
      magnitude: Math.abs(change),
    });
  }

  const ctrNow = ctr(totals.current);
  const ctrBefore = ctr(totals.previous);
  if (
    ctrNow !== null &&
    ctrBefore !== null &&
    ctrBefore > 0 &&
    totals.current.impressions >= thresholds.minImpressions &&
    totals.previous.impressions >= thresholds.minImpressions
  ) {
    const change = (ctrNow - ctrBefore) / ctrBefore;
    if (Math.abs(change) >= thresholds.ctrPct) {
      const down = change < 0;
      insights.push({
        key: "total-ctr",
        severity: down ? severityFor(Math.abs(change)) : "low",
        direction: down ? "down" : "up",
        title: `Click-through rate ${down ? "fell" : "rose"} from ${(ctrBefore * 100).toFixed(1)}% to ${(ctrNow * 100).toFixed(1)}%.`,
        source: "Search Console",
        range,
        entity: property,
        view: "overview",
        magnitude: Math.abs(change),
      });
    }
  }

  if (totals.current.impressions >= thresholds.minImpressions && totals.previous.impressions >= thresholds.minImpressions) {
    // Lower is better: a rising number is a decline.
    const delta = totals.current.position - totals.previous.position;
    if (Math.abs(delta) >= thresholds.positionDelta) {
      const worse = delta > 0;
      insights.push({
        key: "total-position",
        severity: worse ? (delta >= 3 ? "high" : "medium") : "low",
        direction: worse ? "down" : "up",
        title: `Average position ${worse ? "worsened" : "improved"} from ${totals.previous.position.toFixed(1)} to ${totals.current.position.toFixed(1)}.`,
        source: "Search Console",
        range,
        entity: property,
        view: "overview",
        magnitude: Math.abs(delta) / 10,
      });
    }
  }

  // --- Pages ----------------------------------------------------------------
  const losing: { page: string; loss: number }[] = [];
  const gaining: { page: string; gain: number }[] = [];
  const ctrSlipping: string[] = [];
  const allPages = new Set([...input.pages.current.keys(), ...input.pages.previous.keys()]);
  for (const page of allPages) {
    const now = input.pages.current.get(page) ?? { clicks: 0, impressions: 0, position: 0 };
    const before = input.pages.previous.get(page) ?? { clicks: 0, impressions: 0, position: 0 };
    if (before.clicks >= thresholds.pageMinClicks) {
      const change = (now.clicks - before.clicks) / before.clicks;
      if (change <= -thresholds.pageLossPct) losing.push({ page, loss: before.clicks - now.clicks });
      if (change >= thresholds.pageLossPct) gaining.push({ page, gain: now.clicks - before.clicks });
    } else if (before.clicks === 0 && now.clicks >= thresholds.pageMinClicks) {
      gaining.push({ page, gain: now.clicks });
    }
    // More people saw it, fewer of them clicked — the snippet is worth a look.
    const impressionsUp = percentChange(now.impressions, before.impressions);
    const ctrBeforePage = ctr(before);
    const ctrNowPage = ctr(now);
    if (
      before.impressions >= 100 &&
      impressionsUp !== null &&
      impressionsUp >= 0.3 &&
      ctrBeforePage !== null &&
      ctrNowPage !== null &&
      ctrBeforePage > 0 &&
      (ctrNowPage - ctrBeforePage) / ctrBeforePage <= -thresholds.ctrPct
    ) {
      ctrSlipping.push(page);
    }
  }
  if (losing.length) {
    losing.sort((a, b) => b.loss - a.loss);
    insights.push({
      key: "pages-losing",
      severity: losing.length >= 5 ? "high" : "medium",
      direction: "down",
      title: `${plural(losing.length, "page")} lost more than ${pct(thresholds.pageLossPct)} of ${losing.length === 1 ? "its" : "their"} organic clicks.`,
      source: "Search Console",
      range,
      entity: { type: "page", keys: losing.slice(0, 20).map((entry) => entry.page) },
      view: "pages",
      magnitude: losing.length / 10,
    });
  }
  if (gaining.length) {
    gaining.sort((a, b) => b.gain - a.gain);
    insights.push({
      key: "pages-gaining",
      severity: "low",
      direction: "up",
      title: `${plural(gaining.length, "page")} gained more than ${pct(thresholds.pageLossPct)} organic clicks.`,
      source: "Search Console",
      range,
      entity: { type: "page", keys: gaining.slice(0, 20).map((entry) => entry.page) },
      view: "pages",
      magnitude: gaining.length / 20,
    });
  }
  if (ctrSlipping.length) {
    insights.push({
      key: "pages-ctr-slipping",
      severity: "medium",
      direction: "down",
      title: `${plural(ctrSlipping.length, "page")} gained impressions but ${ctrSlipping.length === 1 ? "its" : "their"} click-through rate fell below ${ctrSlipping.length === 1 ? "its" : "their"} previous level.`,
      source: "Search Console",
      range,
      entity: { type: "page", keys: ctrSlipping.slice(0, 20) },
      view: "pages",
      magnitude: ctrSlipping.length / 20,
    });
  }

  // --- Queries --------------------------------------------------------------
  const ranking = (metrics: GscMetrics | undefined) => !!metrics && metrics.impressions >= thresholds.queryMinImpressions;
  const enteredTop10: string[] = [];
  const leftTop10: string[] = [];
  const fresh: string[] = [];
  const lost: string[] = [];
  const allQueries = new Set([...input.queries.current.keys(), ...input.queries.previous.keys()]);
  for (const query of allQueries) {
    const now = input.queries.current.get(query);
    const before = input.queries.previous.get(query);
    const rankingNow = ranking(now);
    const rankingBefore = ranking(before);
    if (rankingNow && !before) fresh.push(query);
    if (rankingBefore && !now) lost.push(query);
    const inTop10Now = rankingNow && (now as GscMetrics).position <= 10;
    const inTop10Before = rankingBefore && (before as GscMetrics).position <= 10;
    if (inTop10Now && !inTop10Before && (rankingBefore || !before)) enteredTop10.push(query);
    if (inTop10Before && !inTop10Now && (rankingNow || !now)) leftTop10.push(query);
  }
  const queryInsight = (key: string, list: string[], direction: "up" | "down", text: (n: string) => string, severity: Severity) => {
    if (!list.length) return;
    insights.push({
      key,
      severity,
      direction,
      title: text(plural(list.length, "query", "queries")),
      source: "Search Console",
      range,
      entity: { type: "query", keys: list.slice(0, 20) },
      view: "queries",
      magnitude: list.length / 20,
    });
  };
  queryInsight("queries-entered-top10", enteredTop10, "up", (n) => `${n} entered the top 10 (average position).`, "low");
  queryInsight("queries-left-top10", leftTop10, "down", (n) => `${n} dropped out of the top 10 (average position).`, leftTop10.length >= 10 ? "high" : "medium");
  queryInsight("queries-new", fresh, "up", (n) => `${n} started appearing in search.`, "low");
  queryInsight("queries-lost", lost, "down", (n) => `${n} stopped appearing in search.`, lost.length >= 20 ? "medium" : "low");

  return insights
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.direction === b.direction ? 0 : a.direction === "down" ? -1 : 1) || b.magnitude - a.magnitude)
    .map(({ magnitude: _magnitude, ...insight }) => insight);
}
