import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withAudit } from "@/lib/services/audit.service";
import { systemActor, type Actor } from "@/lib/actor/types";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { log } from "@/lib/logger";
import { propertyOrigin } from "@/lib/services/seo-intel/property.service";
import { UnsafeTargetError } from "@/lib/seo-intel/net/safe-url";
import { CRAWLER_USER_AGENT, fetchFollowing, safeFetch, type FetchOptions } from "@/lib/seo-intel/crawler/fetch";
import { EMPTY_ROBOTS, isAllowed, parseRobots, type Robots } from "@/lib/seo-intel/crawler/robots";
import { parseSitemap } from "@/lib/seo-intel/crawler/sitemap";
import { hasNoindex, parsePage } from "@/lib/seo-intel/crawler/parse";
import { isLikelyNonHtml, isOnSite, normalizeUrl, robotsPath, siteHosts } from "@/lib/seo-intel/crawler/url";
import { summarize, technicalFindings, type RulePage } from "@/lib/seo-intel/engine/technical";
import type { CrawlIssueSeverity, CrawlPageSource } from "@/generated/prisma/enums";

/**
 * Crawls, run a chunk at a time from the scheduler.
 *
 * There is no worker process, so a crawl is a queue in the database
 * (`CrawlPage` rows in state QUEUED) that each scheduler run works on for a
 * bounded time under a lease. Two pages are fetched at once — enough to make
 * progress, gentle on a client's server. When the queue is empty the crawl is
 * analysed and only the last few crawls per website are kept.
 */

const cLog = log("seo-crawl");

export const CRAWL_MAX_PAGES_CAP = 5_000;
export const KEEP_CRAWLS = 5;
const CHUNK_PAGES = 60;
const CHUNK_BUDGET_MS = 30_000;
const LEASE_MS = 2 * 60_000;
const CONCURRENCY = 2;
const MAX_RUN_AGE_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const MAX_SITEMAP_FILES = 20;
const MAX_SITEMAP_URLS = 50_000;

export type CrawlWorkOptions = {
  now?: Date;
  fetch?: FetchOptions;
  chunkPages?: number;
  budgetMs?: number;
};

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

type CrawlableProperty = {
  id: string;
  domain: string;
  protocol: "HTTPS" | "HTTP";
  crawlMaxPages: number;
  crawlFrequency: "MANUAL" | "WEEKLY";
};

async function createRun(property: CrawlableProperty, trigger: "MANUAL" | "SCHEDULED", actor: Actor, now: Date) {
  const startUrl = `${propertyOrigin(property)}/`;
  return withAudit(
    { actor, action: "CREATE", entityType: "CrawlRun", entityId: property.id },
    async (tx) => {
      // One crawl per website at a time, decided under a lock so two clicks
      // (or a click and the scheduler) cannot both start one.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-crawl:${property.id}`}))`;
      const running = await tx.crawlRun.findFirst({ where: { propertyId: property.id, status: "RUNNING" }, select: { id: true } });
      if (running) throw new ConflictError("A crawl of this website is already running.");

      const run = await tx.crawlRun.create({
        data: {
          propertyId: property.id,
          trigger,
          startUrl,
          maxPages: Math.min(property.crawlMaxPages, CRAWL_MAX_PAGES_CAP),
          startedById: actor.type === "STAFF" ? actor.userId : null,
          pages: { create: { url: startUrl, depth: 0, source: "START" } },
        },
        select: { id: true, startUrl: true, maxPages: true, trigger: true },
      });
      await tx.seoProperty.update({
        where: { id: property.id },
        data: { nextCrawlAt: property.crawlFrequency === "WEEKLY" ? new Date(now.getTime() + WEEK_MS) : null },
      });
      return run;
    },
  );
}

const CRAWLABLE_SELECT = { id: true, domain: true, protocol: true, crawlMaxPages: true, crawlFrequency: true, isActive: true } as const;

