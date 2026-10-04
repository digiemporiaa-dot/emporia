import { DEFAULT_CHANGE_THRESHOLDS, type ChangeThresholds } from "@/lib/seo-intel/engine/changes";

/**
 * Every number the SEO rules decide on, in one registry. Pure.
 *
 * The agency sets defaults; any website can override single values. The rules
 * receive the merged result, so the Content, Opportunities and Command Center
 * screens always agree. Percentages are stored as fractions (0.25 = 25%).
 */

type Unit = "clicks" | "impressions" | "percent" | "places" | "count" | "days" | "stars";
type Def = { group: string; label: string; help: string; unit: Unit; default: number; min: number; max: number };

export const THRESHOLD_DEFS = {
  "opportunities.minImpressions": { group: "Keywords", label: "Opportunity: minimum impressions", help: "28-day impressions a query at positions 4–20 needs to count as an opportunity.", unit: "impressions", default: 50, min: 1, max: 1_000_000 },
  "opportunities.commandCenterCap": { group: "Keywords", label: "Keyword opportunities in the Command Center", help: "The strongest this many per website go to the Command Center; the full list stays on Opportunities.", unit: "count", default: 25, min: 0, max: 500 },
  "curve.minImpressions": { group: "Keywords", label: "CTR curve: impressions per position", help: "Impressions a position needs before this site's CTR there is trusted for estimates.", unit: "impressions", default: 200, min: 10, max: 1_000_000 },
  "decay.minClicks": { group: "Content", label: "Decay: clicks a block to start from", help: "A page must have had at least this many clicks in the first 28-day block.", unit: "clicks", default: 30, min: 1, max: 1_000_000 },
  "decay.minDrop": { group: "Content", label: "Decay: minimum drop", help: "How far clicks must fall from the first block to the last.", unit: "percent", default: 0.25, min: 0.01, max: 1 },
  "refresh.minImpressions": { group: "Content", label: "Refresh: impressions in the first block", help: "Enough demand to judge a slip.", unit: "impressions", default: 200, min: 1, max: 1_000_000 },
  "refresh.impressionsHeld": { group: "Content", label: "Refresh: impressions held", help: "The last block's impressions as a share of the first, for demand to count as steady.", unit: "percent", default: 0.8, min: 0.1, max: 2 },
  "refresh.minSlip": { group: "Content", label: "Refresh: places slipped", help: "How many places the average position must have fallen.", unit: "places", default: 2, min: 0.5, max: 50 },
  "lowCtr.minImpressions": { group: "Content", label: "Low CTR: minimum impressions", help: "28-day impressions before a page's CTR is judged.", unit: "impressions", default: 200, min: 1, max: 1_000_000 },
  "lowCtr.share": { group: "Content", label: "Low CTR: share of expected", help: "Flag pages below this share of the CTR this site gets at the same position.", unit: "percent", default: 0.5, min: 0.05, max: 1 },
  "cannibal.minImpressions": { group: "Content", label: "Cannibalisation: query impressions", help: "28-day impressions a query needs before splits are checked.", unit: "impressions", default: 50, min: 1, max: 1_000_000 },
  "cannibal.minShare": { group: "Content", label: "Cannibalisation: share per page", help: "Each competing page must take at least this share of the query's impressions.", unit: "percent", default: 0.2, min: 0.05, max: 0.5 },
  "changes.trafficPct": { group: "What changed", label: "Traffic change", help: "Relative change in site clicks or impressions worth reporting.", unit: "percent", default: DEFAULT_CHANGE_THRESHOLDS.trafficPct, min: 0.01, max: 5 },
  "changes.minClicks": { group: "What changed", label: "Minimum clicks", help: "Ignore click changes where neither period reached this many.", unit: "clicks", default: DEFAULT_CHANGE_THRESHOLDS.minClicks, min: 0, max: 1_000_000 },
  "changes.minImpressions": { group: "What changed", label: "Minimum impressions", help: "Ignore impression changes where neither period reached this many.", unit: "impressions", default: DEFAULT_CHANGE_THRESHOLDS.minImpressions, min: 0, max: 10_000_000 },
  "changes.ctrPct": { group: "What changed", label: "CTR change", help: "Relative CTR change worth reporting.", unit: "percent", default: DEFAULT_CHANGE_THRESHOLDS.ctrPct, min: 0.01, max: 5 },
  "changes.positionDelta": { group: "What changed", label: "Position change", help: "Average-position movement worth reporting.", unit: "places", default: DEFAULT_CHANGE_THRESHOLDS.positionDelta, min: 0.1, max: 50 },
  "changes.pageLossPct": { group: "What changed", label: "Page traffic loss", help: "A page lost traffic when its clicks fell by at least this much…", unit: "percent", default: DEFAULT_CHANGE_THRESHOLDS.pageLossPct, min: 0.05, max: 1 },
  "changes.pageMinClicks": { group: "What changed", label: "Page loss: starting clicks", help: "…from at least this many clicks.", unit: "clicks", default: DEFAULT_CHANGE_THRESHOLDS.pageMinClicks, min: 1, max: 1_000_000 },
  "changes.queryMinImpressions": { group: "What changed", label: "Query: impressions to count as ranking", help: "Impressions a query needs to enter or leave the top 10.", unit: "impressions", default: DEFAULT_CHANGE_THRESHOLDS.queryMinImpressions, min: 1, max: 1_000_000 },
  "local.gapMinImpressions": { group: "Local", label: "Coverage gap: minimum impressions", help: "28-day impressions for queries naming a service and a city before a missing page counts as a gap worth acting on.", unit: "impressions", default: 50, min: 1, max: 1_000_000 },
  "reviews.unansweredDays": { group: "Local", label: "Unanswered reviews: look-back", help: "Reviews from the last this many days without a reply are flagged.", unit: "days", default: 30, min: 1, max: 365 },
  "reviews.lowRating": { group: "Local", label: "Unanswered reviews: low rating", help: "An unanswered review at or below this many stars makes the finding high severity.", unit: "stars", default: 3, min: 1, max: 5 },
  "reviews.quietDays": { group: "Local", label: "No new reviews for", help: "Flag a listing that has had no new review for this many days.", unit: "days", default: 60, min: 7, max: 730 },
  "intl.minShare": { group: "International", label: "Missing country version: share of clicks", help: "A country must send at least this share of clicks to a multi-country site with no version for it.", unit: "percent", default: 0.05, min: 0.005, max: 1 },
  "intl.minClicks": { group: "International", label: "Missing country version: minimum clicks", help: "…and at least this many clicks in 28 days.", unit: "clicks", default: 20, min: 1, max: 1_000_000 },
} as const satisfies Record<string, Def>;

