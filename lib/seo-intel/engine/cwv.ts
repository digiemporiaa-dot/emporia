/**
 * Core Web Vitals verdicts (Phase 11). Pure.
 *
 * Google's published thresholds, at the 75th percentile: good at or under the
 * first number, poor over the second, "needs improvement" between. A page
 * passes Core Web Vitals when LCP, INP and CLS are all good; one poor metric
 * makes it poor. A metric Google did not report is unknown, never assumed.
 */

export type CwvMetric = "lcp" | "inp" | "cls" | "fcp" | "ttfb";
export type CwvRating = "good" | "needs-improvement" | "poor";

export const CWV_THRESHOLDS: Record<CwvMetric, { good: number; poor: number }> = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
  fcp: { good: 1800, poor: 3000 },
  ttfb: { good: 800, poor: 1800 },
};

export const CORE_METRICS: readonly CwvMetric[] = ["lcp", "inp", "cls"];

export function rateMetric(metric: CwvMetric, value: number | null): CwvRating | null {
  if (value === null) return null;
  const { good, poor } = CWV_THRESHOLDS[metric];
  if (value <= good) return "good";
  return value > poor ? "poor" : "needs-improvement";
}

/**
 * The page's overall verdict from its three core metrics. Poor if any is poor;
 * good only if all three are known and good; otherwise needs improvement —
 * or null when none is known.
 */
export function cwvVerdict(values: { lcp: number | null; inp: number | null; cls: number | null }): CwvRating | null {
  const ratings = CORE_METRICS.map((metric) => rateMetric(metric, values[metric as "lcp" | "inp" | "cls"]));
  if (ratings.every((rating) => rating === null)) return null;
  if (ratings.includes("poor")) return "poor";
  if (ratings.every((rating) => rating === "good")) return "good";
  return "needs-improvement";
}

/** The origin to ask CrUX about, and the other www variant to try when the first has no data. */
export function cruxOrigins(domain: string, protocol: "HTTP" | "HTTPS"): [string, string] {
  const scheme = protocol === "HTTP" ? "http" : "https";
  const host = domain.toLowerCase();
  const other = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [`${scheme}://${host}`, `${scheme}://${other}`];
}