/** Staff pressing "Crawl now". */
export async function startCrawl(actor: Actor, propertyId: string, now = new Date()) {
  requirePermission(actor, "seo.intelligence.manage");
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: CRAWLABLE_SELECT,
  });
  if (!property) throw new NotFoundError("That website was not found.");
  if (!property.isActive) throw new ValidationError("This website is paused. Resume it before crawling.");
  return createRun(property, "MANUAL", actor, now);
}

/** The weekly schedule: start crawls that are due, a couple per scheduler run. */
export async function startDueCrawls(options: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const due = await db.seoProperty.findMany({
    where: {
      isActive: true,
      crawlFrequency: "WEEKLY",
      client: { deletedAt: null },
      OR: [{ nextCrawlAt: null }, { nextCrawlAt: { lte: now } }],
      crawlRuns: { none: { status: "RUNNING" } },
    },
    select: CRAWLABLE_SELECT,
    orderBy: [{ nextCrawlAt: { sort: "asc", nulls: "first" } }],
    take: options.limit ?? 2,
  });
  let started = 0;
  for (const property of due) {
    try {
      await createRun(property, "SCHEDULED", systemActor(), now);
      started += 1;
    } catch (error) {
      if (!(error instanceof ConflictError)) cLog.error({ err: error, propertyId: property.id }, "could not start a scheduled crawl");
    }
  }
  return started;
}

export async function cancelCrawl(actor: Actor, runId: string, now = new Date()) {
  requirePermission(actor, "seo.intelligence.manage");
  const run = await db.crawlRun.findFirst({
    where: { id: runId, property: { client: { deletedAt: null } } },
    select: { id: true, status: true },
  });
  if (!run) throw new NotFoundError("That crawl was not found.");
  if (run.status !== "RUNNING") throw new ConflictError("That crawl has already finished.");
  await withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "CrawlRun", entityId: run.id, before: { status: run.status } },
    (tx) =>
      tx.crawlRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: { status: "CANCELLED", finishedAt: now, lockedUntil: null },
      }).then(() => ({ status: "CANCELLED" })),
  );
}

// ---------------------------------------------------------------------------
// Working
// ---------------------------------------------------------------------------

/** Runs `fn` calls one after another, so queue size checks cannot race. */
function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => undefined);
    return next;
  };
}

