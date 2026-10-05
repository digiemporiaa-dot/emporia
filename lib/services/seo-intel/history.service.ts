import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { toMoneyString } from "@/lib/money";
import { fromDbDate } from "@/lib/seo-intel/dates";
import { daysInMonth, lastMonths, lastWeeks, onMonths, opportunityFlow } from "@/lib/seo-intel/engine/history";
import { ORGANIC_CHANNEL } from "@/lib/seo-intel/normalize/ga4";
import type { Actor } from "@/lib/actor/types";

/**
 * A website's history (Phase 11): sixteen months of search and organic
 * traffic by month, every crawl's headline numbers, opportunities opened and
 * closed per week, and the "What changed" timeline. Read from stored rows.
 */

export const HISTORY_MONTHS = 16;
export const FLOW_WEEKS = 12;

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

type SearchRow = { month: string; clicks: bigint | number; impressions: bigint | number; weighted: number | null; days: bigint | number };
type OrganicRow = { month: string; sessions: bigint | number; keyEvents: number | null; revenue: { toString(): string } | null; days: bigint | number };

/** Search Console clicks, impressions and average position per month, with how many days each month has data for. */
export async function monthlySearch(propertyId: string, months: readonly string[]) {
  const rows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT to_char(date, 'YYYY-MM') AS month, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
           SUM(position * impressions) AS weighted, COUNT(*) AS days
    FROM "GscDailyTotal"
    WHERE "propertyId" = ${propertyId} AND device = '' AND country = '' AND to_char(date, 'YYYY-MM') >= ${months[0] ?? "0000-00"}
    GROUP BY 1`);
  return onMonths(
    rows.map((row) => {
      const impressions = Number(row.impressions);
      return { month: row.month, clicks: Number(row.clicks), impressions, position: impressions > 0 ? Number(row.weighted ?? 0) / impressions : null, days: Number(row.days), daysInMonth: daysInMonth(row.month) };
    }),
    months,
  );
}

/** GA4 organic sessions, key events and revenue per month. */
export async function monthlyOrganic(propertyId: string, months: readonly string[]) {
  const rows = await db.$queryRaw<OrganicRow[]>(Prisma.sql`
    SELECT to_char(date, 'YYYY-MM') AS month, SUM(sessions) AS sessions, SUM("keyEvents") AS "keyEvents", SUM(revenue) AS revenue, COUNT(*) AS days
    FROM "Ga4DailyTotal"
    WHERE "propertyId" = ${propertyId} AND channel = ${ORGANIC_CHANNEL} AND country = '' AND device = '' AND to_char(date, 'YYYY-MM') >= ${months[0] ?? "0000-00"}
    GROUP BY 1`);
  return onMonths(
    rows.map((row) => ({ month: row.month, sessions: Number(row.sessions), keyEvents: Number(row.keyEvents ?? 0), revenue: toMoneyString(row.revenue?.toString() ?? "0"), days: Number(row.days), daysInMonth: daysInMonth(row.month) })),
    months,
  );
}

/** The anchor month: the latest day either source has, else this month. */
async function latestMonth(propertyId: string, now: Date): Promise<string> {
  const [gsc, ga4] = await Promise.all([
    db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } }),
    db.ga4DailyTotal.aggregate({ where: { propertyId }, _max: { date: true } }),
  ]);
  const days = [gsc._max.date, ga4._max.date].filter((d): d is Date => !!d).map(fromDbDate).sort();
  return (days.at(-1) ?? now.toISOString().slice(0, 10)).slice(0, 7);
}

/** Everything the History screen shows. No actor: callers scope the website. */
export async function computeHistory(propertyId: string, now = new Date()) {
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: { id: true, ga4Currency: true, gscSiteUrl: true, ga4PropertyId: true },
  });
  if (!property) throw new NotFoundError("That website was not found.");
  const months = lastMonths(HISTORY_MONTHS, await latestMonth(propertyId, now));
  const weeks = lastWeeks(FLOW_WEEKS, now);
  const since = new Date(`${weeks[0]}T00:00:00Z`);

  const [search, organic, crawls, events, changes] = await Promise.all([
    monthlySearch(propertyId, months),
    monthlyOrganic(propertyId, months),
    db.seoCrawlHistory.findMany({ where: { propertyId }, orderBy: { finishedAt: "desc" }, take: 52, select: { runId: true, finishedAt: true, pagesFetched: true, indexablePages: true, critical: true, warning: true, notice: true } }),
    db.seoOpportunity.findMany({
      where: { propertyId, OR: [{ firstSeenAt: { gte: since } }, { resolvedAt: { gte: since } }, { dismissedAt: { gte: since } }] },
      select: { firstSeenAt: true, resolvedAt: true, dismissedAt: true, status: true },
    }),
    db.seoChangeEvent.findMany({ where: { propertyId }, orderBy: [{ periodEnd: "desc" }, { severity: "asc" }], take: 50, select: { key: true, periodEnd: true, severity: true, direction: true, title: true } }),
  ]);

  return {
    months,
    currency: property.ga4Currency,
    hasSearch: !!property.gscSiteUrl,
    hasAnalytics: !!property.ga4PropertyId,
    search,
    organic,
    crawls: crawls.reverse(),
    flow: opportunityFlow(events, weeks),
    changes: changes.map((change) => ({ ...change, periodEnd: fromDbDate(change.periodEnd) })),
  };
}

export async function siteHistory(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  return computeHistory(propertyId);
}
