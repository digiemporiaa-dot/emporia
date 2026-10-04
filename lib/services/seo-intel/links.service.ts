import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import { resolvePeriod } from "@/lib/seo-intel/periods";
import { normalizeUrl } from "@/lib/seo-intel/crawler/url";
import { opportunityBand } from "@/lib/seo-intel/engine/rankings";
import { thresholdsFor } from "@/lib/services/seo-intel/thresholds.service";
import { suggestLinks, type LinkTarget } from "@/lib/seo-intel/engine/links";
import type { Actor } from "@/lib/actor/types";

/**
 * Internal link suggestions (Phase 5). Built once, when a crawl finishes,
 * from that crawl's page text and the last 28 days of Search Console; the
 * page text is cleared straight afterwards by the crawl service.
 */

type SumRow = { key: string; page?: string; clicks: bigint | number | null; impressions: bigint | number | null; weighted: number | null };

/**
 * Called by the crawl service while the run's page text still exists.
 * Returns how many suggestions were stored, or null when Search Console has
 * no data for the website (so there are no target pages to choose).
 */
export async function buildLinkSuggestions(runId: string, propertyId: string): Promise<number | null> {
  const latest = await db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } });
  if (!latest._max.date) return null;
  const range = resolvePeriod("28d", fromDbDate(latest._max.date)).current;
  const minImpressions = (await thresholdsFor(propertyId))["opportunities.minImpressions"];
  const between = Prisma.sql`date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date`;

  const [pairRows, pageRows, pages, links] = await Promise.all([
    db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT query AS key, page, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscQueryPageDaily"
      WHERE "propertyId" = ${propertyId} AND ${between}
      GROUP BY query, page
      HAVING SUM(impressions) >= ${minImpressions}
      ORDER BY SUM(impressions) DESC LIMIT 5000`),
    db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT page AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, 0::float AS weighted
      FROM "GscPageDaily" WHERE "propertyId" = ${propertyId} AND ${between}
      GROUP BY page`),
    db.crawlPage.findMany({
      where: { runId, state: "FETCHED", statusCode: 200 },
      select: { id: true, url: true, indexable: true, inlinks: true, textContent: true },
    }),
    db.crawlLink.findMany({ where: { runId }, select: { toUrl: true, fromPage: { select: { url: true } } } }),
  ]);

  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const clicksByUrl = new Map<string, number>();
  for (const row of pageRows) {
    const url = normalizeUrl(row.key);
    if (url) clicksByUrl.set(url, (clicksByUrl.get(url) ?? 0) + Number(row.clicks ?? 0));
  }

  const targets: LinkTarget[] = [];
  for (const row of pairRows) {
    const impressions = Number(row.impressions ?? 0);
    const position = impressions > 0 ? Number(row.weighted ?? 0) / impressions : null;
    if (!opportunityBand(position)) continue;
    const url = row.page ? normalizeUrl(row.page) : null;
    const page = url ? byUrl.get(url) : undefined;
    if (!page || page.indexable !== true) continue;
    targets.push({ url: page.url, query: row.key, position: position as number, impressions });
  }

  const sources = pages
    .filter((page) => page.indexable === true && page.textContent)
    .map((page) => ({ url: page.url, text: page.textContent as string, clicks: clicksByUrl.get(page.url) ?? 0, inlinks: page.inlinks }));
  const linked = new Set(links.map((link) => `${link.fromPage.url}\n${link.toUrl}`));
  const suggestions = suggestLinks(targets, sources, linked);

  await db.$transaction([
    db.internalLinkSuggestion.deleteMany({ where: { runId } }),
    db.internalLinkSuggestion.createMany({
      data: suggestions.map((s) => ({
        runId,
        targetPageId: byUrl.get(s.target)!.id,
        sourcePageId: byUrl.get(s.source)!.id,
        query: s.query.slice(0, 500),
        snippet: s.snippet.slice(0, 400),
        position: s.position,
        impressions: s.impressions,
        sourceClicks: s.sourceClicks,
      })),
    }),
  ]);
  return suggestions.length;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

async function latestRun(propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That website was not found.");
  return db.crawlRun.findFirst({
    where: { propertyId, status: "SUCCEEDED" },
    orderBy: { startedAt: "desc" },
    select: { id: true, finishedAt: true, suggestionCount: true, pagesFetched: true },
  });
}

/** Suggestions from the latest finished crawl, grouped by target page, most impressions first. */
export async function listLinkSuggestions(actor: Actor, propertyId: string, params: Partial<PageParams> = {}) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const run = await latestRun(propertyId);
  const { page, perPage, skip, take } = toSkipTake(params);
  type Group = { target: string; query: string; position: number; impressions: number; sources: { url: string; snippet: string; clicks: number }[] };
  if (!run) return { run: null, list: paged([] as Group[], 0, page, perPage) };

  const rows = await db.internalLinkSuggestion.findMany({
    where: { runId: run.id },
    orderBy: [{ impressions: "desc" }, { sourceClicks: "desc" }],
    select: { query: true, snippet: true, position: true, impressions: true, sourceClicks: true, targetPage: { select: { url: true } }, sourcePage: { select: { url: true } } },
  });
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = `${row.targetPage.url}\n${row.query}`;
    let group = groups.get(key);
    if (!group) {
      group = { target: row.targetPage.url, query: row.query, position: row.position, impressions: row.impressions, sources: [] };
      groups.set(key, group);
    }
    group.sources.push({ url: row.sourcePage.url, snippet: row.snippet, clicks: row.sourceClicks });
  }
  const list = [...groups.values()];
  return { run, list: paged(list.slice(skip, skip + take), list.length, page, perPage) };
}

/** The most and least linked indexable pages in the latest crawl. */
export async function linkExtremes(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const run = await latestRun(propertyId);
  if (!run) return { most: [], least: [] };
  const where = { runId: run.id, indexable: true };
  const select = { url: true, inlinks: true, depth: true, title: true, inSitemap: true } as const;
  const [most, least] = await Promise.all([
    db.crawlPage.findMany({ where, orderBy: [{ inlinks: "desc" }, { url: "asc" }], take: 10, select }),
    db.crawlPage.findMany({ where: { ...where, depth: { not: 0 } }, orderBy: [{ inlinks: "asc" }, { url: "asc" }], take: 10, select }),
  ]);
  return { most, least };
}
