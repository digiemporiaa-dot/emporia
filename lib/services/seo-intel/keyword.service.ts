import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { record } from "@/lib/services/audit.service";
import { addDays, fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import { resolvePeriod, type DayRange } from "@/lib/seo-intel/periods";
import { rankProvider } from "@/lib/seo-intel/providers/rank";
import {
  bandOf,
  EMPTY,
  findOpportunities,
  movementOf,
  ownCtrCurve,
  parseKeywordList,
  parseTags,
  TRACKED_KEYWORDS_CAP,
  type Metrics,
  type Movement,
  type Opportunity,
  type OpportunityBand,
} from "@/lib/seo-intel/engine/rankings";
import type { Actor } from "@/lib/actor/types";

/**
 * Tracked keywords and their Search Console rankings (Phase 4).
 *
 * Nothing here copies a position: every number is read from the stored
 * Search Console tables for the period asked, so a keyword added today shows
 * all the history already held for that query.
 */

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

async function assertProperty(propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That website was not found.");
}

async function latestDay(propertyId: string): Promise<string | null> {
  const latest = await db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } });
  return latest._max.date ? fromDbDate(latest._max.date) : null;
}

type SumRow = { key: string; clicks: bigint | number | null; impressions: bigint | number | null; weighted: number | null };

function toMetrics(row: SumRow | undefined): Metrics {
  if (!row) return EMPTY;
  const clicks = Number(row.clicks ?? 0);
  const impressions = Number(row.impressions ?? 0);
  return { clicks, impressions, position: impressions > 0 ? Number(row.weighted ?? 0) / impressions : null };
}

const between = (range: DayRange) => Prisma.sql`date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date`;

async function metricsFor(propertyId: string, keywords: string[], range: DayRange): Promise<Map<string, Metrics>> {
  if (!keywords.length) return new Map();
  const rows = await db.$queryRaw<SumRow[]>(Prisma.sql`
    SELECT query AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
    FROM "GscQueryDaily"
    WHERE "propertyId" = ${propertyId} AND query = ANY(${keywords}::text[]) AND ${between(range)}
    GROUP BY query`);
  return new Map(rows.map((row) => [row.key, toMetrics(row)]));
}

/** The page that earned each query the most clicks (then impressions) in the range. */
async function rankingPages(propertyId: string, keywords: string[], range: DayRange): Promise<Map<string, string>> {
  if (!keywords.length) return new Map();
  const rows = await db.$queryRaw<{ query: string; page: string }[]>(Prisma.sql`
    SELECT DISTINCT ON (query) query, page
    FROM "GscQueryPageDaily"
    WHERE "propertyId" = ${propertyId} AND query = ANY(${keywords}::text[]) AND ${between(range)}
    GROUP BY query, page
    ORDER BY query, SUM(clicks) DESC, SUM(impressions) DESC`);
  return new Map(rows.map((row) => [row.query, row.page]));
}

/** The first day query + page pairs exist for, so screens can say how far back ranking pages go. */
async function pairsSince(propertyId: string): Promise<string | null> {
  const first = await db.gscQueryPageDaily.aggregate({ where: { propertyId }, _min: { date: true } });
  return first._min.date ? fromDbDate(first._min.date) : null;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export async function addKeywords(
  actor: Actor,
  propertyId: string,
  input: { keywords: string; tags: string; source: "MANUAL" | "SEARCH_CONSOLE" },
): Promise<{ added: number; alreadyTracked: number; rejected: string[] }> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await assertProperty(propertyId);
  const { keywords, rejected } = parseKeywordList(input.keywords);
  if (!keywords.length) throw new ValidationError(rejected.length ? "None of those can be tracked: each keyword must be 1–200 characters." : "Enter at least one keyword.");
  const tags = parseTags(input.tags);

  return db.$transaction(async (tx) => {
    // The cap is checked and filled under one lock, so two adds cannot both fit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-keywords:${propertyId}`}))`;
    const existing = await tx.seoKeyword.findMany({ where: { propertyId, keyword: { in: keywords } }, select: { keyword: true } });
    const known = new Set(existing.map((row) => row.keyword));
    const fresh = keywords.filter((keyword) => !known.has(keyword));
    const count = await tx.seoKeyword.count({ where: { propertyId } });
    if (count + fresh.length > TRACKED_KEYWORDS_CAP) {
      const room = Math.max(0, TRACKED_KEYWORDS_CAP - count);
      throw new ValidationError(
        `This website tracks ${count} of ${TRACKED_KEYWORDS_CAP} keywords, so ${room} more fit. Remove some first, or add fewer.`,
      );
    }
    if (fresh.length) {
      await tx.seoKeyword.createMany({
        data: fresh.map((keyword) => ({ propertyId, keyword, tags, source: input.source, createdById: actor.type === "STAFF" ? actor.userId : null })),
        skipDuplicates: true,
      });
      await record(
        { actor, action: "CREATE", entityType: "SeoKeyword", entityId: propertyId, after: { added: fresh.length, keywords: fresh.slice(0, 50), tags, source: input.source } },
        tx,
      );
    }
    return { added: fresh.length, alreadyTracked: known.size, rejected };
  });
}