export type ThresholdKey = keyof typeof THRESHOLD_DEFS;
export type Thresholds = Record<ThresholdKey, number>;
export const THRESHOLD_KEYS = Object.keys(THRESHOLD_DEFS) as ThresholdKey[];

export const DEFAULT_THRESHOLDS = Object.fromEntries(THRESHOLD_KEYS.map((key) => [key, THRESHOLD_DEFS[key].default])) as Thresholds;

export function isThresholdKey(key: string): key is ThresholdKey {
  return key in THRESHOLD_DEFS;
}

/** Defaults, then each layer in order. Unknown keys and non-finite values are ignored; values are clamped to their range. */
export function mergeThresholds(...layers: readonly { key: string; value: number }[][]): Thresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  for (const layer of layers) {
    for (const { key, value } of layer) {
      if (!isThresholdKey(key) || !Number.isFinite(value)) continue;
      const def = THRESHOLD_DEFS[key];
      out[key] = Math.min(def.max, Math.max(def.min, value));
    }
  }
  return out;
}

export function changeThresholds(t: Thresholds): ChangeThresholds {
  return {
    trafficPct: t["changes.trafficPct"],
    minClicks: t["changes.minClicks"],
    minImpressions: t["changes.minImpressions"],
    ctrPct: t["changes.ctrPct"],
    positionDelta: t["changes.positionDelta"],
    pageLossPct: t["changes.pageLossPct"],
    pageMinClicks: t["changes.pageMinClicks"],
    queryMinImpressions: t["changes.queryMinImpressions"],
  };
}
