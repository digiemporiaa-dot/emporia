import { CALENDAR_TIME_ZONE, weekdayIndex, WEEKDAYS, zonedDay, zonedHour } from "@/lib/social/calendar";
import { engagementOf, isMeasured, type ReportRow } from "@/lib/social/report";
import type { MetricKey } from "@/lib/social/metrics";
import type { SocialPostType, SocialProvider } from "@/generated/prisma/enums";

/**
 * What the published posts say about *how* to post: which days and hours,
 * which formats, which campaigns — and which posts did worst.
 *
 * Pure and shared, like `report.ts`, so the rules cannot drift between
 * screens. The rules are the report's: absent is not zero (an unmeasured post
 * is counted as a post and never as a zero), and engagement — a sum of
 * whatever was reported — is compared only within one platform. That is why
 * slots are worked out per platform, and why a "best" slot needs enough
 * measured posts to mean anything.
 */

/** Measured posts a slot needs before it can be called the best. */
export const MIN_SAMPLE = 3;

export type InsightPost = {
  postId: string;
  itemId: string;
  title: string;
  provider: SocialProvider;
  type: SocialPostType;
  publishedAt: Date;
  externalUrl: string | null;
  campaign: { id: string; name: string } | null;
  row: ReportRow;
};

/**
 * Engagement as a share of reach, as a percentage. Null when the platform did
 * not report reach (or reported none), or reported no engagement figure at
 * all — a rate over an unknown is not a rate.
 */
export function engagementRate(row: Record<MetricKey, number | null>): number | null {
  if (!row.reach || row.reach <= 0) return null;
  if (row.likes === null && row.comments === null && row.shares === null && row.saves === null) return null;
  return (engagementOf(row) / row.reach) * 100;
}

export type SlotStats = {
  key: string;
  label: string;
  posts: number;
  measured: number;
  /** Mean engagement per measured post. Null when none was measured. */
  avgEngagement: number | null;
  /** Mean engagement rate over posts that reported reach. */
  avgRate: number | null;
  rated: number;
};

function stats(key: string, label: string, posts: readonly InsightPost[]): SlotStats {
  const measured = posts.filter((post) => isMeasured(post.row));
  const rates = measured.map((post) => engagementRate(post.row)).filter((rate): rate is number => rate !== null);
  return {
    key,
    label,
    posts: posts.length,
    measured: measured.length,
    avgEngagement: measured.length ? measured.reduce((sum, post) => sum + engagementOf(post.row), 0) / measured.length : null,
    avgRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    rated: rates.length,
  };
}

function group<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Monday first, every day present, in the calendar's zone. */
export function byWeekday(posts: readonly InsightPost[]): SlotStats[] {
  const groups = group(posts, (post) => String(weekdayIndex(zonedDay(post.publishedAt, CALENDAR_TIME_ZONE))));
  return WEEKDAYS.map((label, index) => stats(String(index), label, groups.get(String(index)) ?? []));
}

/** Hours of the day that held at least one post, earliest first. */
export function byHour(posts: readonly InsightPost[]): SlotStats[] {
  const groups = group(posts, (post) => String(zonedHour(post.publishedAt, CALENDAR_TIME_ZONE)));
  return [...groups.entries()]
    .map(([hour, list]) => stats(hour, `${hour.padStart(2, "0")}:00`, list))
    .sort((a, b) => Number(a.key) - Number(b.key));
}

/**
 * The slot with the highest mean engagement among those with enough measured
 * posts — or null, which the screen reports as "not enough posts yet" rather
 * than crowning a slot on one lucky post.
 */
export function best(slots: readonly SlotStats[], min = MIN_SAMPLE): SlotStats | null {
  const eligible = slots.filter((slot) => slot.measured >= min && slot.avgEngagement !== null);
  if (eligible.length === 0) return null;
  return eligible.reduce((top, slot) => (slot.avgEngagement! > top.avgEngagement! ? slot : top));
}

