import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { log } from "@/lib/logger";
import { withAudit } from "@/lib/services/audit.service";
import { searchConsoleFor } from "@/lib/services/seo-intel/gsc-connection.service";
import { INSPECTIONS_PER_DAY } from "@/lib/seo-intel/providers/gsc";
import { SeoAccessError, SeoCredentialsError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";
import { bucketOf, conflictsOf, normalizeInspection, pickInspectionSample, type Conflict, type IndexBucket } from "@/lib/seo-intel/engine/indexation";
import type { UrlInspectionProvider } from "@/lib/seo-intel/providers/types";
import type { Actor } from "@/lib/actor/types";

/**
 * Indexation: Google's own status for a website's URLs, from Search Console's
 * URL Inspection API, set beside the latest crawl.
 *
 * Google allows 2,000 inspections a day per site and the Page-indexing report
 * is not in the API, so this inspects a prioritised, rotating sample —
 * sitemap URLs first — within INSPECTIONS_PER_DAY, and the screen says how
 * many URLs have been inspected rather than implying full coverage.
 */

const iLog = log("seo-indexation");
const PER_RUN = 20;
const DAY_MS = 86_400_000;

/** The latest finished crawl's fetchable HTML pages: the URLs worth asking Google about. */
async function crawlCandidates(propertyId: string) {
  const run = await db.crawlRun.findFirst({
    where: { propertyId, status: "SUCCEEDED" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!run) return { runId: null, pages: [] };
  const pages = await db.crawlPage.findMany({
    where: { runId: run.id, state: "FETCHED", statusCode: 200, contentType: { contains: "html", mode: "insensitive" } },
    select: { url: true, inSitemap: true, indexable: true },
  });
  return { runId: run.id, pages: pages.map((page) => ({ url: page.url, inSitemap: page.inSitemap, indexable: page.indexable === true })) };
}

async function usedToday(propertyId: string, now: Date): Promise<number> {
  return db.urlInspection.count({ where: { propertyId, inspectedAt: { gte: new Date(now.getTime() - DAY_MS) } } });
}

async function storeInspection(propertyId: string, url: string, provider: UrlInspectionProvider, siteUrl: string, now: Date) {
  try {
    const result = normalizeInspection(await provider.inspect({ siteUrl, url }));
    const data = { ...result, error: null, inspectedAt: now };
    await db.urlInspection.upsert({
      where: { propertyId_url: { propertyId, url } },
      create: { propertyId, url, ...data },
      update: data,
    });
    return result;
  } catch (error) {
    // Connection-level problems stop the batch; the sync reports them on the connection.
    if (error instanceof SeoRateLimitError || error instanceof SeoCredentialsError || error instanceof SeoAccessError) throw error;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    const data = {
      verdict: null, coverageState: null, indexingState: null, robotsTxtState: null, pageFetchState: null,
      googleCanonical: null, userCanonical: null, lastCrawlTime: null, crawledAs: null, sitemaps: [],
      error: message, inspectedAt: now,
    };
    await db.urlInspection.upsert({
      where: { propertyId_url: { propertyId, url } },
      create: { propertyId, url, ...data },
      update: data,
    });
    return null;
  }
}

type InspectOptions = { now?: Date; perRun?: number; limit?: number; provider?: (connection: { id: string; method: "OAUTH" | "SERVICE_ACCOUNT" }) => UrlInspectionProvider };

/** The scheduler's share: a few inspections for a couple of websites per run. */
export async function inspectDueUrls(options: InspectOptions = {}): Promise<{ inspected: number; properties: number }> {
  const now = options.now ?? new Date();
  const connections = await db.seoConnection.findMany({
    where: {
      source: "SEARCH_CONSOLE",
      status: "CONNECTED",
      externalId: { not: null },
      property: { isActive: true, client: { deletedAt: null }, crawlRuns: { some: { status: "SUCCEEDED" } } },
    },
    select: { id: true, method: true, externalId: true, propertyId: true },
    orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } },
  });

  let inspected = 0;
  let properties = 0;
  for (const connection of connections) {
    if (properties >= (options.limit ?? 2)) break;
    const budget = Math.min(options.perRun ?? PER_RUN, INSPECTIONS_PER_DAY - (await usedToday(connection.propertyId, now)));
    if (budget <= 0) continue;

    const { pages } = await crawlCandidates(connection.propertyId);
    const existing = await db.urlInspection.findMany({ where: { propertyId: connection.propertyId }, select: { url: true, inspectedAt: true } });
    const sample = pickInspectionSample(pages, new Map(existing.map((row) => [row.url, row.inspectedAt])), budget, now);
    if (!sample.length) continue;

    properties += 1;
    const provider = (options.provider ?? searchConsoleFor)(connection);
    for (const url of sample) {
      try {
        await storeInspection(connection.propertyId, url, provider, connection.externalId as string, now);
        inspected += 1;
      } catch (error) {
        iLog.warn({ err: error, propertyId: connection.propertyId }, "URL inspection stopped for this website");
        break;
      }
    }
  }
  return { inspected, properties };
}

/** Staff asking about one URL now. It must be a URL the latest crawl fetched. */
export async function inspectUrlNow(actor: Actor, propertyId: string, url: string, options: Pick<InspectOptions, "provider" | "now"> = {}) {
  requirePermission(actor, "seo.intelligence.manage");
  const now = options.now ?? new Date();
  const connection = await db.seoConnection.findFirst({
    where: { propertyId, source: "SEARCH_CONSOLE", status: "CONNECTED", externalId: { not: null }, property: { client: { deletedAt: null } } },
    select: { id: true, method: true, externalId: true },
  });
  if (!connection) throw new ValidationError("Connect Search Console for this website first.");
  const { pages } = await crawlCandidates(propertyId);
  if (!pages.some((page) => page.url === url)) throw new NotFoundError("Only pages found by the latest crawl can be inspected.");
  if ((await usedToday(propertyId, now)) >= INSPECTIONS_PER_DAY) {
    throw new ValidationError(`Today's ${INSPECTIONS_PER_DAY} inspections for this website are used. Try again tomorrow.`);
  }
  const provider = (options.provider ?? searchConsoleFor)(connection);
  return withAudit({ actor, action: "UPDATE", entityType: "UrlInspection", entityId: propertyId, after: { url } }, async () => {
    try {
      return await storeInspection(propertyId, url, provider, connection.externalId as string, now);
    } catch (error) {
      if (error instanceof SeoRateLimitError) throw new ValidationError("Google is limiting requests right now. Try again in a minute.");
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type IndexationRow = {
  url: string;
  inSitemap: boolean;
  indexable: boolean;
  bucket: IndexBucket;
  conflicts: Conflict[];
  coverageState: string | null;
  googleCanonical: string | null;
  lastCrawlTime: Date | null;
  inspectedAt: Date | null;
  error: string | null;
};

async function assertProperty(propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That website was not found.");
}

async function joinedRows(propertyId: string): Promise<{ runId: string | null; rows: IndexationRow[] }> {
  const { runId, pages } = await crawlCandidates(propertyId);
  const inspections = await db.urlInspection.findMany({
    where: { propertyId, url: { in: pages.map((page) => page.url) } },
    select: { url: true, verdict: true, coverageState: true, googleCanonical: true, userCanonical: true, lastCrawlTime: true, inspectedAt: true, error: true },
  });
  const byUrl = new Map(inspections.map((row) => [row.url, row]));
  return {
    runId,
    rows: pages.map((page) => {
      const inspection = byUrl.get(page.url) ?? null;
      return {
        url: page.url,
        inSitemap: page.inSitemap,
        indexable: page.indexable,
        bucket: bucketOf(inspection),
        conflicts: conflictsOf({ indexable: page.indexable }, inspection),
        coverageState: inspection?.coverageState ?? null,
        googleCanonical: inspection?.googleCanonical ?? null,
        lastCrawlTime: inspection?.lastCrawlTime ?? null,
        inspectedAt: inspection?.inspectedAt ?? null,
        error: inspection?.error ?? null,
      };
    }),
  };
}

/** Counts for the screen. Bounded by the crawl's page limit, so computed in memory. */
export async function indexationOverview(actor: Actor, propertyId: string, now = new Date()) {
  requirePermission(actor, "seo.intelligence.view");
  await assertProperty(propertyId);
  const [{ runId, rows }, connection, used, run] = await Promise.all([
    joinedRows(propertyId),
    db.seoConnection.findFirst({ where: { propertyId, source: "SEARCH_CONSOLE" }, select: { status: true, externalId: true } }),
    usedToday(propertyId, now),
    db.crawlRun.findFirst({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { sitemapUrls: true, finishedAt: true } }),
  ]);
  const buckets: Record<IndexBucket, number> = { indexed: 0, "not-indexed": 0, "unknown-to-google": 0, error: 0, "not-inspected": 0 };
  const conflicts: Record<Conflict, number> = { "indexable-not-indexed": 0, "not-indexable-but-indexed": 0, "canonical-mismatch": 0 };
  const coverage = new Map<string, number>();
  for (const row of rows) {
    buckets[row.bucket] += 1;
    for (const conflict of row.conflicts) conflicts[conflict] += 1;
    if (row.coverageState) coverage.set(row.coverageState, (coverage.get(row.coverageState) ?? 0) + 1);
  }
  return {
    hasCrawl: !!runId,
    crawledAt: run?.finishedAt ?? null,
    connected: connection?.status === "CONNECTED" && !!connection.externalId,
    sitemapUrls: run?.sitemapUrls ?? 0,
    pages: rows.length,
    inSitemap: rows.filter((row) => row.inSitemap).length,
    indexable: rows.filter((row) => row.indexable).length,
    inspected: rows.length - buckets["not-inspected"],
    usedToday: used,
    dailyLimit: INSPECTIONS_PER_DAY,
    buckets,
    conflicts,
    coverage: [...coverage.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
  };
}

export async function listIndexation(
  actor: Actor,
  propertyId: string,
  params: Partial<PageParams> & { bucket?: IndexBucket; conflict?: Conflict; q?: string } = {},
) {
  requirePermission(actor, "seo.intelligence.view");
  await assertProperty(propertyId);
  const { page, perPage, skip, take } = toSkipTake(params);
  const q = params.q?.trim().toLowerCase();
  const filtered = (await joinedRows(propertyId)).rows
    .filter((row) => (params.bucket ? row.bucket === params.bucket : true))
    .filter((row) => (params.conflict ? row.conflicts.includes(params.conflict) : true))
    .filter((row) => (q ? row.url.toLowerCase().includes(q) : true))
    .sort((a, b) => b.conflicts.length - a.conflicts.length || a.url.localeCompare(b.url));
  return paged(filtered.slice(skip, skip + take), filtered.length, page, perPage);
}

