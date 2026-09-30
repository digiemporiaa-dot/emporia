import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope, resolveScopeFilter } from "@/lib/social/scope";
import { CredentialsRejectedError } from "@/lib/social/errors";
import { METRIC_KEYS, type MetricKey, type MetricTotal } from "@/lib/social/metrics";
import { engagementOf, isMeasured, SNAPSHOT_SELECT, totalsOf, toReportRow } from "@/lib/social/report";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { AccountRef, ProviderCredentials, SocialProviderAdapter } from "@/lib/social/types";

/**
 * Posts made directly on the platforms, outside Emporia (brief §48, "fetch
 * recent posts").
 *
 * The account check lists the account's recent posts; every one Emporia
 * published is recognised by its platform id and left alone, and the rest are
 * recorded here with their latest figures. They are shown as their own line —
 * "posted directly on the platform" — and never mixed into the agency's
 * figures (the agency chose this: the headline numbers are its own work).
 */

const externalLog = log("social");

/** How far back each check looks: a whole month, so a monthly report's line is complete. */
export const IMPORT_WINDOW_DAYS = 31;
/** Figures are read for posts this recent — the same horizon as Emporia's own posts. */
export const EXTERNAL_METRICS_DAYS = 14;
/** At most this many metric reads per check: third-party calls are the budget. */
export const MAX_METRIC_READS = 25;

export type ImportResult = { listed: number; recorded: number; recognised: number; metricsRead: number };

/**
 * List the account's recent posts and record the ones Emporia did not publish.
 *
 * Called from the account check after the credentials proved good, so it needs
 * no actor. Throws only for rejected credentials — the caller decides what an
 * import failure means; anything else about one post is logged and skipped.
 */
