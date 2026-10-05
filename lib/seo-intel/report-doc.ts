import { z } from "zod";

/**
 * The frozen contents of a monthly SEO report (Phase 11).
 *
 * Written once, when the report is generated, from stored Search Console,
 * GA4, crawl, opportunity, review and Core Web Vitals rows — never from a
 * model — and validated on the way in and out, so the portal shows exactly
 * what was generated. A source that was not connected is `null`, never zeros.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const searchTotals = z.object({
  clicks: z.number().int(),
  impressions: z.number().int(),
  ctr: z.number().nullable(),
  position: z.number().nullable(),
  /** Days with data in the period. */
  days: z.number().int(),
});

const organicTotals = z.object({
  sessions: z.number().int(),
  engagedSessions: z.number().int(),
  keyEvents: z.number(),
  /** Two decimal places, GA4's currency. */
  revenue: z.string(),
  days: z.number().int(),
});

const crawl = z.object({ finishedAt: z.string(), pagesFetched: z.number().int(), indexablePages: z.number().int(), critical: z.number().int(), warning: z.number().int(), notice: z.number().int() });

export const seoReportDataSchema = z.object({
  version: z.literal(1),
  website: z.object({ name: z.string().max(300), domain: z.string().max(300), client: z.string().max(300) }),
  month: z.string().regex(MONTH_RE),
  generatedAt: z.string(),
  search: z
    .object({
      current: searchTotals,
      previous: searchTotals,
      lastYear: searchTotals,
      daysInMonth: z.number().int(),
      topQueries: z.array(z.object({ query: z.string().max(500), clicks: z.number().int(), impressions: z.number().int(), position: z.number().nullable(), previousClicks: z.number().int() })).max(10),
      topPages: z.array(z.object({ page: z.string().max(2000), clicks: z.number().int(), impressions: z.number().int(), previousClicks: z.number().int() })).max(10),
    })
    .nullable(),
  keywords: z
    .object({
      tracked: z.number().int(),
      inTop10: z.number().int(),
      improved: z.array(z.object({ keyword: z.string().max(500), from: z.number(), to: z.number() })).max(5),
      declined: z.array(z.object({ keyword: z.string().max(500), from: z.number(), to: z.number() })).max(5),
    })
    .nullable(),
  organic: z.object({ current: organicTotals, previous: organicTotals, currency: z.string().nullable() }).nullable(),
  technical: z.object({ latest: crawl, previous: crawl.nullable() }).nullable(),
  opportunities: z.object({
    opened: z.number().int(),
    done: z.number().int(),
    resolved: z.number().int(),
    openNow: z.number().int(),
    top: z.array(z.object({ title: z.string().max(300), severity: z.enum(["HIGH", "MEDIUM", "LOW"]) })).max(5),
  }),
  reviews: z
    .object({
      locations: z.number().int(),
      newReviews: z.number().int(),
      averageInMonth: z.number().nullable(),
      unanswered: z.number().int(),
      googleRating: z.number().nullable(),
    })
    .nullable(),
  cwv: z
    .object({
      periodEnd: z.string(),
      formFactor: z.string().max(20),
      lcp: z.number().nullable(),
      inp: z.number().nullable(),
      cls: z.number().nullable(),
    })
    .nullable(),
  changes: z.array(z.object({ title: z.string().max(300), severity: z.enum(["HIGH", "MEDIUM", "LOW"]), periodEnd: z.string() })).max(10),
});

export type SeoReportData = z.infer<typeof seoReportDataSchema>;

export function readSeoReportData(value: unknown): SeoReportData | null {
  const parsed = seoReportDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const isReportMonth = (value: string) => MONTH_RE.test(value);

/** Completed months that can be reported, newest first: the last `count`, never the current one. */
export function reportableMonths(now: Date, count = 13): string[] {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
}

/** The first and last day of a month. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: `${month}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** The month before, and the same month a year earlier. */
export function shiftMonth(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

export function reportMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Percent change, or null when there is no base to compare with. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}