/** Per platform and format: a reel is only compared with other Instagram posts. */
export function byType(posts: readonly InsightPost[]): (SlotStats & { provider: SocialProvider; type: SocialPostType })[] {
  const groups = group(posts, (post) => `${post.provider}:${post.type}`);
  return [...groups.entries()]
    .map(([key, list]) => ({ ...stats(key, key, list), provider: list[0]!.provider, type: list[0]!.type }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || (b.avgEngagement ?? -1) - (a.avgEngagement ?? -1));
}

export type CampaignStats = SlotStats & { reach: number | null; reachReporting: number };

/** Per campaign, with reach summed over the posts that reported it; best engagement rate first. */
export function byCampaign(posts: readonly InsightPost[]): CampaignStats[] {
  const groups = group(
    posts.filter((post) => post.campaign),
    (post) => post.campaign!.id,
  );
  return [...groups.values()]
    .map((list) => {
      const reached = list.filter((post) => post.row.reach !== null);
      return {
        ...stats(list[0]!.campaign!.id, list[0]!.campaign!.name, list),
        reach: reached.length ? reached.reduce((sum, post) => sum + post.row.reach!, 0) : null,
        reachReporting: reached.length,
      };
    })
    // By engagement rate: a campaign spans platforms, and raw engagement is
    // not comparable across them (see `engagementOf`); a rate over reach is.
    .sort((a, b) => (b.avgRate ?? -1) - (a.avgRate ?? -1) || (b.avgEngagement ?? -1) - (a.avgEngagement ?? -1));
}

/** The least engagement among *measured* posts: an unmeasured post is unknown, not bad. */
export function lowest(posts: readonly InsightPost[], count = 5): InsightPost[] {
  return posts
    .filter((post) => isMeasured(post.row))
    .sort((a, b) => engagementOf(a.row) - engagementOf(b.row))
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export type TrendKey = "impressions" | "reach" | "engagement" | "followersGained";
export const TREND_KEYS: readonly TrendKey[] = ["impressions", "reach", "engagement", "followersGained"];

export type TrendPoint = { day: string } & Record<TrendKey, number | null>;

type Snapshot = { postId: string; day: string } & Record<MetricKey, number | null>;

const engagementOrNull = (s: Record<MetricKey, number | null>) =>
  s.likes === null && s.comments === null && s.shares === null && s.saves === null ? null : engagementOf(s);

/**
 * What each day added, from the daily snapshots.
 *
 * Platforms report running totals per post, so a day's figure is the rise
 * since that post's previous snapshot (its first snapshot counts in full), and
 * the day's point is the sum over posts. A metric no post reported that day is
 * null, not zero. Reach is summed across posts the same way the report's total
 * is, so it counts accounts per post rather than unique people.
 */
export function dailyTrend(snapshots: readonly Snapshot[], days: readonly string[]): TrendPoint[] {
  const byPost = group(snapshots, (s) => s.postId);
  const sums = new Map<string, Record<TrendKey, number | null>>();

  const value = (s: Snapshot, key: TrendKey) => (key === "engagement" ? engagementOrNull(s) : s[key]);

  for (const list of byPost.values()) {
    const ordered = [...list].sort((a, b) => a.day.localeCompare(b.day));
    ordered.forEach((snapshot, index) => {
      const previous = index > 0 ? ordered[index - 1]! : null;
      const point = sums.get(snapshot.day) ?? { impressions: null, reach: null, engagement: null, followersGained: null };
      for (const key of TREND_KEYS) {
        const now = value(snapshot, key);
        if (now === null) continue;
        const before = previous ? value(previous, key) : 0;
        if (before === null) continue;
        point[key] = (point[key] ?? 0) + (now - before);
      }
      sums.set(snapshot.day, point);
    });
  }

  return days.map((day) => ({
    day,
    ...(sums.get(day) ?? { impressions: null, reach: null, engagement: null, followersGained: null }),
  }));
}

/** Keys a trend chart can draw: at least one day reported a figure. */
export function reportedTrendKeys(points: readonly TrendPoint[]): TrendKey[] {
  return TREND_KEYS.filter((key) => points.some((point) => point[key] !== null));
}

/**
 * Engagement rate across many posts: total engagement over total reach, from
 * the posts that reported both. Not the average of per-post rates, which
 * would let a post seen by ten people weigh as much as one seen by ten
 * thousand. Null when no post reported reach.
 */
export function aggregateRate(rows: readonly Record<MetricKey, number | null>[]): { value: number | null; reporting: number } {
  let engagement = 0;
  let reach = 0;
  let reporting = 0;
  for (const row of rows) {
    if (engagementRate(row) === null) continue;
    engagement += engagementOf(row);
    reach += row.reach!;
    reporting += 1;
  }
  return { value: reporting ? (engagement / reach) * 100 : null, reporting };
}
