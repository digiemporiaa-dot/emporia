import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { Prisma } from "@/generated/prisma/client";
import { ctr, type GscMetrics } from "@/lib/seo-intel/normalize/gsc";
import { eachDay, fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import { percentChange, resolvePeriod, type DayRange, type ResolvedPeriod, type SeoPeriod } from "@/lib/seo-intel/periods";
import { detectChanges, type ChangeInsight } from "@/lib/seo-intel/engine/changes";
import { changeThresholds } from "@/lib/seo-intel/thresholds";
import { thresholdsFor } from "@/lib/services/seo-intel/thresholds.service";
import type { Actor } from "@/lib/actor/types";

/**
 * The SEO read boundary for Search Console data — the functions a future AI
 * layer would call as tools (`getSEOOverview`, …), and what the screens call
 * today. Every figure is aggregated in Postgres from the stored daily tables;
 * nothing is fetched from Google on a page view, and nothing is estimated.
 *
 * Positions are re-weighted by impressions when days are combined — the only
 * correct way to average Google's averages.
 */

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

async function assertProperty(propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That SEO property does not exist.");
}

type SumRow = { clicks: bigint | number | null; impressions: bigint | number | null; weighted: number | null };

function metrics(row: SumRow | undefined): GscMetrics {
  const clicks = Number(row?.clicks ?? 0);
  const impressions = Number(row?.impressions ?? 0);
  return { clicks, impressions, position: impressions > 0 ? Number(row?.weighted ?? 0) / impressions : 0 };
}

async function latestDay(propertyId: string): Promise<string | null> {
  const latest = await db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } });
  return latest._max.date ? fromDbDate(latest._max.date) : null;
}

async function totalFor(propertyId: string, range: DayRange): Promise<GscMetrics> {
  const rows = await db.$queryRaw<SumRow[]>(Prisma.sql`
    SELECT SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
    FROM "GscDailyTotal"
    WHERE "propertyId" = ${propertyId} AND device = '' AND country = ''
      AND date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date
  `);
  return metrics(rows[0]);
}

async function dailyFor(propertyId: string, range: DayRange): Promise<Map<string, GscMetrics>> {
  const rows = await db.gscDailyTotal.findMany({
    where: { propertyId, device: "", country: "", date: { gte: toDbDate(range.start), lte: toDbDate(range.end) } },
    select: { date: true, clicks: true, impressions: true, position: true },
  });
  return new Map(rows.map((row) => [fromDbDate(row.date), { clicks: row.clicks, impressions: row.impressions, position: row.position }]));
}

const DIMENSION = {
  query: { table: Prisma.raw('"GscQueryDaily"'), column: Prisma.raw("query") },
  page: { table: Prisma.raw('"GscPageDaily"'), column: Prisma.raw("page") },
} as const;
export type GscDimensionKey = keyof typeof DIMENSION;

/** Per query or page over a range, largest first, bounded so a huge site cannot exhaust memory. */
async function byKey(propertyId: string, dimension: GscDimensionKey, range: DayRange, limit = 20_000): Promise<Map<string, GscMetrics>> {
  const { table, column } = DIMENSION[dimension];
  const rows = await db.$queryRaw<(SumRow & { key: string })[]>(Prisma.sql`
    SELECT ${column} AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
    FROM ${table}
    WHERE "propertyId" = ${propertyId} AND date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date
    GROUP BY ${column}
    ORDER BY SUM(impressions) DESC
    LIMIT ${limit}
  `);
  return new Map(rows.map((row) => [row.key, metrics(row)]));
}

