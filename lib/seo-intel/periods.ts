import { addDays } from "@/lib/seo-intel/dates";

/**
 * The comparison periods on the overview. Pure.
 *
 * Every period is anchored on the latest day Search Console has data for —
 * not on today — because Google lags two to three days, and comparing a
 * half-reported week with a complete one would invent a drop.
 */

export const SEO_PERIODS = ["day", "7d", "28d", "mom", "yoy"] as const;
export type SeoPeriod = (typeof SEO_PERIODS)[number];

export const SEO_PERIOD_LABEL: Record<SeoPeriod, string> = {
  day: "Latest day",
  "7d": "7 days",
  "28d": "28 days",
  mom: "Month over month",
  yoy: "Year over year",
};

export type DayRange = { start: string; end: string };

export type ResolvedPeriod = {
  period: SeoPeriod;
  current: DayRange;
  previous: DayRange;
  /** "the previous 28 days", for sentences like "…compared with the previous 28 days". */
  comparedWith: string;
};

const lastDayOfMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

export function resolvePeriod(period: SeoPeriod, latest: string): ResolvedPeriod {
  switch (period) {
    case "day":
      return { period, current: { start: latest, end: latest }, previous: { start: addDays(latest, -1), end: addDays(latest, -1) }, comparedWith: "the day before" };
    case "7d":
      return { period, current: { start: addDays(latest, -6), end: latest }, previous: { start: addDays(latest, -13), end: addDays(latest, -7) }, comparedWith: "the previous 7 days" };
    case "28d":
      return { period, current: { start: addDays(latest, -27), end: latest }, previous: { start: addDays(latest, -55), end: addDays(latest, -28) }, comparedWith: "the previous 28 days" };
    case "mom": {
      // Month to date against the same days of the month before, clamped
      // where the previous month is shorter (31 March → 28/29 February).
      const [y, m, d] = latest.split("-").map(Number) as [number, number, number];
      const start = `${latest.slice(0, 8)}01`;
      const prevYear = m === 1 ? y - 1 : y;
      const prevMonth0 = m === 1 ? 11 : m - 2;
      const prevLast = lastDayOfMonth(prevYear, prevMonth0);
      const isMonthEnd = d === lastDayOfMonth(y, m - 1);
      const prevEndDay = isMonthEnd ? prevLast : Math.min(d, prevLast);
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        period,
        current: { start, end: latest },
        previous: { start: `${prevYear}-${pad(prevMonth0 + 1)}-01`, end: `${prevYear}-${pad(prevMonth0 + 1)}-${pad(prevEndDay)}` },
        comparedWith: "the same days last month",
      };
    }
    case "yoy":
      // 364 days back keeps weekdays aligned; weekday traffic differs a lot.
      return {
        period,
        current: { start: addDays(latest, -27), end: latest },
        previous: { start: addDays(latest, -27 - 364), end: addDays(latest, -364) },
        comparedWith: "the same 28 days a year earlier",
      };
  }
}

/** A relative change, or null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}