type WorkRun = { id: string; propertyId: string; startUrl: string; maxPages: number; robotsTxt: string | null; robotsFound: boolean | null; domain: string };
type QueuedPage = { id: string; url: string; depth: number };

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** robots.txt and the sitemaps, read once at the start of a crawl. */
async function prepare(run: WorkRun, hosts: Set<string>, fetchOptions: FetchOptions): Promise<Robots> {
  const origin = new URL(run.startUrl).origin;
  const onSite = (url: string) => isOnSite(url, hosts);

  let robotsTxt: string | null = null;
  let robotsFound = false;
  try {
    const response = await fetchFollowing(`${origin}/robots.txt`, { ...fetchOptions, accept: "text/plain", maxBytes: 500_000, allowed: onSite });
    if (response.status === 200) {
      robotsFound = true;
      robotsTxt = response.body.toString("utf8").slice(0, 100_000);
    }
  } catch (error) {
    // The site itself is unreachable or unsafe: there is nothing to crawl.
    if (error instanceof UnsafeTargetError) throw error;
  }
  const robots = robotsTxt ? parseRobots(robotsTxt) : EMPTY_ROBOTS;

  const declared = robots.sitemaps.map((url) => normalizeUrl(url)).filter((url): url is string => !!url && onSite(url));
  const queue = declared.length ? [...new Set(declared)] : [`${origin}/sitemap.xml`];
  const read: string[] = [];
  const urls = new Set<string>();
  let total = 0;
  while (queue.length && read.length < MAX_SITEMAP_FILES) {
    const sitemapUrl = queue.shift() as string;
    if (read.includes(sitemapUrl)) continue;
    read.push(sitemapUrl);
    try {
      const response = await fetchFollowing(sitemapUrl, { ...fetchOptions, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", maxBytes: 10_000_000, allowed: onSite });
      if (response.status !== 200 || response.truncated) continue;
      const parsed = parseSitemap(response.body.toString("utf8"), MAX_SITEMAP_URLS);
      for (const nested of parsed.sitemaps) {
        const url = normalizeUrl(nested, sitemapUrl);
        if (url && onSite(url)) queue.push(url);
      }
      for (const loc of parsed.urls) {
        const url = normalizeUrl(loc, sitemapUrl);
        if (!url || !onSite(url) || isLikelyNonHtml(url)) continue;
        total += 1;
        if (urls.size < MAX_SITEMAP_URLS) urls.add(url);
      }
    } catch (error) {
      if (error instanceof UnsafeTargetError) throw error;
    }
  }

  const room = Math.max(0, run.maxPages - 1);
  const listed = [...urls];
  await db.$transaction([
    db.crawlPage.createMany({
      data: listed.slice(0, room).map((url) => ({ runId: run.id, url, depth: -1, source: "SITEMAP" as CrawlPageSource, inSitemap: true })),
      skipDuplicates: true,
    }),
    db.crawlPage.updateMany({ where: { runId: run.id, url: { in: listed.slice(0, room + 1) } }, data: { inSitemap: true } }),
    db.crawlRun.update({
      where: { id: run.id },
      data: {
        robotsFound,
        robotsTxt,
        sitemaps: read.filter((url) => url),
        sitemapUrls: total,
        limitReached: listed.length > room,
      },
    }),
  ]);
  return robots;
}

async function nextQueued(runId: string, count: number): Promise<QueuedPage[]> {
  const select = { id: true, url: true, depth: true } as const;
  const linked = await db.crawlPage.findMany({
    where: { runId, state: "QUEUED", depth: { gte: 0 } },
    orderBy: [{ depth: "asc" }, { id: "asc" }],
    take: count,
    select,
  });
  if (linked.length >= count) return linked;
  const listed = await db.crawlPage.findMany({
    where: { runId, state: "QUEUED", depth: { lt: 0 } },
    orderBy: { id: "asc" },
    take: count - linked.length,
    select,
  });
  return [...linked, ...listed];
}

/** Add URLs to the queue up to the page limit; a found-by-link depth replaces "sitemap only". */
async function enqueue(run: WorkRun, items: { url: string; depth: number }[]): Promise<void> {
  if (!items.length) return;
  const unique = [...new Map(items.map((item) => [item.url, item])).values()];
  const existing = await db.crawlPage.findMany({
    where: { runId: run.id, url: { in: unique.map((item) => item.url) } },
    select: { id: true, url: true, depth: true },
  });
  const known = new Map(existing.map((page) => [page.url, page]));
  for (const item of unique) {
    const page = known.get(item.url);
    if (page && item.depth >= 0 && (page.depth < 0 || item.depth < page.depth)) {
      await db.crawlPage.update({ where: { id: page.id }, data: { depth: item.depth } });
    }
  }
  const fresh = unique.filter((item) => !known.has(item.url));
  if (!fresh.length) return;
  const size = await db.crawlPage.count({ where: { runId: run.id } });
  const room = Math.max(0, run.maxPages - size);
  if (fresh.length > room) await db.crawlRun.update({ where: { id: run.id }, data: { limitReached: true } });
  if (room > 0) {
    await db.crawlPage.createMany({
      data: fresh.slice(0, room).map((item) => ({ runId: run.id, url: item.url, depth: item.depth, source: "LINK" as CrawlPageSource })),
      skipDuplicates: true,
    });
  }
}

async function crawlPage(
  run: WorkRun,
  page: QueuedPage,
  robots: Robots,
  hosts: Set<string>,
  fetchOptions: FetchOptions,
  inQueue: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  if (!isAllowed(robots, CRAWLER_USER_AGENT, robotsPath(page.url))) {
    await db.crawlPage.update({ where: { id: page.id }, data: { state: "BLOCKED", indexable: false } });
    return;
  }

  let result;
  try {
    result = await safeFetch(page.url, fetchOptions);
  } catch (error) {
    await db.crawlPage.update({
      where: { id: page.id },
      data: { state: "ERROR", error: errorMessage(error), indexable: false, fetchedAt: new Date() },
    });
    return;
  }

  const contentType = result.headers["content-type"]?.slice(0, 200) ?? null;
  const xRobotsTag = result.headers["x-robots-tag"]?.slice(0, 200) ?? null;
  const childDepth = page.depth < 0 ? -1 : page.depth + 1;
  const base = {
    state: "FETCHED" as const,
    statusCode: result.status,
    contentType,
    responseMs: result.ms,
    bytes: result.body.length,
    xRobotsTag,
    fetchedAt: new Date(),
  };

  const location = result.headers["location"];
  if (result.status >= 300 && result.status < 400 && location) {
    const target = normalizeUrl(location, page.url);
    await db.crawlPage.update({ where: { id: page.id }, data: { ...base, redirectTo: target, indexable: false } });
    if (target && isOnSite(target, hosts) && !isLikelyNonHtml(target)) {
      await inQueue(() => enqueue(run, [{ url: target, depth: page.depth < 0 ? -1 : page.depth }]));
    }
    return;
  }

  if (result.status !== 200 || !contentType || !/html/i.test(contentType)) {
    await db.crawlPage.update({ where: { id: page.id }, data: { ...base, indexable: false } });
    return;
  }

  const parsed = parsePage(result.body.toString("utf8"), page.url);
  const noindex = hasNoindex(parsed.metaRobots, xRobotsTag);
  const followLinks = !/\b(nofollow|none)\b/i.test(`${parsed.metaRobots ?? ""} ${xRobotsTag ?? ""}`);
  const internal = parsed.links.filter((link) => isOnSite(link.url, hosts) && link.url !== page.url);

  await db.crawlPage.update({
    where: { id: page.id },
    data: {
      ...base,
      canonical: parsed.canonical,
      metaRobots: parsed.metaRobots,
      title: parsed.title,
      description: parsed.description,
      h1: parsed.h1,
      h1Count: parsed.h1Count,
      h2Count: parsed.h2Count,
      wordCount: parsed.wordCount,
      contentHash: parsed.contentHash,
      lang: parsed.lang,
      hreflang: parsed.hreflang.length ? parsed.hreflang : Prisma.JsonNull,
      schemaTypes: parsed.schemaTypes,
      imageCount: parsed.imageCount,
      imagesMissingAlt: parsed.imagesMissingAlt,
      externalLinks: parsed.links.length - internal.length - (parsed.links.some((link) => link.url === page.url) ? 1 : 0),
      indexable: !noindex && (!parsed.canonical || parsed.canonical === page.url),
    },
  });

  if (internal.length) {
    await db.crawlLink.createMany({
      data: internal.map((link) => ({ runId: run.id, fromPageId: page.id, toUrl: link.url, anchor: link.anchor || null, nofollow: link.nofollow })),
      skipDuplicates: true,
    });
  }
  if (followLinks) {
    const follow = internal.filter((link) => !link.nofollow && !isLikelyNonHtml(link.url));
    await inQueue(() => enqueue(run, follow.map((link) => ({ url: link.url, depth: childDepth }))));
  }
}

/** Resolve links, count inlinks, run the rules, store findings, keep the last few crawls. */
async function finishRun(run: WorkRun, now: Date): Promise<void> {
  await db.$executeRaw`
    UPDATE "CrawlLink" l SET "toPageId" = p.id
    FROM "CrawlPage" p
    WHERE l."runId" = ${run.id} AND p."runId" = ${run.id} AND p.url = l."toUrl"`;
  await db.$executeRaw`
    UPDATE "CrawlPage" p SET inlinks = c.n
    FROM (
      SELECT "toPageId", count(DISTINCT "fromPageId")::int AS n
      FROM "CrawlLink"
      WHERE "runId" = ${run.id} AND "toPageId" IS NOT NULL AND "toPageId" <> "fromPageId"
      GROUP BY "toPageId"
    ) c
    WHERE p.id = c."toPageId"`;

  const pages = await db.crawlPage.findMany({
    where: { runId: run.id },
    select: {
      id: true, url: true, state: true, depth: true, statusCode: true, redirectTo: true, contentType: true,
      responseMs: true, canonical: true, metaRobots: true, xRobotsTag: true, title: true, description: true,
      h1Count: true, wordCount: true, contentHash: true, lang: true, hreflang: true, imagesMissingAlt: true,
      inSitemap: true, inlinks: true, error: true,
    },
  });
  const links = await db.crawlLink.findMany({
    where: { runId: run.id },
    select: { toUrl: true, fromPage: { select: { url: true } } },
  });

  const rulePages: RulePage[] = pages.map((page) => ({
    ...page,
    noindex: hasNoindex(page.metaRobots, page.xRobotsTag),
    hreflang: Array.isArray(page.hreflang) ? (page.hreflang as { lang: string; href: string }[]) : [],
  }));
  const findings = technicalFindings(rulePages, links.map((link) => ({ from: link.fromPage.url, to: link.toUrl })));
  const idByUrl = new Map(pages.map((page) => [page.url, page.id]));
  const fetched = pages.filter((page) => page.state !== "QUEUED").length;

  await db.$transaction([
    db.crawlIssue.deleteMany({ where: { runId: run.id } }),
    db.crawlIssue.createMany({
      data: findings.map((finding) => ({
        runId: run.id,
        pageId: idByUrl.get(finding.url) ?? null,
        rule: finding.rule,
        severity: finding.severity as CrawlIssueSeverity,
        detail: (finding.detail as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      })),
    }),
    db.crawlRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: now, lockedUntil: null, pagesFetched: fetched, summary: summarize(findings) },
    }),
    db.seoProperty.update({ where: { id: run.propertyId }, data: { lastCrawledAt: now } }),
  ]);
  await pruneCrawls(run.propertyId);
}

