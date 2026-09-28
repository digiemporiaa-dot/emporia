import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope, resolveScopeFilter } from "@/lib/social/scope";
import { credentialsFor } from "@/lib/services/social-account.service";
import { socialProvider } from "@/lib/social";
import { CAPABILITIES } from "@/lib/social/capabilities";
import { CALENDAR_TIME_ZONE, zonedDay, ymdKey } from "@/lib/social/calendar";
import { METRIC_KEYS, type MetricKey, type MetricTotal } from "@/lib/social/metrics";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { ProviderMetrics, SocialProviderAdapter } from "@/lib/social/types";

/**
 * Reading numbers back from the platforms, and reporting them.
 *
 * ## Absent is not zero
 *
 * The single rule this whole file is organised around. LinkedIn will tell us
 * likes and comments for a member's post and will not tell us impressions;
 * X tells us nothing at all on the tier this integration targets. Recording
 * those unknowns as `0` would be inventing data, and it compounds: a zero flows
 * into a sum, the sum into an average, the average into a slide a client is
 * shown.
 *
 * So every column is nullable, every total counts **how many posts actually
 * reported** alongside the figure, and a metric no post reported comes back as
 * `null` rather than `0`. A screen can then say "not reported" instead of
 * quietly implying nobody saw the post.
 *
 * ## One snapshot per post per day
 *
 * `@@unique([postId, capturedOn])` makes collection idempotent: running the
 * collector twice in a day updates the day's row rather than adding a second.
 * Engagement is cumulative on every platform here, so the latest read for a day
 * is the right value for that day.
 */

const metricsLog = log("social");

export { METRIC_KEYS, METRIC_LABEL } from "@/lib/social/metrics";
export type { MetricKey, MetricTotal } from "@/lib/social/metrics";

/**
 * How long after publication we keep asking.
 *
 * Engagement on a social post is mostly settled within a fortnight, and asking
 * about a six-month-old post every night is a lot of API calls buying almost
 * nothing — and API calls are the budget that stops the posts going out.
 */
export const COLLECT_FOR_DAYS = 14;

export type CollectionRun = {
  attempted: number;
  captured: number;
  skipped: { postId: string; reason: string }[];
  failed: { postId: string; reason: string }[];
};

/**
 * Ask every platform that will answer about every post recent enough to matter.
 *
 * Runs from the cron endpoint. Sequential, like the bulk retry in Phase 7 and
 * for the same reason: these are third-party calls and firing them all at once
 * is how the whole agency gets rate limited at the same moment.
 */
export async function collectMetrics(
  now = new Date(),
  resolve: (provider: SocialProvider) => Promise<SocialProviderAdapter> = socialProvider,
): Promise<CollectionRun> {
  const since = new Date(now.getTime() - COLLECT_FOR_DAYS * 24 * 60 * 60 * 1000);

  const posts = await db.socialPost.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { gte: since },
      externalPostId: { not: null },
      accountId: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
    select: {
      id: true,
      clientId: true,
      provider: true,
      externalPostId: true,
      account: { select: { id: true, externalId: true, status: true } },
    },
  });

  const run: CollectionRun = { attempted: 0, captured: 0, skipped: [], failed: [] };
  const capturedOn = dayStart(now);

  for (const post of posts) {
    // Platforms that do not report are skipped rather than recorded as zero.
    if (!CAPABILITIES[post.provider].metrics) {
      run.skipped.push({ postId: post.id, reason: "That platform does not report metrics." });
      continue;
    }
    if (!post.account || post.account.status !== "CONNECTED") {
      run.skipped.push({ postId: post.id, reason: "The account needs reconnecting." });
      continue;
    }

    const adapter = await resolve(post.provider);
    if (!adapter.configured) {
      run.skipped.push({ postId: post.id, reason: "That platform is not configured." });
      continue;
    }

    run.attempted += 1;

    try {
      const credentials = await credentialsFor(post.account.id);
      if (!credentials) {
        run.skipped.push({ postId: post.id, reason: "The stored credentials could not be read." });
        continue;
      }

      const metrics = await adapter.getMetrics(
        credentials,
        { externalId: post.account.externalId },
        post.externalPostId!,
      );

      // Nothing usable came back. Writing a row of nulls would say "we
      // measured and found nothing", which is not what happened.
      if (!hasAnyFigure(metrics)) {
        run.skipped.push({ postId: post.id, reason: "The platform reported no figures." });
        continue;
      }

      await db.socialMetricSnapshot.upsert({
        where: { postId_capturedOn: { postId: post.id, capturedOn } },
        create: { postId: post.id, clientId: post.clientId, capturedOn, ...toColumns(metrics) },
        update: toColumns(metrics),
      });
      run.captured += 1;
    } catch (error) {
      metricsLog.error({ err: error, postId: post.id }, "reading metrics failed");
      run.failed.push({
        postId: post.id,
        reason: error instanceof Error ? error.message : "The platform did not answer.",
      });
    }
  }

  return run;
}