async function breakdown(propertyId: string, field: "device" | "country", range: DayRange, limit: number) {
  const column = field === "device" ? Prisma.raw("device") : Prisma.raw("country");
  const other = field === "device" ? Prisma.raw("country") : Prisma.raw("device");
  const rows = await db.$queryRaw<(SumRow & { key: string })[]>(Prisma.sql`
    SELECT ${column} AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
    FROM "GscDailyTotal"
    WHERE "propertyId" = ${propertyId} AND ${column} <> '' AND ${other} = ''
      AND date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date
    GROUP BY ${column}
    ORDER BY SUM(clicks) DESC, SUM(impressions) DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({ key: row.key, ...metrics(row) }));
}

export type MetricPair = { current: number | null; previous: number | null; change: number | null };

const pair = (current: number | null, previous: number | null, relative = true): MetricPair => ({
  current,
  previous,
  change: current === null || previous === null ? null : relative ? percentChange(current, previous) : current - previous,
});

export type SeoOverview =
  | { state: "no-data" }
  | {
      state: "ready";
      period: ResolvedPeriod;
      dataThrough: string;
      kpis: { clicks: MetricPair; impressions: MetricPair; ctr: MetricPair; position: MetricPair };
      keywords: { ranking: MetricPair; top3: MetricPair; top10: MetricPair; capped: boolean };
      series: { date: string; clicks: number; impressions: number; previousClicks: number | null }[];
      topQueries: { key: string; current: GscMetrics; previous: GscMetrics | null }[];
      topPages: { key: string; current: GscMetrics; previous: GscMetrics | null }[];
      devices: { key: string; clicks: number; impressions: number; position: number }[];
      countries: { key: string; clicks: number; impressions: number; position: number }[];
      changes: ChangeInsight[];
    };

function keywordCounts(queries: Map<string, GscMetrics>) {
  let top3 = 0;
  let top10 = 0;
  for (const metrics of queries.values()) {
    if (metrics.impressions === 0) continue;
    if (metrics.position <= 3) top3++;
    if (metrics.position <= 10) top10++;
  }
  return { ranking: [...queries.values()].filter((m) => m.impressions > 0).length, top3, top10 };
}

function top(current: Map<string, GscMetrics>, previous: Map<string, GscMetrics>, n: number) {
  return [...current.entries()]
    .sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions)
    .slice(0, n)
    .map(([key, metrics]) => ({ key, current: metrics, previous: previous.get(key) ?? null }));
}

/** The Executive Overview's Search Console half. */
export async function getSEOOverview(actor: Actor, propertyId: string, periodKey: SeoPeriod): Promise<SeoOverview> {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await assertProperty(propertyId);

  const latest = await latestDay(propertyId);
  if (!latest) return { state: "no-data" };
  const period = resolvePeriod(periodKey, latest);

  const [current, previous, dailyNow, dailyBefore, queriesNow, queriesBefore, pagesNow, pagesBefore, devices, countries] = await Promise.all([
    totalFor(propertyId, period.current),
    totalFor(propertyId, period.previous),
    dailyFor(propertyId, period.current),
    dailyFor(propertyId, period.previous),
    byKey(propertyId, "query", period.current),
    byKey(propertyId, "query", period.previous),
    byKey(propertyId, "page", period.current),
    byKey(propertyId, "page", period.previous),
    breakdown(propertyId, "device", period.current, 5),
    breakdown(propertyId, "country", period.current, 10),
  ]);

  const kwNow = keywordCounts(queriesNow);
  const kwBefore = keywordCounts(queriesBefore);
  const previousDays = eachDay(period.previous.start, period.previous.end);
  const series = eachDay(period.current.start, period.current.end).map((date, index) => {
    const day = dailyNow.get(date);
    const before = previousDays[index] ? dailyBefore.get(previousDays[index] as string) : undefined;
    return { date, clicks: day?.clicks ?? 0, impressions: day?.impressions ?? 0, previousClicks: before ? before.clicks : null };
  });

  const hasPrevious = previous.impressions > 0 || dailyBefore.size > 0;

  return {
    state: "ready",
    period,
    dataThrough: latest,
    kpis: {
      clicks: pair(current.clicks, hasPrevious ? previous.clicks : null),
      impressions: pair(current.impressions, hasPrevious ? previous.impressions : null),
      ctr: pair(ctr(current), hasPrevious ? ctr(previous) : null),
      position: pair(current.impressions > 0 ? current.position : null, hasPrevious && previous.impressions > 0 ? previous.position : null, false),
    },
    keywords: {
      ranking: pair(kwNow.ranking, hasPrevious ? kwBefore.ranking : null),
      top3: pair(kwNow.top3, hasPrevious ? kwBefore.top3 : null),
      top10: pair(kwNow.top10, hasPrevious ? kwBefore.top10 : null),
      capped: queriesNow.size >= 20_000,
    },
    series,
    topQueries: top(queriesNow, queriesBefore, 10),
    topPages: top(pagesNow, pagesBefore, 10),
    devices,
    countries,
    changes: hasPrevious
      ? detectChanges({
          period,
          totals: { current, previous },
          pages: { current: pagesNow, previous: pagesBefore },
          queries: { current: queriesNow, previous: queriesBefore },
        }, changeThresholds(await thresholdsFor(propertyId)))
      : [],
  };
}

// ---------------------------------------------------------------------------
// The performance tables — server-side search, sort and pagination
// ---------------------------------------------------------------------------

export const GSC_SORTS = ["clicks", "impressions", "ctr", "position"] as const;
export type GscSort = (typeof GSC_SORTS)[number];

const SORT_SQL: Record<GscSort, Prisma.Sql> = {
  clicks: Prisma.raw("SUM(clicks) DESC, SUM(impressions) DESC"),
  impressions: Prisma.raw("SUM(impressions) DESC, SUM(clicks) DESC"),
  ctr: Prisma.raw("(SUM(clicks)::float / NULLIF(SUM(impressions), 0)) DESC NULLS LAST, SUM(impressions) DESC"),
  position: Prisma.raw("(SUM(position * impressions) / NULLIF(SUM(impressions), 0)) ASC NULLS LAST, SUM(impressions) DESC"),
};

export type GscTableRow = { key: string; current: GscMetrics; previous: GscMetrics | null };

export async function listGscRows(
  actor: Actor,
  propertyId: string,
  input: { dimension: GscDimensionKey; period: SeoPeriod; q?: string; sort: GscSort; page: number; pageSize?: number; keys?: string[] },
): Promise<{ state: "no-data" } | { state: "ready"; period: ResolvedPeriod; rows: GscTableRow[]; total: number; page: number; pages: number }> {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await assertProperty(propertyId);

  const latest = await latestDay(propertyId);
  if (!latest) return { state: "no-data" };
  const period = resolvePeriod(input.period, latest);
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 10), 200);
  const page = Math.max(1, input.page);
  const { table, column } = DIMENSION[input.dimension];

  const search = input.q ? Prisma.sql`AND ${column} ILIKE ${`%${input.q.replace(/([\\%_])/g, "\\$1")}%`} ESCAPE '\\'` : Prisma.empty;
  // An insight links to the exact entities it is about.
  const only = input.keys?.length ? Prisma.sql`AND ${column} IN (${Prisma.join(input.keys.slice(0, 50))})` : Prisma.empty;

  const rows = await db.$queryRaw<(SumRow & { key: string; total: bigint })[]>(Prisma.sql`
    SELECT ${column} AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted,
           COUNT(*) OVER () AS total
    FROM ${table}
    WHERE "propertyId" = ${propertyId}
      AND date BETWEEN ${toDbDate(period.current.start)}::date AND ${toDbDate(period.current.end)}::date
      ${search} ${only}
    GROUP BY ${column}
    ORDER BY ${SORT_SQL[input.sort]}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
  const total = Number(rows[0]?.total ?? 0);

  const previous = rows.length
    ? await db.$queryRaw<(SumRow & { key: string })[]>(Prisma.sql`
        SELECT ${column} AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
        FROM ${table}
        WHERE "propertyId" = ${propertyId}
          AND date BETWEEN ${toDbDate(period.previous.start)}::date AND ${toDbDate(period.previous.end)}::date
          AND ${column} IN (${Prisma.join(rows.map((row) => row.key))})
        GROUP BY ${column}
      `)
    : [];
  const before = new Map(previous.map((row) => [row.key, metrics(row)]));

  return {
    state: "ready",
    period,
    rows: rows.map((row) => ({ key: row.key, current: metrics(row), previous: before.get(row.key) ?? null })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
