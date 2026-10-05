/**
 * Shaping history for charts (Phase 11). Pure.
 *
 * Every series is filled: a month or week with nothing in it appears as zero
 * only where zero is the truth (no opportunities opened), and as null where
 * there is simply no data (a month before Search Console was connected).
 */

/** The Monday (UTC) of the week a moment falls in, as YYYY-MM-DD. */
export function weekStart(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

/** The last `count` week starts, oldest first, ending with this week. */
export function lastWeeks(count: number, now: Date): string[] {
  const current = new Date(`${weekStart(now)}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(current);
    d.setUTCDate(d.getUTCDate() - 7 * (count - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/** The last `count` months, oldest first, ending with the month of `latest` (YYYY-MM-DD or YYYY-MM). */
export function lastMonths(count: number, latest: string): string[] {
  const [y, m] = latest.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export type FlowEvent = { firstSeenAt: Date; resolvedAt: Date | null; dismissedAt: Date | null; status: string };
export type FlowWeek = { week: string; opened: number; done: number; resolved: number; dismissed: number };

/**
 * Opportunities opened and closed per week. Closing is counted by the
 * opportunity's current status: done by a person, resolved by the detector,
 * or dismissed — so a reopened item counts only for what it is now.
 */
export function opportunityFlow(events: readonly FlowEvent[], weeks: readonly string[]): FlowWeek[] {
  const rows = new Map(weeks.map((week) => [week, { week, opened: 0, done: 0, resolved: 0, dismissed: 0 }]));
  for (const event of events) {
    const opened = rows.get(weekStart(event.firstSeenAt));
    if (opened) opened.opened += 1;
    if (event.status === "DONE" && event.resolvedAt) {
      const row = rows.get(weekStart(event.resolvedAt));
      if (row) row.done += 1;
    } else if (event.status === "RESOLVED" && event.resolvedAt) {
      const row = rows.get(weekStart(event.resolvedAt));
      if (row) row.resolved += 1;
    } else if (event.status === "DISMISSED" && event.dismissedAt) {
      const row = rows.get(weekStart(event.dismissedAt));
      if (row) row.dismissed += 1;
    }
  }
  return weeks.map((week) => rows.get(week) as FlowWeek);
}

/** Monthly rows placed on a full month axis; months with no row are null. */
export function onMonths<T extends { month: string }>(rows: readonly T[], months: readonly string[]): (T | null)[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  return months.map((month) => byMonth.get(month) ?? null);
}

/** Days in a month (UTC), to say how complete a month's data is. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