async function pruneCrawls(propertyId: string): Promise<void> {
  const old = await db.crawlRun.findMany({
    where: { propertyId, status: { not: "RUNNING" } },
    orderBy: { startedAt: "desc" },
    skip: KEEP_CRAWLS,
    select: { id: true },
  });
  if (old.length) await db.crawlRun.deleteMany({ where: { id: { in: old.map((run) => run.id) } } });
}

async function workRun(runId: string, options: CrawlWorkOptions): Promise<{ fetched: number; finished: boolean }> {
  const row = await db.crawlRun.findUnique({
    where: { id: runId },
    select: { id: true, propertyId: true, startUrl: true, maxPages: true, robotsTxt: true, robotsFound: true, property: { select: { domain: true } } },
  });
  if (!row) return { fetched: 0, finished: false };
  const run: WorkRun = { ...row, domain: row.property.domain };
  const hosts = siteHosts(run.domain);
  const fetchOptions = options.fetch ?? {};

  const robots = run.robotsFound === null ? await prepare(run, hosts, fetchOptions) : run.robotsTxt ? parseRobots(run.robotsTxt) : EMPTY_ROBOTS;
  const inQueue = serial();
  const deadline = Date.now() + (options.budgetMs ?? CHUNK_BUDGET_MS);
  const limit = options.chunkPages ?? CHUNK_PAGES;
  let fetched = 0;

  while (fetched < limit && Date.now() < deadline) {
    const status = await db.crawlRun.findUnique({ where: { id: run.id }, select: { status: true } });
    if (status?.status !== "RUNNING") return { fetched, finished: false };
    const batch = await nextQueued(run.id, Math.min(CONCURRENCY, limit - fetched));
    if (!batch.length) break;
    await Promise.all(batch.map((page) => crawlPage(run, page, robots, hosts, fetchOptions, inQueue)));
    fetched += batch.length;
  }

  await db.crawlRun.update({ where: { id: run.id }, data: { pagesFetched: { increment: fetched } } });
  const remaining = await db.crawlPage.count({ where: { runId: run.id, state: "QUEUED" } });
  if (remaining === 0) {
    await finishRun(run, options.now ?? new Date());
    return { fetched, finished: true };
  }
  return { fetched, finished: false };
}

