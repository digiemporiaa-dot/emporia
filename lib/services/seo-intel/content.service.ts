import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { addDays, fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import type { DayRange } from "@/lib/seo-intel/periods";
import { normalizeUrl } from "@/lib/seo-intel/crawler/url";
import { ownCtrCurve } from "@/lib/seo-intel/engine/rankings";
import {
  byImpact,
  cannibalisation,
  decaying,
  highPotential,
  lowCtr,
  needsRefresh,
  type Block,
  type ContentType,
  type CrawlFacts,
  type Finding,
  type PageBlocks,
  type Pair,
} from "@/lib/seo-intel/engine/content";
import { thresholdsFor } from "@/lib/services/seo-intel/thresholds.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Content intelligence (Phase 5): decaying pages, refresh candidates, low CTR,
 * high-potential pages and possible cannibalisation, computed on read from the
 * stored Search Console tables and the latest finished crawl.
 */

export const CONTENT_TYPES = ["decaying", "refresh", "low-ctr", "potential", "cannibalisation"] as const satisfies readonly ContentType[];

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

type SumRow = { key: string; clicks: bigint | number | null; impressions: bigint | number | null; weighted: number | null };
const toBlock = (row: SumRow | undefined): Block => {
  const clicks = Number(row?.clicks ?? 0);
  const impressions = Number(row?.impressions ?? 0);
  return { clicks, impressions, position: impressions > 0 ? Number(row?.weighted ?? 0) / impressions : null };
};
const between = (range: DayRange) => Prisma.sql`date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date`;

const PAIR_POOL = 50_000;
const QUERY_POOL = 20_000;

/** The three 28-day blocks ending on the latest day with data, oldest first. */
export function contentBlocks(latest: string): [DayRange, DayRange, DayRange] {
  return [
    { start: addDays(latest, -83), end: addDays(latest, -56) },
    { start: addDays(latest, -55), end: addDays(latest, -28) },
    { start: addDays(latest, -27), end: latest },
  ];
}

async function latestDay(propertyId: string): Promise<string | null> {
  const latest = await db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } });
  return latest._max.date ? fromDbDate(latest._max.date) : null;
}

/** Latest finished crawl's facts per normalised URL, so Search Console pages can show their title and description. */
async function crawlFacts(propertyId: string) {
  const run = await db.crawlRun.findFirst({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { id: true, finishedAt: true } });
  if (!run) return { crawledAt: null, lookup: (): CrawlFacts | null => null };
  const pages = await db.crawlPage.findMany({
    where: { runId: run.id, state: "FETCHED", statusCode: 200 },
    select: { url: true, title: true, description: true, indexable: true },
  });
  const byUrl = new Map(pages.map((page) => [page.url, { title: page.title, description: page.description, indexable: page.indexable }]));
  return {
    crawledAt: run.finishedAt,
    lookup: (url: string): CrawlFacts | null => byUrl.get(normalizeUrl(url) ?? url) ?? null,
  };
}

/** All five finding types for a website, with its thresholds. Shared by the screen and the opportunity detector. */
export async function computeContentFindings(propertyId: string) {
  const latest = await latestDay(propertyId);
  if (!latest) return null;
  const t = await thresholdsFor(propertyId);
  const blocks = contentBlocks(latest);
  const full = { start: blocks[0].start, end: blocks[2].end };

  const [pageRows, queryRows, pairRows, crawl, pairsSince] = await Promise.all([
    db.$queryRaw<(SumRow & { block: number })[]>(Prisma.sql`
      SELECT page AS key,
        CASE WHEN date >= ${toDbDate(blocks[2].start)}::date THEN 2 WHEN date >= ${toDbDate(blocks[1].start)}::date THEN 1 ELSE 0 END AS block,
        SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscPageDaily"
      WHERE "propertyId" = ${propertyId} AND ${between(full)}
      GROUP BY page, block`),
    db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT query AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscQueryDaily"
      WHERE "propertyId" = ${propertyId} AND ${between(blocks[2])}
      GROUP BY query ORDER BY SUM(impressions) DESC LIMIT ${QUERY_POOL}`),
    db.$queryRaw<(SumRow & { page: string })[]>(Prisma.sql`
      SELECT query AS key, page, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscQueryPageDaily"
      WHERE "propertyId" = ${propertyId} AND ${between(blocks[2])}
      GROUP BY query, page ORDER BY SUM(impressions) DESC LIMIT ${PAIR_POOL}`),
    crawlFacts(propertyId),
    db.gscQueryPageDaily.aggregate({ where: { propertyId }, _min: { date: true } }),
  ]);

  const pages = new Map<string, PageBlocks>();
  for (const row of pageRows) {
    let entry = pages.get(row.key);
    if (!entry) {
      entry = { url: row.key, blocks: [toBlock(undefined), toBlock(undefined), toBlock(undefined)] };
      pages.set(row.key, entry);
    }
    entry.blocks[Number(row.block) as 0 | 1 | 2] = toBlock(row);
  }
  const pageList = [...pages.values()];
  const curve = ownCtrCurve(
    queryRows.map((row) => toBlock(row)).filter((row): row is Block & { position: number } => row.position !== null).map((row) => ({ position: row.position, clicks: row.clicks, impressions: row.impressions })),
    t["curve.minImpressions"],
  );
  const pairs: Pair[] = pairRows
    .map((row) => ({ query: row.key, page: row.page, ...toBlock(row) }))
    .filter((row): row is Pair => row.position !== null);

  const findings: Record<ContentType, Finding[]> = {
    decaying: byImpact(decaying(pageList, crawl.lookup, t)),
    refresh: byImpact(needsRefresh(pageList, crawl.lookup, t)),
    "low-ctr": byImpact(lowCtr(pageList, curve, crawl.lookup, t)),
    potential: byImpact(highPotential(pairs, curve, crawl.lookup)),
    cannibalisation: byImpact(cannibalisation(pairs, t)),
  };
  return {
    latest,
    blocks,
    findings,
    crawledAt: crawl.crawledAt,
    pairsSince: pairsSince._min.date ? fromDbDate(pairsSince._min.date) : null,
    thresholds: t,
  };
}

export async function contentFindings(actor: Actor, propertyId: string, params: Partial<PageParams> & { type?: ContentType } = {}) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That website was not found.");

  const { page, perPage, skip, take } = toSkipTake(params);
  const type = params.type ?? "decaying";
  const result = await computeContentFindings(propertyId);
  if (!result) return { hasData: false as const, type, counts: Object.fromEntries(CONTENT_TYPES.map((t) => [t, 0])) as Record<ContentType, number>, list: paged([] as Finding[], 0, page, perPage) };

  const counts = Object.fromEntries(CONTENT_TYPES.map((t) => [t, result.findings[t].length])) as Record<ContentType, number>;
  const rows = result.findings[type];
  const earliest = await db.gscPageDaily.aggregate({ where: { propertyId }, _min: { date: true } });
  return {
    hasData: true as const,
    type,
    counts,
    blocks: result.blocks,
    crawledAt: result.crawledAt,
    pairsSince: result.pairsSince,
    thresholds: result.thresholds,
    /** Whether the oldest block is fully covered by stored history; decay and refresh need it. */
    historyComplete: !!earliest._min.date && fromDbDate(earliest._min.date) <= result.blocks[0].start,
    list: paged(rows.slice(skip, skip + take), rows.length, page, perPage),
  };
}
