import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope } from "@/lib/social/scope";
import { addDays, CALENDAR_TIME_ZONE, ymdKey, zonedDay } from "@/lib/social/calendar";
import { isMeasured, REPORT_POST_CAP, SNAPSHOT_SELECT, toReportRow } from "@/lib/social/report";
import {
  best,
  byCampaign,
  byHour,
  byType,
  byWeekday,
  dailyTrend,
  engagementRate,
  lowest,
  type InsightPost,
} from "@/lib/social/insights";
import { engagementOf } from "@/lib/social/report";
import { COLLECT_FOR_DAYS } from "@/lib/services/social-metrics.service";
import type { DateRange } from "@/lib/analytics/range";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * The analytics beyond totals (brief §23–24): trends, platform-by-platform
 * best days and hours, format and campaign performance, the weakest posts,
 * and engagement rate. Everything is read from stored snapshots; the rules
 * live in `lib/social/insights.ts`.
 */

/** A trend over "all time" still has to end somewhere readable. */
const TREND_DEFAULT_DAYS = 90;

export async function socialInsights(
  actor: Actor,
  input: { clientId: string; range: DateRange; provider: SocialProvider | null },
) {
  requirePermission(actor, "social.analytics.view");
  const scope = await resolveClientScope(actor, input.clientId);

  const fetched = await db.socialPost.findMany({
    where: {
      clientId: scope,
      status: "PUBLISHED",
      publishedAt: { ...(input.range.from ? { gte: input.range.from } : {}), lt: input.range.to },
    },
    orderBy: { publishedAt: "desc" },
    take: REPORT_POST_CAP + 1,
    select: {
      id: true,
      provider: true,
      type: true,
      publishedAt: true,
      externalUrl: true,
      contentItem: { select: { id: true, title: true, campaign: { select: { id: true, name: true } } } },
      metrics: { orderBy: { capturedOn: "desc" }, take: 1, select: SNAPSHOT_SELECT },
    },
  });
  const truncated = fetched.length > REPORT_POST_CAP;
  const posts: InsightPost[] = (truncated ? fetched.slice(0, REPORT_POST_CAP) : fetched).map((post) => ({
    postId: post.id,
    itemId: post.contentItem.id,
    title: post.contentItem.title,
    provider: post.provider,
    type: post.type,
    publishedAt: post.publishedAt ?? new Date(0),
    externalUrl: post.externalUrl,
    campaign: post.contentItem.campaign,
    row: toReportRow(post),
  }));

  // Days and hours per platform: engagement is not comparable across them.
  const providers = [...new Set(posts.map((post) => post.provider))]
    .map((provider) => {
      const own = posts.filter((post) => post.provider === provider);
      return { provider, posts: own.length, measured: own.filter((post) => isMeasured(post.row)).length };
    })
    .sort((a, b) => b.measured - a.measured || b.posts - a.posts);
  const provider = providers.find((p) => p.provider === input.provider)?.provider ?? providers[0]?.provider ?? null;
  const slotPosts = posts.filter((post) => post.provider === provider);
  const weekdays = byWeekday(slotPosts);
  const hours = byHour(slotPosts);

  const brief = (post: InsightPost) => ({
    postId: post.postId,
    itemId: post.itemId,
    title: post.title,
    provider: post.provider,
    type: post.type,
    publishedAt: post.publishedAt.toISOString(),
    externalUrl: post.externalUrl,
    reach: post.row.reach,
    likes: post.row.likes,
    comments: post.row.comments,
    shares: post.row.shares,
    saves: post.row.saves,
    engagement: engagementOf(post.row),
    rate: engagementRate(post.row),
  });

  return {
    truncated,
    providers,
    provider,
    weekdays,
    hours,
    bestDay: best(weekdays),
    bestHour: best(hours),
    types: byType(posts),
    campaigns: byCampaign(posts),
    lowest: lowest(posts).map(brief),
    trend: await trendFor(scope, input.range),
  };
}

export type SocialInsights = Awaited<ReturnType<typeof socialInsights>>;

async function trendFor(clientId: string, range: DateRange) {
  const toKey = ymdKey(zonedDay(new Date(range.to.getTime() - 1), CALENDAR_TIME_ZONE));
  const fromYmd = range.from
    ? zonedDay(range.from, CALENDAR_TIME_ZONE)
    : addDays(zonedDay(range.to, CALENDAR_TIME_ZONE), -TREND_DEFAULT_DAYS);
  const days: string[] = [];
  for (let day = fromYmd; ymdKey(day) <= toKey && days.length < 400; day = addDays(day, 1)) days.push(ymdKey(day));
  if (days.length === 0) return [];

  // Back far enough that each post's first in-range day has the snapshot
  // before it, so the day's rise is measured rather than the running total.
  const since = new Date(`${ymdKey(addDays(fromYmd, -(COLLECT_FOR_DAYS + 1)))}T00:00:00.000Z`);
  const until = new Date(`${ymdKey(addDays(zonedDay(new Date(range.to.getTime() - 1), CALENDAR_TIME_ZONE), 1))}T00:00:00.000Z`);
  const snapshots = await db.socialMetricSnapshot.findMany({
    where: { post: { clientId }, capturedOn: { gte: since, lt: until } },
    orderBy: [{ postId: "asc" }, { capturedOn: "asc" }],
    take: 200_000,
    select: { postId: true, capturedOn: true, ...SNAPSHOT_SELECT },
  });

  return dailyTrend(
    snapshots.map(({ capturedOn, ...rest }) => ({ ...rest, day: capturedOn.toISOString().slice(0, 10) })),
    days,
  );
}