/** Midnight of the calendar day, in the zone the product reports in. */
function dayStart(instant: Date): Date {
  const { year, month, day } = zonedDay(instant, CALENDAR_TIME_ZONE);
  return new Date(`${ymdKey({ year, month, day })}T00:00:00.000Z`);
}

function hasAnyFigure(metrics: ProviderMetrics): boolean {
  return METRIC_KEYS.some((key) => typeof metrics[key] === "number");
}

/** Only the figures that came back; the rest stay null in the row. */
function toColumns(metrics: ProviderMetrics): Record<MetricKey, number | null> {
  const columns = {} as Record<MetricKey, number | null>;
  for (const key of METRIC_KEYS) {
    const value = metrics[key];
    columns[key] = typeof value === "number" ? value : null;
  }
  return columns;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type SocialReport = {
  posts: number;
  /** Posts with at least one figure from the platform. */
  measured: number;
  totals: Record<MetricKey, MetricTotal>;
  byProvider: {
    provider: SocialProvider;
    posts: number;
    measured: number;
    reportsMetrics: boolean;
    totals: Record<MetricKey, MetricTotal>;
  }[];
  top: {
    postId: string;
    itemId: string;
    title: string;
    provider: SocialProvider;
    publishedAt: string;
    externalUrl: string | null;
    engagement: number;
  }[];
};

type SnapshotRow = {
  postId: string;
  provider: SocialProvider;
} & Record<MetricKey, number | null>;

/**
 * Engagement, for ranking only.
 *
 * Deliberately not presented as a metric of its own: it is a sum of whatever
 * happened to be reported, so it is comparable between two LinkedIn posts and
 * not between a LinkedIn post and an Instagram one. It orders the "best posts"
 * list and appears nowhere else.
 */
function engagementOf(row: Record<MetricKey, number | null>): number {
  return (
    (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0) + (row.saves ?? 0)
  );
}

export async function socialReport(
  actor: Actor,
  filters: { clientId: string | null; from: Date | null; to: Date },
): Promise<SocialReport> {
  requirePermission(actor, "social.analytics.view");
  const scope = await resolveScopeFilter(actor, filters.clientId);

  const where: Prisma.SocialPostWhereInput = {
    ...scope,
    status: "PUBLISHED",
    publishedAt: {
      ...(filters.from ? { gte: filters.from } : {}),
      lt: filters.to,
    },
  };

  const posts = await db.socialPost.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: 500,
    select: {
      id: true,
      provider: true,
      publishedAt: true,
      externalUrl: true,
      contentItem: { select: { id: true, title: true } },
      // The latest snapshot is the current state: engagement is cumulative.
      metrics: {
        orderBy: { capturedOn: "desc" },
        take: 1,
        select: {
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
        },
      },
    },
  });

  const rows: SnapshotRow[] = posts.map((post) => {
    const snapshot = post.metrics[0];
    const values = {} as Record<MetricKey, number | null>;
    for (const key of METRIC_KEYS) values[key] = snapshot?.[key] ?? null;
    return { postId: post.id, provider: post.provider, ...values };
  });

  const byProvider = [...new Set(posts.map((post) => post.provider))].sort().map((provider) => {
    const scoped = rows.filter((row) => row.provider === provider);
    return {
      provider,
      posts: scoped.length,
      measured: scoped.filter((row) => METRIC_KEYS.some((key) => row[key] !== null)).length,
      reportsMetrics: CAPABILITIES[provider].metrics,
      totals: totalsOf(scoped),
    };
  });

  const top = posts
    .map((post) => {
      const row = rows.find((candidate) => candidate.postId === post.id)!;
      return {
        postId: post.id,
        itemId: post.contentItem.id,
        title: post.contentItem.title,
        provider: post.provider,
        publishedAt: (post.publishedAt ?? new Date()).toISOString(),
        externalUrl: post.externalUrl,
        engagement: engagementOf(row),
      };
    })
    .filter((entry) => entry.engagement > 0)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 10);

  return {
    posts: rows.length,
    measured: rows.filter((row) => METRIC_KEYS.some((key) => row[key] !== null)).length,
    totals: totalsOf(rows),
    byProvider,
    top,
  };
}

/**
 * Sum each metric across the rows that reported it.
 *
 * A metric nobody reported totals to `null`, not `0`. The reporting count comes
 * back with it so a screen can say "from 4 of 9 posts" rather than presenting a
 * partial sum as the whole picture.
 */
function totalsOf(rows: readonly SnapshotRow[]): Record<MetricKey, MetricTotal> {
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
    totals[key] = {
      value: reporting === 0 ? null : sum,
      reporting,
      total: rows.length,
    };
  }

  return totals;
}

/** The history for one post, for its own screen. */
export async function metricsForPost(actor: Actor, postId: string) {
  requirePermission(actor, "social.analytics.view");

  const post = await db.socialPost.findUnique({
    where: { id: postId },
    select: { clientId: true },
  });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);

  return db.socialMetricSnapshot.findMany({
    where: { postId },
    orderBy: { capturedOn: "desc" },
    take: 60,
  });
}
