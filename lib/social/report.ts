import { METRIC_KEYS, type MetricKey, type MetricTotal } from "@/lib/social/metrics";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * Turning snapshots into a report.
 *
 * Pure, and shared by the admin report and the client portal's, because the
 * rule these implement — **absent is not zero** — is exactly the rule that must
 * not drift between the two surfaces. An agency looking at one number and its
 * client looking at a different one for the same week is worse than either
 * screen not existing.
 *
 * The two callers differ only in authorization: staff pass a permission check
 * and may name a client, a portal user is scoped by their session. The
 * arithmetic below is identical by construction.
 */

export type ReportRow = {
  postId: string;
  provider: SocialProvider;
} & Record<MetricKey, number | null>;

/**
 * Sum each metric across the rows that reported it.
 *
 * A metric nobody reported totals to `null`, not `0`. The reporting count comes
 * back with it so a screen can say "from 4 of 9 posts" rather than presenting a
 * partial sum as the whole picture.
 */
export function totalsOf(rows: readonly ReportRow[]): Record<MetricKey, MetricTotal> {
  const totals = {} as Record<MetricKey, MetricTotal>;

  for (const key of METRIC_KEYS) {
    let sum = 0;
    let reporting = 0;
    for (const row of rows) {
      const value = row[key];
      if (value === null) continue;
      sum += value;
      reporting += 1;
    }
    totals[key] = { value: reporting === 0 ? null : sum, reporting, total: rows.length };
  }

  return totals;
}

/** A row counts as measured if the platform gave us anything at all. */
export function isMeasured(row: ReportRow): boolean {
  return METRIC_KEYS.some((key) => row[key] !== null);
}

/**
 * Engagement, for ranking only.
 *
 * Deliberately not presented as a metric of its own: it is a sum of whatever
 * happened to be reported, so it is comparable between two posts on the same
 * platform and not between a LinkedIn post and an Instagram one.
 */
export function engagementOf(row: Record<MetricKey, number | null>): number {
  return (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0) + (row.saves ?? 0);
}

/** The snapshot columns every report selects. One list, so they cannot diverge. */
export const SNAPSHOT_SELECT = {
  impressions: true,
  reach: true,
  likes: true,
  comments: true,
  shares: true,
  saves: true,
  clicks: true,
  videoViews: true,
  profileVisits: true,
  followersGained: true,
} as const;

/** Flatten a post's latest snapshot into a report row. */
export function toReportRow(
  post: { id: string; provider: SocialProvider; metrics: readonly Partial<Record<MetricKey, number | null>>[] },
): ReportRow {
  const snapshot = post.metrics[0];
  const values = {} as Record<MetricKey, number | null>;
  for (const key of METRIC_KEYS) values[key] = snapshot?.[key] ?? null;
  return { postId: post.id, provider: post.provider, ...values };
}

/**
 * How many posts a report will aggregate before it says it stopped.
 *
 * Both reports used to load the newest 200 or 500 posts and present the sum as
 * the period's total — a client with 350 posts saw understated all-time figures
 * and nothing said so. Now a report covers everything up to this cap, which is
 * far beyond any realistic client, and reports `truncated` if it is ever hit so
 * the screen can say the figures are partial rather than imply they are whole.
 */
export const REPORT_POST_CAP = 10_000;
