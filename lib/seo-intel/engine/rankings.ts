/**
 * Keyword rankings from Search Console. Pure.
 *
 * Positions are Search Console's impression-weighted average position for the
 * query — real data, labelled as such on screen — not a rank checked by a
 * tool. Opportunity estimates are calculated from the website's own
 * click-through rate at each position, never from an industry curve.
 */

export const MAX_KEYWORD_LENGTH = 200;
export const TRACKED_KEYWORDS_CAP = 500;
export const OPPORTUNITY_MIN_IMPRESSIONS = 50;

/** Lower case, single spaces: the form Search Console reports queries in. Null when nothing is left. */
export function normalizeKeyword(raw: string): string | null {
  const value = raw.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!value || value.length > MAX_KEYWORD_LENGTH) return null;
  return value;
}

/** One keyword per line (commas also split). Duplicates collapsed; unusable entries reported. */
export function parseKeywordList(text: string): { keywords: string[]; rejected: string[] } {
  const seen = new Set<string>();
  const rejected: string[] = [];
  for (const part of text.split(/[\n,]/)) {
    if (!part.trim()) continue;
    const keyword = normalizeKeyword(part);
    if (keyword) seen.add(keyword);
    else rejected.push(part.trim().slice(0, 60));
  }
  return { keywords: [...seen], rejected };
}

/** Tags: trimmed, lower case, unique, at most 10 of 40 characters. */
export function parseTags(text: string): string[] {
  const tags = new Set<string>();
  for (const part of text.split(",")) {
    const tag = part.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40);
    if (tag) tags.add(tag);
  }
  return [...tags].slice(0, 10);
}

export type Metrics = { clicks: number; impressions: number; position: number | null };

export const EMPTY: Metrics = { clicks: 0, impressions: 0, position: null };

/** Rounded position bands, the way search results are read. */
export type Band = "top3" | "top10" | "top20" | "beyond" | "none";

export function bandOf(position: number | null): Band {
  if (position === null) return "none";
  const rounded = Math.round(position);
  if (rounded <= 3) return "top3";
  if (rounded <= 10) return "top10";
  if (rounded <= 20) return "top20";
  return "beyond";
}

const BAND_ORDER: Record<Band, number> = { top3: 0, top10: 1, top20: 2, beyond: 3, none: 4 };

export type Movement = {
  /** Positive = moved up (a smaller position number). Null when either period has no impressions. */
  change: number | null;
  status: "improved" | "declined" | "steady" | "new" | "lost" | "absent";
  entered: Band | null;
  left: Band | null;
};

/** Less than half a position either way is noise in an average. */
const STEADY = 0.5;

export function movementOf(current: Metrics, previous: Metrics): Movement {
  const now = current.impressions > 0 ? current.position : null;
  const before = previous.impressions > 0 ? previous.position : null;
  const bandNow = bandOf(now);
  const bandBefore = bandOf(before);
  let entered: Band | null = null;
  let left: Band | null = null;
  // The best band the keyword reached that it was not in, or lost.
  for (const band of ["top3", "top10", "top20"] as const) {
    if (BAND_ORDER[bandNow] <= BAND_ORDER[band] && BAND_ORDER[bandBefore] > BAND_ORDER[band] && entered === null) entered = band;
    if (BAND_ORDER[bandBefore] <= BAND_ORDER[band] && BAND_ORDER[bandNow] > BAND_ORDER[band] && left === null) left = band;
  }
  if (now === null && before === null) return { change: null, status: "absent", entered, left };
  if (before === null) return { change: null, status: "new", entered, left };
  if (now === null) return { change: null, status: "lost", entered, left };
  const change = before - now;
  return { change, status: change >= STEADY ? "improved" : change <= -STEADY ? "declined" : "steady", entered, left };
}

export type CurveRow = { position: number; clicks: number; impressions: number };

/** Impressions a position needs before its CTR is trusted. */
export const CURVE_MIN_IMPRESSIONS = 200;

/**
 * The website's own click-through rate at positions 1–20: clicks ÷ impressions
 * of every query whose average position rounds to that position. A position
 * with too few impressions has no value (null). Lower positions are capped at
 * the rate of the position above, so noise never makes position 7 "better"
 * than position 4.
 */
export function ownCtrCurve(rows: readonly CurveRow[]): (number | null)[] {
  const clicks = new Array<number>(21).fill(0);
  const impressions = new Array<number>(21).fill(0);
  for (const row of rows) {
    const p = Math.round(row.position);
    if (p < 1 || p > 20) continue;
    clicks[p]! += row.clicks;
    impressions[p]! += row.impressions;
  }
  const curve: (number | null)[] = [null];
  let cap = 1;
  for (let p = 1; p <= 20; p++) {
    if (impressions[p]! < CURVE_MIN_IMPRESSIONS) {
      curve.push(null);
      continue;
    }
    const ctr = Math.min(clicks[p]! / impressions[p]!, cap);
    cap = ctr;
    curve.push(ctr);
  }
  return curve;
}

export type OpportunityBand = "near-top" | "page-two";

/** Where each band is aimed: positions 4–10 into the top 3; page two onto mid page one. */
export const TARGET_POSITION: Record<OpportunityBand, number> = { "near-top": 3, "page-two": 8 };

export function opportunityBand(position: number | null): OpportunityBand | null {
  if (position === null) return null;
  const rounded = Math.round(position);
  if (rounded >= 4 && rounded <= 10) return "near-top";
  if (rounded >= 11 && rounded <= 20) return "page-two";
  return null;
}

export type OpportunityInput = { query: string; clicks: number; impressions: number; position: number };

export type Opportunity = OpportunityInput & {
  band: OpportunityBand;
  /** impressions × (own CTR at the target position − current CTR); null when the curve lacks that position. */
  extraClicks: number | null;
};

/**
 * Queries ranking 4–20 with enough impressions to matter, most promising
 * first. Without an estimate, they are ordered by impressions.
 */
export function findOpportunities(
  rows: readonly OpportunityInput[],
  curve: readonly (number | null)[],
  minImpressions = OPPORTUNITY_MIN_IMPRESSIONS,
): Opportunity[] {
  const out: Opportunity[] = [];
  for (const row of rows) {
    if (row.impressions < minImpressions) continue;
    const band = opportunityBand(row.position);
    if (!band) continue;
    const targetCtr = curve[TARGET_POSITION[band]] ?? null;
    const currentCtr = row.impressions > 0 ? row.clicks / row.impressions : 0;
    const extraClicks = targetCtr === null ? null : Math.max(0, Math.round(row.impressions * (targetCtr - currentCtr)));
    out.push({ ...row, band, extraClicks });
  }
  return out.sort((a, b) => (b.extraClicks ?? -1) - (a.extraClicks ?? -1) || b.impressions - a.impressions);
}
