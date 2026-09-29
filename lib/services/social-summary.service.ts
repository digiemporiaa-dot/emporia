import "server-only";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope } from "@/lib/social/scope";
import type { Actor } from "@/lib/actor/types";
import { REPORT_POST_CAP, SNAPSHOT_SELECT, isMeasured, toReportRow, totalsOf, engagementOf } from "@/lib/social/report";
import { aggregateRate, byType, engagementRate } from "@/lib/social/insights";
import type { MetricTotal } from "@/lib/social/metrics";
import type { SocialPostType, SocialProvider } from "@/generated/prisma/enums";

/**
 * What a client's social posts did in a period, from stored snapshots only.
 *
 * One function behind the Overview's "this month" and the monthly report, so
 * the two can never show different numbers for the same month. It takes a
 * client id the caller has **already** authorised and scoped — `periodSummary`
 * is not an entry point and does no permission check of its own.
 *
 * "Top" post, platform and campaign are chosen by engagement rate (engagement
 * over reach): raw engagement is not comparable across platforms. Anything
 * with no reach reported cannot be top; if nothing reported reach, there is
 * no top, and the report says so.
 */

export type PeriodSummary = {
  posts: number;
  measured: number;
  truncated: boolean;
  totals: { reach: MetricTotal; impressions: MetricTotal; engagement: MetricTotal; followersGained: MetricTotal };
  rate: { value: number | null; reporting: number };
  byProvider: { provider: SocialProvider; posts: number; measured: number; rate: number | null }[];
  formats: { provider: SocialProvider; type: SocialPostType; posts: number; measured: number; avgRate: number | null }[];
  campaigns: { id: string; name: string; posts: number; rate: number | null }[];
  pillars: { name: string; posts: number }[];
  topPost: {
    postId: string;
    itemId: string;
    title: string;
    provider: SocialProvider;
    type: SocialPostType;
    publishedAt: string;
    externalUrl: string | null;
    reach: number;
    engagement: number;
    rate: number;
  } | null;
  topPlatform: { provider: SocialProvider; rate: number } | null;
  topCampaign: { id: string; name: string; rate: number } | null;
};

export async function periodSummary(clientId: string, from: Date, to: Date): Promise<PeriodSummary> {
  const fetched = await db.socialPost.findMany({
    where: { clientId, status: "PUBLISHED", publishedAt: { gte: from, lt: to } },
    orderBy: { publishedAt: "desc" },
    take: REPORT_POST_CAP + 1,
    select: {
      id: true,
      provider: true,
      type: true,
      publishedAt: true,
      externalUrl: true,
      contentItem: {
        select: { id: true, title: true, campaign: { select: { id: true, name: true } }, pillar: { select: { name: true } } },
      },
      metrics: { orderBy: { capturedOn: "desc" }, take: 1, select: SNAPSHOT_SELECT },
    },
  });
  const truncated = fetched.length > REPORT_POST_CAP;
  const posts = truncated ? fetched.slice(0, REPORT_POST_CAP) : fetched;
  const rows = posts.map(toReportRow);
  const totals = totalsOf(rows);

  // Engagement as its own total: a post contributes when it reported any of
  // the four figures it is made of.
  const engaged = rows.filter((row) => row.likes !== null || row.comments !== null || row.shares !== null || row.saves !== null);
  const engagement: MetricTotal = {
    value: engaged.length ? engaged.reduce((sum, row) => sum + engagementOf(row), 0) : null,
    reporting: engaged.length,
    total: rows.length,
  };

  const group = <K extends string>(keyOf: (index: number) => K | null) => {
    const map = new Map<K, number[]>();
    posts.forEach((_, index) => {
      const key = keyOf(index);
      if (key === null) return;
      map.set(key, [...(map.get(key) ?? []), index]);
    });
    return map;
  };

  const byProvider = [...group((i) => posts[i]!.provider).entries()]
    .map(([provider, indexes]) => ({
      provider,
      posts: indexes.length,
      measured: indexes.filter((i) => isMeasured(rows[i]!)).length,
      rate: aggregateRate(indexes.map((i) => rows[i]!)).value,
    }))
    .sort((a, b) => b.posts - a.posts);

  const campaigns = [...group((i) => posts[i]!.contentItem.campaign?.id ?? null).entries()]
    .map(([id, indexes]) => ({
      id,
      name: posts[indexes[0]!]!.contentItem.campaign!.name,
      posts: indexes.length,
      rate: aggregateRate(indexes.map((i) => rows[i]!)).value,
    }))
    .sort((a, b) => b.posts - a.posts);

  const pillars = [...group((i) => posts[i]!.contentItem.pillar?.name ?? null).entries()]
    .map(([name, indexes]) => ({ name, posts: indexes.length }))
    .sort((a, b) => b.posts - a.posts);

  const formats = byType(
    posts.map((post, i) => ({
      postId: post.id,
      itemId: post.contentItem.id,
      title: post.contentItem.title,
      provider: post.provider,
      type: post.type,
      publishedAt: post.publishedAt ?? new Date(0),
      externalUrl: post.externalUrl,
      campaign: post.contentItem.campaign,
      row: rows[i]!,
    })),
  ).map((f) => ({ provider: f.provider, type: f.type, posts: f.posts, measured: f.measured, avgRate: f.avgRate }));

  const rated = posts
    .map((post, i) => ({ post, row: rows[i]!, rate: engagementRate(rows[i]!) }))
    .filter((entry): entry is typeof entry & { rate: number } => entry.rate !== null)
    .sort((a, b) => b.rate - a.rate || engagementOf(b.row) - engagementOf(a.row));
  const top = rated[0];

  const best = <T extends { rate: number | null }>(list: readonly T[]) =>
    list.filter((entry) => entry.rate !== null).sort((a, b) => b.rate! - a.rate!)[0] ?? null;
  const topPlatform = best(byProvider);
  const topCampaign = best(campaigns);

  return {
    posts: rows.length,
    measured: rows.filter(isMeasured).length,
    truncated,
    totals: { reach: totals.reach, impressions: totals.impressions, engagement, followersGained: totals.followersGained },
    rate: aggregateRate(rows),
    byProvider,
    formats,
    campaigns,
    pillars,
    topPost: top
      ? {
          postId: top.post.id,
          itemId: top.post.contentItem.id,
          title: top.post.contentItem.title,
          provider: top.post.provider,
          type: top.post.type,
          publishedAt: (top.post.publishedAt ?? new Date(0)).toISOString(),
          externalUrl: top.post.externalUrl,
          reach: top.row.reach!,
          engagement: engagementOf(top.row),
          rate: top.rate,
        }
      : null,
    topPlatform: topPlatform ? { provider: topPlatform.provider, rate: topPlatform.rate! } : null,
    topCampaign: topCampaign ? { id: topCampaign.id, name: topCampaign.name, rate: topCampaign.rate! } : null,
  };
}

