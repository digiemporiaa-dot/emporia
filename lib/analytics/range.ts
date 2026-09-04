/**
 * Reporting date ranges.
 *
 * One definition of "last 30 days", shared by the analytics dashboard, campaign
 * reporting and the portal, so two screens can never disagree about what a
 * range covers (CLAUDE.md 4).
 *
 * Ranges are half-open: `from` inclusive, `to` exclusive. That makes "today"
 * unambiguous at a day boundary and keeps the SQL a plain indexed scan.
 */

export const RANGE_PRESETS = ["7d", "30d", "90d", "mtd", "qtd", "ytd", "all"] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABEL: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "This month",
  qtd: "This quarter",
  ytd: "This year",
  all: "All time",
};

export type DateRange = {
  preset: RangePreset;
  /** Inclusive. `null` only for the all-time range. */
  from: Date | null;
  /** Exclusive. */
  to: Date;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysAgo(now: Date, days: number): Date {
  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

export function resolveRange(preset: RangePreset, now = new Date()): DateRange {
  // Exclusive upper bound: the start of tomorrow, so everything recorded today
  // counts without a same-instant comparison.
  const to = startOfDay(now);
  to.setDate(to.getDate() + 1);

  switch (preset) {
    case "7d":
      return { preset, from: daysAgo(now, 7), to };
    case "30d":
      return { preset, from: daysAgo(now, 30), to };
    case "90d":
      return { preset, from: daysAgo(now, 90), to };
    case "mtd":
      return { preset, from: new Date(now.getFullYear(), now.getMonth(), 1), to };
    case "qtd":
      return {
        preset,
        from: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1),
        to,
      };
    case "ytd":
      return { preset, from: new Date(now.getFullYear(), 0, 1), to };
    case "all":
      return { preset, from: null, to };
  }
}

/** A Prisma filter for a timestamp column, or undefined for all time. */
export function rangeFilter(range: DateRange): { gte: Date; lt: Date } | undefined {
  return range.from ? { gte: range.from, lt: range.to } : undefined;
}

/** How many whole days the range covers, for per-day averages. `null` for all time. */
export function rangeDays(range: DateRange): number | null {
  if (!range.from) return null;
  return Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000));
}
