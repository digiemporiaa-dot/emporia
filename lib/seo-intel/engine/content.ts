import { opportunityBand, TARGET_POSITION } from "@/lib/seo-intel/engine/rankings";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/seo-intel/thresholds";

/**
 * Content intelligence over Search Console page data and the latest crawl.
 * Pure. Every finding carries the numbers it was decided on, and an `impact`
 * in clicks (lost, missed or estimated) that orders the list. All of it is
 * calculated by Emporia from Google's data, and labelled so on screen.
 */

export type Block = { clicks: number; impressions: number; position: number | null };
/** Three consecutive 28-day blocks, oldest first, ending on the latest day with data. */
export type PageBlocks = { url: string; blocks: [Block, Block, Block] };
export type CrawlFacts = { title: string | null; description: string | null; indexable: boolean | null };

export const POTENTIAL_MIN_PAIR_IMPRESSIONS = 10;
export const POTENTIAL_MIN_CLICKS = 5;

export type ContentType = "decaying" | "refresh" | "low-ctr" | "potential" | "cannibalisation";

export type Finding =
  | { type: "decaying"; url: string; impact: number; clicks: [number, number, number]; drop: number; crawl: CrawlFacts | null }
  | { type: "refresh"; url: string; impact: number; positions: [number, number, number]; impressions: [number, number, number]; crawl: CrawlFacts | null }
  | { type: "low-ctr"; url: string; impact: number; position: number; ctr: number; expected: number; impressions: number; crawl: CrawlFacts | null }
  | { type: "potential"; url: string; impact: number; queries: { query: string; position: number; impressions: number; extraClicks: number }[]; crawl: CrawlFacts | null }
  | { type: "cannibalisation"; query: string; impact: number; impressions: number; pages: { url: string; share: number; position: number; clicks: number }[] };

const ctrOf = (block: Block) => (block.impressions > 0 ? block.clicks / block.impressions : 0);

/** Clicks fell in each block, by 25%+ overall, from a page that had 30+ clicks a block. Impact: clicks lost per block. */
export function decaying(pages: readonly PageBlocks[], crawl: (url: string) => CrawlFacts | null, t: Thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const out: Finding[] = [];
  for (const { url, blocks } of pages) {
    const [a, b, c] = blocks.map((block) => block.clicks) as [number, number, number];
    if (a < t["decay.minClicks"] || !(a > b && b > c)) continue;
    const drop = (a - c) / a;
    if (drop < t["decay.minDrop"]) continue;
    out.push({ type: "decaying", url, impact: a - c, clicks: [a, b, c], drop, crawl: crawl(url) });
  }
  return out;
}

/**
 * Demand held (impressions at least 80% of the first block, which had 200+)
 * while the position slipped by two or more places without recovering in
 * between — the pattern of content being overtaken. Impact: the clicks the
 * page would get at its old position's CTR minus what it gets now.
 */
export function needsRefresh(pages: readonly PageBlocks[], crawl: (url: string) => CrawlFacts | null, t: Thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const out: Finding[] = [];
  for (const { url, blocks } of pages) {
    const [a, b, c] = blocks;
    if (a.impressions < t["refresh.minImpressions"] || c.impressions < a.impressions * t["refresh.impressionsHeld"]) continue;
    if (a.position === null || b.position === null || c.position === null) continue;
    if (!(a.position <= b.position && b.position <= c.position) || c.position - a.position < t["refresh.minSlip"]) continue;
    const impact = Math.max(0, Math.round(c.impressions * (ctrOf(a) - ctrOf(c))));
    out.push({ type: "refresh", url, impact, positions: [a.position, b.position, c.position], impressions: [a.impressions, b.impressions, c.impressions], crawl: crawl(url) });
  }
  return out;
}

/** Last block: 200+ impressions, CTR under half of this site's own CTR at that position. Impact: clicks missed. */
export function lowCtr(pages: readonly PageBlocks[], curve: readonly (number | null)[], crawl: (url: string) => CrawlFacts | null, t: Thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const out: Finding[] = [];
  for (const { url, blocks } of pages) {
    const last = blocks[2];
    if (last.impressions < t["lowCtr.minImpressions"] || last.position === null) continue;
    const rounded = Math.round(last.position);
    if (rounded < 1 || rounded > 20) continue;
    const expected = curve[rounded];
    if (expected === null || expected === undefined || expected <= 0) continue;
    const ctr = ctrOf(last);
    if (ctr >= expected * t["lowCtr.share"]) continue;
    out.push({ type: "low-ctr", url, impact: Math.round(last.impressions * (expected - ctr)), position: last.position, ctr, expected, impressions: last.impressions, crawl: crawl(url) });
  }
  return out;
}

export type Pair = { query: string; page: string; clicks: number; impressions: number; position: number };

/**
 * Pages whose queries at positions 4–20 add up to the most extra clicks,
 * each query estimated the Phase 4 way from this site's own CTR curve.
 */
export function highPotential(pairs: readonly Pair[], curve: readonly (number | null)[], crawl: (url: string) => CrawlFacts | null): Finding[] {
  const byPage = new Map<string, { query: string; position: number; impressions: number; extraClicks: number }[]>();
  for (const pair of pairs) {
    if (pair.impressions < POTENTIAL_MIN_PAIR_IMPRESSIONS) continue;
    const band = opportunityBand(pair.position);
    if (!band) continue;
    const target = curve[TARGET_POSITION[band]];
    if (target === null || target === undefined) continue;
    const extraClicks = Math.max(0, Math.round(pair.impressions * (target - pair.clicks / pair.impressions)));
    if (extraClicks <= 0) continue;
    const list = byPage.get(pair.page) ?? [];
    list.push({ query: pair.query, position: pair.position, impressions: pair.impressions, extraClicks });
    byPage.set(pair.page, list);
  }
  const out: Finding[] = [];
  for (const [url, queries] of byPage) {
    const impact = queries.reduce((sum, q) => sum + q.extraClicks, 0);
    if (impact < POTENTIAL_MIN_CLICKS) continue;
    queries.sort((a, b) => b.extraClicks - a.extraClicks);
    out.push({ type: "potential", url, impact, queries: queries.slice(0, 5), crawl: crawl(url) });
  }
  return out;
}

/**
 * Queries with 50+ impressions where two or more of the site's pages each
 * take 20%+ of them. "Possible": sometimes two pages for one query is right.
 * Impact: the impressions of every page but the strongest.
 */
export function cannibalisation(pairs: readonly Pair[], t: Thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const byQuery = new Map<string, Pair[]>();
  for (const pair of pairs) {
    const list = byQuery.get(pair.query) ?? [];
    list.push(pair);
    byQuery.set(pair.query, list);
  }
  const out: Finding[] = [];
  for (const [query, list] of byQuery) {
    const total = list.reduce((sum, pair) => sum + pair.impressions, 0);
    if (total < t["cannibal.minImpressions"]) continue;
    const pages = list
      .map((pair) => ({ url: pair.page, share: pair.impressions / total, position: pair.position, clicks: pair.clicks, impressions: pair.impressions }))
      .filter((page) => page.share >= t["cannibal.minShare"])
      .sort((a, b) => b.impressions - a.impressions);
    if (pages.length < 2) continue;
    const impact = pages.slice(1).reduce((sum, page) => sum + page.impressions, 0);
    out.push({ type: "cannibalisation", query, impact, impressions: total, pages: pages.map(({ url, share, position, clicks }) => ({ url, share, position, clicks })) });
  }
  return out;
}

export function byImpact(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => b.impact - a.impact);
}