export const PUBLISHED_PAGE_SIZE = 25;

/**
 * A client's published versions, newest first, a page at a time — never the
 * whole table into the browser. Figures are returned only to someone who may
 * see analytics.
 */
export async function listPublished(
  actor: Actor,
  input: { clientId: string; provider: SocialProvider | null; campaignId: string | null; page: number },
) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, input.clientId);
  const seesFigures = can(actor, "social.analytics.view");

  const where = {
    clientId: scope,
    status: "PUBLISHED" as const,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.campaignId ? { contentItem: { campaignId: input.campaignId } } : {}),
  };
  const page = Math.max(1, input.page);
  const [total, posts] = await Promise.all([
    db.socialPost.count({ where }),
    db.socialPost.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PUBLISHED_PAGE_SIZE,
      take: PUBLISHED_PAGE_SIZE,
      select: {
        id: true,
        provider: true,
        type: true,
        publishedAt: true,
        externalUrl: true,
        caption: true,
        account: { select: { name: true } },
        contentItem: { select: { id: true, title: true, campaign: { select: { id: true, name: true } } } },
        media: { orderBy: { order: "asc" }, take: 1, select: { media: { select: { url: true, alt: true, type: true } } } },
        metrics: { orderBy: { capturedOn: "desc" }, take: 1, select: SNAPSHOT_SELECT },
      },
    }),
  ]);

  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PUBLISHED_PAGE_SIZE)),
    seesFigures,
    posts: posts.map((post) => {
      const row = toReportRow(post);
      return {
        id: post.id,
        itemId: post.contentItem.id,
        title: post.contentItem.title,
        campaign: post.contentItem.campaign,
        provider: post.provider,
        type: post.type,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        externalUrl: post.externalUrl,
        caption: post.caption,
        accountName: post.account?.name ?? null,
        thumbnail: post.media[0]?.media.type === "IMAGE" ? { url: post.media[0].media.url, alt: post.media[0].media.alt } : null,
        figures: seesFigures
          ? { reach: row.reach, impressions: row.impressions, engagement: isMeasured(row) ? engagementOf(row) : null, rate: engagementRate(row) }
          : null,
      };
    }),
  };
}