export async function removeKeywords(actor: Actor, propertyId: string, keywordIds: string[]): Promise<number> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await assertProperty(propertyId);
  return db.$transaction(async (tx) => {
    const rows = await tx.seoKeyword.findMany({ where: { propertyId, id: { in: keywordIds } }, select: { id: true, keyword: true } });
    if (!rows.length) throw new NotFoundError("Those keywords are not tracked for this website.");
    await tx.seoKeyword.deleteMany({ where: { propertyId, id: { in: rows.map((row) => row.id) } } });
    await record({ actor, action: "DELETE", entityType: "SeoKeyword", entityId: propertyId, before: { keywords: rows.map((row) => row.keyword).slice(0, 50), count: rows.length } }, tx);
    return rows.length;
  });
}

export async function setKeywordTags(actor: Actor, propertyId: string, keywordId: string, tagText: string): Promise<string[]> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  const tags = parseTags(tagText);
  return db.$transaction(async (tx) => {
    const before = await tx.seoKeyword.findFirst({ where: { id: keywordId, propertyId, property: { client: { deletedAt: null } } }, select: { id: true, keyword: true, tags: true } });
    if (!before) throw new NotFoundError("That keyword is not tracked for this website.");
    await tx.seoKeyword.update({ where: { id: keywordId }, data: { tags } });
    await record({ actor, action: "UPDATE", entityType: "SeoKeyword", entityId: keywordId, before, after: { ...before, tags } }, tx);
    return tags;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const KEYWORD_FILTERS = ["all", "improved", "declined", "entered-top10", "left-top10", "top3", "top10", "top20", "not-ranking"] as const;
export type KeywordFilter = (typeof KEYWORD_FILTERS)[number];
export const KEYWORD_SORTS = ["position", "change", "clicks", "impressions", "keyword"] as const;
export type KeywordSort = (typeof KEYWORD_SORTS)[number];
export const KEYWORD_PERIODS = ["7d", "28d"] as const;
export type KeywordPeriod = (typeof KEYWORD_PERIODS)[number];

export type KeywordRow = {
  id: string;
  keyword: string;
  tags: string[];
  source: "MANUAL" | "SEARCH_CONSOLE";
  current: Metrics;
  previous: Metrics;
  movement: Movement;
  page: string | null;
};

function matches(row: KeywordRow, filter: KeywordFilter): boolean {
  const band = bandOf(row.current.impressions > 0 ? row.current.position : null);
  switch (filter) {
    case "all": return true;
    case "improved": return row.movement.status === "improved";
    case "declined": return row.movement.status === "declined" || row.movement.status === "lost";
    case "entered-top10": return row.movement.entered === "top3" || row.movement.entered === "top10";
    case "left-top10": return row.movement.left === "top3" || row.movement.left === "top10";
    case "top3": return band === "top3";
    case "top10": return band === "top3" || band === "top10";
    case "top20": return band !== "beyond" && band !== "none";
    case "not-ranking": return band === "none";
  }
}

function compare(sort: KeywordSort) {
  const pos = (row: KeywordRow) => (row.current.impressions > 0 && row.current.position !== null ? row.current.position : Number.POSITIVE_INFINITY);
  return (a: KeywordRow, b: KeywordRow): number => {
    switch (sort) {
      case "position": return pos(a) - pos(b) || a.keyword.localeCompare(b.keyword);
      case "change": return (b.movement.change ?? Number.NEGATIVE_INFINITY) - (a.movement.change ?? Number.NEGATIVE_INFINITY) || a.keyword.localeCompare(b.keyword);
      case "clicks": return b.current.clicks - a.current.clicks || b.current.impressions - a.current.impressions;
      case "impressions": return b.current.impressions - a.current.impressions || b.current.clicks - a.current.clicks;
      case "keyword": return a.keyword.localeCompare(b.keyword);
    }
  };
}

/** Tracked keywords with this period's ranking, the change, and the page that ranks. At most 500, so filtered in memory. */
export async function listKeywords(
  actor: Actor,
  propertyId: string,
  params: Partial<PageParams> & { period?: KeywordPeriod; filter?: KeywordFilter; tag?: string; q?: string; sort?: KeywordSort } = {},
) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await assertProperty(propertyId);
  const tracked = await db.seoKeyword.findMany({ where: { propertyId }, orderBy: { keyword: "asc" }, select: { id: true, keyword: true, tags: true, source: true } });
  const latest = await latestDay(propertyId);
  const period = latest ? resolvePeriod(params.period ?? "28d", latest) : null;
  const words = tracked.map((row) => row.keyword);
  const [current, previous, pages, since] = period
    ? await Promise.all([metricsFor(propertyId, words, period.current), metricsFor(propertyId, words, period.previous), rankingPages(propertyId, words, period.current), pairsSince(propertyId)])
    : [new Map<string, Metrics>(), new Map<string, Metrics>(), new Map<string, string>(), null];

  const all: KeywordRow[] = tracked.map((row) => {
    const now = current.get(row.keyword) ?? EMPTY;
    const before = previous.get(row.keyword) ?? EMPTY;
    return { ...row, current: now, previous: before, movement: movementOf(now, before), page: pages.get(row.keyword) ?? null };
  });

  const counts = Object.fromEntries(KEYWORD_FILTERS.map((filter) => [filter, all.filter((row) => matches(row, filter)).length])) as Record<KeywordFilter, number>;
  const tags = [...new Set(tracked.flatMap((row) => row.tags))].sort();
  const q = params.q?.trim().toLowerCase();
  const filtered = all
    .filter((row) => matches(row, params.filter ?? "all"))
    .filter((row) => (params.tag ? row.tags.includes(params.tag) : true))
    .filter((row) => (q ? row.keyword.includes(q) : true))
    .sort(compare(params.sort ?? "position"));
  const { page, perPage, skip, take } = toSkipTake(params);

  return {
    hasData: !!period,
    period,
    pairsSince: since,
    tracked: tracked.length,
    cap: TRACKED_KEYWORDS_CAP,
    counts,
    tags,
    rankProvider: rankProvider()?.name ?? null,
    list: paged(filtered.slice(skip, skip + take), filtered.length, page, perPage),
  };
}

/** One keyword: daily positions for the last 90 days held, and the pages ranking for it. */
export async function keywordDetail(actor: Actor, propertyId: string, keywordId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const keyword = await db.seoKeyword.findFirst({
    where: { id: keywordId, propertyId, property: { client: { deletedAt: null } } },
    select: { id: true, keyword: true, tags: true, source: true, createdAt: true, createdBy: { select: { name: true } } },
  });
  if (!keyword) throw new NotFoundError("That keyword is not tracked for this website.");
  const latest = await latestDay(propertyId);
  if (!latest) return { keyword, hasData: false as const };

  const period = resolvePeriod("28d", latest);
  const seriesRange = { start: addDays(latest, -89), end: latest };
  const [daily, current, previous, pages, since] = await Promise.all([
    db.gscQueryDaily.findMany({
      where: { propertyId, query: keyword.keyword, date: { gte: toDbDate(seriesRange.start), lte: toDbDate(seriesRange.end) } },
      orderBy: { date: "asc" },
      select: { date: true, clicks: true, impressions: true, position: true },
    }),
    metricsFor(propertyId, [keyword.keyword], period.current),
    metricsFor(propertyId, [keyword.keyword], period.previous),
    db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT page AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscQueryPageDaily"
      WHERE "propertyId" = ${propertyId} AND query = ${keyword.keyword} AND ${between(period.current)}
      GROUP BY page
      ORDER BY SUM(clicks) DESC, SUM(impressions) DESC
      LIMIT 10`),
    pairsSince(propertyId),
  ]);
  const now = current.get(keyword.keyword) ?? EMPTY;
  const before = previous.get(keyword.keyword) ?? EMPTY;
  return {
    keyword,
    hasData: true as const,
    period,
    seriesRange,
    series: daily.map((row) => ({ date: fromDbDate(row.date), clicks: row.clicks, impressions: row.impressions, position: row.position })),
    current: now,
    previous: before,
    movement: movementOf(now, before),
    pages: pages.map((row) => ({ page: row.key, ...toMetrics(row) })),
    pairsSince: since,
    rankProvider: rankProvider()?.name ?? null,
  };
}

/** Search Console queries from the last 28 days not yet tracked, most impressions first. Paged in the database. */
export async function keywordSuggestions(actor: Actor, propertyId: string, params: Partial<PageParams> & { q?: string } = {}) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await assertProperty(propertyId);
  const latest = await latestDay(propertyId);
  const { page, perPage, skip, take } = toSkipTake(params);
  if (!latest) return { hasData: false, list: paged([] as (Metrics & { query: string })[], 0, page, perPage) };
  const range = resolvePeriod("28d", latest).current;
  const q = params.q?.trim().toLowerCase();
  const search = q ? Prisma.sql`AND g.query LIKE ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : Prisma.empty;
  const where = Prisma.sql`
    g."propertyId" = ${propertyId} AND ${between(range)} ${search}
    AND NOT EXISTS (SELECT 1 FROM "SeoKeyword" k WHERE k."propertyId" = g."propertyId" AND k.keyword = g.query)`;
  const [rows, total] = await Promise.all([
    db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT g.query AS key, SUM(g.clicks) AS clicks, SUM(g.impressions) AS impressions, SUM(g.position * g.impressions) AS weighted
      FROM "GscQueryDaily" g WHERE ${where}
      GROUP BY g.query
      ORDER BY SUM(g.impressions) DESC, g.query
      LIMIT ${take} OFFSET ${skip}`),
    db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(DISTINCT g.query) AS n FROM "GscQueryDaily" g WHERE ${where}`),
  ]);
  return {
    hasData: true,
    range,
    list: paged(rows.map((row) => ({ query: row.key, ...toMetrics(row) })), Number(total[0]?.n ?? 0), page, perPage),
  };
}

const OPPORTUNITY_POOL = 20_000;

/**
 * Queries ranking 4–20 over the last 28 days with enough impressions, with an
 * estimate of the extra clicks from reaching the band's target position at
 * this website's own click-through rate. Tracked or not.
 */
export async function keywordOpportunities(
  actor: Actor,
  propertyId: string,
  params: Partial<PageParams> & { band?: OpportunityBand; trackedOnly?: boolean } = {},
) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await assertProperty(propertyId);
  const latest = await latestDay(propertyId);
  const { page, perPage, skip, take } = toSkipTake(params);
  type Row = Opportunity & { trackedId: string | null };
  if (!latest) return { hasData: false as const, curve: [] as (number | null)[], counts: { "near-top": 0, "page-two": 0 }, list: paged([] as Row[], 0, page, perPage) };

  const range = resolvePeriod("28d", latest).current;
  const [rows, tracked] = await Promise.all([
    db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT query AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscQueryDaily"
      WHERE "propertyId" = ${propertyId} AND ${between(range)}
      GROUP BY query
      ORDER BY SUM(impressions) DESC
      LIMIT ${OPPORTUNITY_POOL}`),
    db.seoKeyword.findMany({ where: { propertyId }, select: { id: true, keyword: true } }),
  ]);
  const inputs = rows
    .map((row) => ({ query: row.key, ...toMetrics(row) }))
    .filter((row): row is { query: string; clicks: number; impressions: number; position: number } => row.position !== null);
  const curve = ownCtrCurve(inputs);
  const trackedIds = new Map(tracked.map((row) => [row.keyword, row.id]));
  const all: Row[] = findOpportunities(inputs, curve).map((row) => ({ ...row, trackedId: trackedIds.get(row.query) ?? null }));
  const counts = { "near-top": all.filter((row) => row.band === "near-top").length, "page-two": all.filter((row) => row.band === "page-two").length };
  const filtered = all.filter((row) => (params.band ? row.band === params.band : true)).filter((row) => (params.trackedOnly ? row.trackedId !== null : true));
  return { hasData: true as const, range, curve, counts, list: paged(filtered.slice(skip, skip + take), filtered.length, page, perPage) };
}