export async function importRecentPosts(
  account: { id: string; clientId: string; provider: SocialProvider } & AccountRef,
  adapter: SocialProviderAdapter,
  credentials: ProviderCredentials,
  now = new Date(),
): Promise<ImportResult> {
  const result: ImportResult = { listed: 0, recorded: 0, recognised: 0, metricsRead: 0 };
  if (!adapter.capabilities.recentPosts || !adapter.listRecentPosts) return result;

  const since = new Date(now.getTime() - IMPORT_WINDOW_DAYS * 86_400_000);
  const listed = await adapter.listRecentPosts(
    credentials,
    { externalId: account.externalId, externalParentId: account.externalParentId ?? null },
    since,
  );
  result.listed = listed.length;
  if (listed.length === 0) return result;

  // Every id a listed post goes by — its own and its aliases — checked against
  // what Emporia published on this platform.
  const ids = [...new Set(listed.flatMap((post) => [post.externalPostId, ...(post.aliases ?? [])]))];
  const ours = new Set(
    (
      await db.socialPost.findMany({
        where: { provider: account.provider, externalPostId: { in: ids } },
        select: { externalPostId: true },
      })
    ).map((post) => post.externalPostId),
  );
  const isOurs = (post: (typeof listed)[number]) =>
    ours.has(post.externalPostId) || (post.aliases ?? []).some((alias) => ours.has(alias));

  // Self-correcting: a post first seen mid-publication, before Emporia stored
  // its id, may have been recorded here. Now that it is recognised, it goes.
  const recognised = listed.filter(isOurs).map((post) => post.externalPostId);
  result.recognised = recognised.length;
  if (recognised.length > 0) {
    await db.socialExternalPost.deleteMany({
      where: { provider: account.provider, externalPostId: { in: recognised } },
    });
  }

  const theirs = listed.filter((post) => !isOurs(post));
  const metricsSince = now.getTime() - EXTERNAL_METRICS_DAYS * 86_400_000;
  for (const post of theirs) {
    const fields = {
      clientId: account.clientId,
      accountId: account.id,
      externalUrl: post.externalUrl,
      caption: post.caption ? post.caption.slice(0, 500) : null,
      format: post.format,
      thumbnailUrl: post.thumbnailUrl,
      publishedAt: post.publishedAt,
    };
    const row = await db.socialExternalPost.upsert({
      where: { provider_externalPostId: { provider: account.provider, externalPostId: post.externalPostId } },
      create: { provider: account.provider, externalPostId: post.externalPostId, ...fields },
      update: fields,
      select: { id: true },
    });
    result.recorded += 1;

    if (!adapter.capabilities.metrics) continue;
    if (post.publishedAt.getTime() < metricsSince || result.metricsRead >= MAX_METRIC_READS) continue;
    try {
      const metrics = await adapter.getMetrics(
        credentials,
        { externalId: account.externalId, externalParentId: account.externalParentId ?? null },
        post.externalPostId,
      );
      const columns = {} as Record<MetricKey, number | null>;
      for (const key of METRIC_KEYS) {
        const value = metrics[key];
        columns[key] = typeof value === "number" ? value : null;
      }
      // Nothing came back: leave the row saying "never read" rather than a row of nulls dated today.
      if (METRIC_KEYS.some((key) => columns[key] !== null)) {
        await db.socialExternalPost.update({ where: { id: row.id }, data: { ...columns, metricsAt: now } });
        result.metricsRead += 1;
      }
    } catch (error) {
      if (error instanceof CredentialsRejectedError) throw error;
      externalLog.warn({ err: error, accountId: account.id }, "reading a direct post's figures failed");
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reading them back
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  provider: true,
  externalUrl: true,
  caption: true,
  format: true,
  thumbnailUrl: true,
  publishedAt: true,
  metricsAt: true,
  account: { select: { name: true } },
  ...SNAPSHOT_SELECT,
} satisfies Prisma.SocialExternalPostSelect;

/** An external post's own figures, read as a report row — the same definitions as the agency's posts. */
const asRow = (post: { id: string; provider: SocialProvider } & Partial<Record<MetricKey, number | null>>) =>
  toReportRow({ id: post.id, provider: post.provider, metrics: [post] });

export const EXTERNAL_PAGE_SIZE = 25;

/** The client's direct posts, newest first, a page at a time. */
export async function listExternalPosts(
  actor: Actor,
  filters: { clientId: string | null; provider: SocialProvider | null; page: number },
) {
  requirePermission(actor, "social.view");
  const scope = await resolveScopeFilter(actor, filters.clientId);
  const where: Prisma.SocialExternalPostWhereInput = {
    ...scope,
    ...(filters.provider ? { provider: filters.provider } : {}),
  };
  const page = Math.max(1, filters.page);
  const [total, rows] = await Promise.all([
    db.socialExternalPost.count({ where }),
    db.socialExternalPost.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * EXTERNAL_PAGE_SIZE,
      take: EXTERNAL_PAGE_SIZE,
      select: listSelect,
    }),
  ]);
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / EXTERNAL_PAGE_SIZE)),
    posts: rows.map((row) => {
      const figures = asRow(row);
      return {
        id: row.id,
        provider: row.provider,
        accountName: row.account.name,
        externalUrl: row.externalUrl,
        caption: row.caption,
        format: row.format,
        thumbnailUrl: row.thumbnailUrl,
        publishedAt: row.publishedAt,
        reach: figures.reach,
        engagement: isMeasured(figures) ? engagementOf(figures) : null,
      };
    }),
  };
}

export type DirectSummary = {
  posts: number;
  /** Posts with at least one figure from the platform. */
  measured: number;
  reach: MetricTotal;
  impressions: MetricTotal;
  /** Likes + comments + shares + saves, from the posts that reported any; null when none did. */
  engagement: MetricTotal;
};

/**
 * The period's "posted directly on the platform" line: how many, and what
 * they did. Same definitions as the agency's own figures, kept apart from them.
 * `clientId` must already be the caller's authorised scope.
 */
export async function directPostsSummary(clientId: string, from: Date | null, to: Date): Promise<DirectSummary> {
  const rows = await db.socialExternalPost.findMany({
    where: { clientId, publishedAt: { ...(from ? { gte: from } : {}), lt: to } },
    take: 10_000,
    select: { id: true, provider: true, ...SNAPSHOT_SELECT },
  });
  const reportRows = rows.map(asRow);
  const measured = reportRows.filter(isMeasured);
  const totals = totalsOf(reportRows);
  return {
    posts: reportRows.length,
    measured: measured.length,
    reach: totals.reach,
    impressions: totals.impressions,
    engagement: {
      value: measured.length > 0 ? measured.reduce((sum, row) => sum + engagementOf(row), 0) : null,
      reporting: measured.length,
      total: reportRows.length,
    },
  };
}

/** The analytics screen's "posted directly" line, for one client and period. */
export async function directPostsForPeriod(
  actor: Actor,
  input: { clientId: string; from: Date | null; to: Date },
): Promise<DirectSummary> {
  requirePermission(actor, "social.analytics.view");
  const scope = await resolveClientScope(actor, input.clientId);
  return directPostsSummary(scope, input.from, input.to);
}