/** The scheduler's share of crawling: advance running crawls under a lease. */
export async function advanceCrawls(options: CrawlWorkOptions & { limit?: number } = {}) {
  const now = options.now ?? new Date();
  const lockFree = [{ lockedUntil: null }, { lockedUntil: { lt: now } }];

  await db.crawlRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - MAX_RUN_AGE_MS) }, OR: lockFree },
    data: { status: "FAILED", error: "The crawl did not finish within a day.", finishedAt: now, lockedUntil: null },
  });

  const runs = await db.crawlRun.findMany({
    where: { status: "RUNNING", OR: lockFree },
    orderBy: { startedAt: "asc" },
    take: options.limit ?? 2,
    select: { id: true },
  });

  let pages = 0;
  let finished = 0;
  let failed = 0;
  for (const { id } of runs) {
    const claimed = await db.crawlRun.updateMany({
      where: { id, status: "RUNNING", OR: lockFree },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 0) continue;
    try {
      const outcome = await workRun(id, { ...options, now });
      pages += outcome.fetched;
      if (outcome.finished) finished += 1;
    } catch (error) {
      failed += 1;
      cLog.error({ err: error, runId: id }, "crawl run failed");
      await db.crawlRun.updateMany({
        where: { id, status: "RUNNING" },
        data: {
          status: "FAILED",
          error: error instanceof UnsafeTargetError ? error.message : "The crawl stopped on an unexpected error.",
          finishedAt: new Date(),
        },
      });
    } finally {
      await db.crawlRun.updateMany({ where: { id }, data: { lockedUntil: null } });
    }
  }
  return { pages, finished, failed };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const RUN_SELECT = {
  id: true, propertyId: true, trigger: true, status: true, startUrl: true, maxPages: true, robotsFound: true,
  sitemapUrls: true, sitemaps: true, pagesFetched: true, limitReached: true, summary: true, error: true,
  startedAt: true, finishedAt: true, startedBy: { select: { name: true } },
} as const;

export async function listCrawlRuns(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  return db.crawlRun.findMany({
    where: { propertyId, property: { client: { deletedAt: null } } },
    orderBy: { startedAt: "desc" },
    take: KEEP_CRAWLS + 1,
    select: RUN_SELECT,
  });
}

/** A crawl, or the property's latest one when no id is given. */
export async function getCrawlRun(actor: Actor, propertyId: string, runId?: string) {
  requirePermission(actor, "seo.intelligence.view");
  const run = await db.crawlRun.findFirst({
    where: { propertyId, property: { client: { deletedAt: null } }, ...(runId ? { id: runId } : {}) },
    orderBy: { startedAt: "desc" },
    select: RUN_SELECT,
  });
  if (!run) return null;
  const queued = run.status === "RUNNING" ? await db.crawlPage.count({ where: { runId: run.id, state: "QUEUED" } }) : 0;
  const total = await db.crawlPage.count({ where: { runId: run.id } });
  return { ...run, queued, total };
}

export const PAGE_FILTERS = ["all", "html", "indexable", "non-indexable", "2xx", "3xx", "4xx", "5xx", "error", "blocked", "queued"] as const;
export type PageFilter = (typeof PAGE_FILTERS)[number];

function pageWhere(runId: string, filter: PageFilter, q: string | undefined): Prisma.CrawlPageWhereInput {
  const where: Prisma.CrawlPageWhereInput = { runId };
  switch (filter) {
    case "html": where.contentType = { contains: "html", mode: "insensitive" }; where.statusCode = 200; break;
    case "indexable": where.indexable = true; break;
    case "non-indexable": where.indexable = false; break;
    case "2xx": where.statusCode = { gte: 200, lt: 300 }; break;
    case "3xx": where.statusCode = { gte: 300, lt: 400 }; break;
    case "4xx": where.statusCode = { gte: 400, lt: 500 }; break;
    case "5xx": where.statusCode = { gte: 500 }; break;
    case "error": where.state = "ERROR"; break;
    case "blocked": where.state = "BLOCKED"; break;
    case "queued": where.state = "QUEUED"; break;
  }
  if (q) where.url = { contains: q, mode: "insensitive" };
  return where;
}

async function scopedRun(runId: string) {
  const run = await db.crawlRun.findFirst({ where: { id: runId, property: { client: { deletedAt: null } } }, select: { id: true, propertyId: true } });
  if (!run) throw new NotFoundError("That crawl was not found.");
  return run;
}

export async function listCrawlPages(
  actor: Actor,
  runId: string,
  params: Partial<PageParams> & { filter?: PageFilter; q?: string } = {},
) {
  requirePermission(actor, "seo.intelligence.view");
  await scopedRun(runId);
  const { page, perPage, skip, take } = toSkipTake(params);
  const where = pageWhere(runId, params.filter ?? "all", params.q?.trim() || undefined);
  const [rows, total] = await Promise.all([
    db.crawlPage.findMany({
      where,
      orderBy: [{ depth: "asc" }, { url: "asc" }],
      skip,
      take,
      select: {
        id: true, url: true, depth: true, source: true, state: true, statusCode: true, redirectTo: true,
        responseMs: true, title: true, wordCount: true, indexable: true, inSitemap: true, inlinks: true,
        canonical: true, metaRobots: true, error: true, _count: { select: { issues: true } },
      },
    }),
    db.crawlPage.count({ where }),
  ]);
  return paged(rows, total, page, perPage);
}

/** Findings grouped by rule, with counts, worst first. */
export async function crawlIssueSummary(actor: Actor, runId: string) {
  requirePermission(actor, "seo.intelligence.view");
  await scopedRun(runId);
  const groups = await db.crawlIssue.groupBy({ by: ["rule", "severity"], where: { runId }, _count: { _all: true } });
  const order: Record<string, number> = { CRITICAL: 0, WARNING: 1, NOTICE: 2 };
  return groups
    .map((group) => ({ rule: group.rule, severity: group.severity, count: group._count._all }))
    .sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3) || b.count - a.count);
}

export async function listCrawlIssues(
  actor: Actor,
  runId: string,
  params: Partial<PageParams> & { rule?: string; severity?: CrawlIssueSeverity } = {},
) {
  requirePermission(actor, "seo.intelligence.view");
  await scopedRun(runId);
  const { page, perPage, skip, take } = toSkipTake(params);
  const where: Prisma.CrawlIssueWhereInput = { runId, ...(params.rule ? { rule: params.rule } : {}), ...(params.severity ? { severity: params.severity } : {}) };
  const [rows, total] = await Promise.all([
    db.crawlIssue.findMany({
      where,
      orderBy: [{ severity: "asc" }, { rule: "asc" }, { id: "asc" }],
      skip,
      take,
      select: { id: true, rule: true, severity: true, detail: true, page: { select: { id: true, url: true, statusCode: true } } },
    }),
    db.crawlIssue.count({ where }),
  ]);
  return paged(rows, total, page, perPage);
}
