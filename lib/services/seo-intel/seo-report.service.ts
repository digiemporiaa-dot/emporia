import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { toMoneyString } from "@/lib/money";
import { withAudit } from "@/lib/services/audit.service";
import { sendTemplate } from "@/lib/services/email.service";
import { absoluteUrl } from "@/lib/seo/urls";
import { toDbDate } from "@/lib/seo-intel/dates";
import { urlPathKey } from "@/lib/seo-intel/engine/organic";
import { ORGANIC_CHANNEL } from "@/lib/seo-intel/normalize/ga4";
import { monthRange, readSeoReportData, reportableMonths, reportMonthLabel, seoReportDataSchema, shiftMonth, type SeoReportData } from "@/lib/seo-intel/report-doc";
import type { DayRange } from "@/lib/seo-intel/periods";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Monthly SEO reports (Phase 11): a frozen snapshot per website and month.
 * Staff generate (or the scheduler drafts on the 3rd, once Search Console
 * has caught up), add notes, and publish; the client then reads it in the
 * portal. A published report is never regenerated until it is unpublished.
 */

const rLog = log("seo-reports");
/** The scheduler drafts last month's report from this day of the month (UTC). */
export const AUTO_DRAFT_DAY = 3;

const between = (range: DayRange) => Prisma.sql`date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date`;
const num = (value: unknown) => Number(value ?? 0);

type TotalsRow = { clicks: bigint | number | null; impressions: bigint | number | null; weighted: number | null; days: bigint | number | null };

async function searchTotals(propertyId: string, range: DayRange) {
  const [row] = await db.$queryRaw<TotalsRow[]>(Prisma.sql`
    SELECT SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted, COUNT(*) AS days
    FROM "GscDailyTotal" WHERE "propertyId" = ${propertyId} AND device = '' AND country = '' AND ${between(range)}`);
  const clicks = num(row?.clicks);
  const impressions = num(row?.impressions);
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null, position: impressions > 0 ? num(row?.weighted) / impressions : null, days: num(row?.days) };
}

type KeyRow = { key: string; clicks: bigint | number | null; impressions: bigint | number | null; weighted: number | null };

async function topRows(table: "GscQueryDaily" | "GscPageDaily", propertyId: string, range: DayRange, limit: number) {
  const column = table === "GscQueryDaily" ? Prisma.raw("query") : Prisma.raw("page");
  return db.$queryRaw<KeyRow[]>(Prisma.sql`
    SELECT ${column} AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
    FROM ${Prisma.raw(`"${table}"`)} WHERE "propertyId" = ${propertyId} AND ${between(range)}
    GROUP BY 1 ORDER BY SUM(clicks) DESC, SUM(impressions) DESC LIMIT ${limit}`);
}

async function clicksFor(table: "GscQueryDaily" | "GscPageDaily", propertyId: string, range: DayRange, keys: string[]) {
  if (!keys.length) return new Map<string, number>();
  const column = table === "GscQueryDaily" ? Prisma.raw("query") : Prisma.raw("page");
  const rows = await db.$queryRaw<{ key: string; clicks: bigint | number | null }[]>(Prisma.sql`
    SELECT ${column} AS key, SUM(clicks) AS clicks FROM ${Prisma.raw(`"${table}"`)}
    WHERE "propertyId" = ${propertyId} AND ${between(range)} AND ${column} = ANY(${keys}::text[]) GROUP BY 1`);
  return new Map(rows.map((row) => [row.key, num(row.clicks)]));
}

async function keywordMovement(propertyId: string, current: DayRange, previous: DayRange) {
  const tracked = await db.seoKeyword.findMany({ where: { propertyId }, select: { keyword: true } });
  if (!tracked.length) return null;
  const keywords = tracked.map((k) => k.keyword);
  const positions = async (range: DayRange) => {
    const rows = await db.$queryRaw<KeyRow[]>(Prisma.sql`
      SELECT query AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscQueryDaily" WHERE "propertyId" = ${propertyId} AND query = ANY(${keywords}::text[]) AND ${between(range)} GROUP BY 1`);
    return new Map(rows.filter((row) => num(row.impressions) > 0).map((row) => [row.key, num(row.weighted) / num(row.impressions)]));
  };
  const [now, before] = await Promise.all([positions(current), positions(previous)]);
  const moves = [...now].filter(([k]) => before.has(k)).map(([keyword, to]) => ({ keyword, from: before.get(keyword) as number, to }));
  // A move under one place is noise in an average position.
  const improved = moves.filter((m) => m.from - m.to >= 1).sort((a, b) => b.from - b.to - (a.from - a.to)).slice(0, 5);
  const declined = moves.filter((m) => m.to - m.from >= 1).sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 5);
  return { tracked: keywords.length, inTop10: [...now.values()].filter((p) => p <= 10).length, improved, declined };
}

type OrgRow = { sessions: bigint | number | null; engaged: bigint | number | null; keyEvents: number | null; revenue: { toString(): string } | null; days: bigint | number | null };

async function organicTotals(propertyId: string, range: DayRange) {
  const [row] = await db.$queryRaw<OrgRow[]>(Prisma.sql`
    SELECT SUM(sessions) AS sessions, SUM("engagedSessions") AS engaged, SUM("keyEvents") AS "keyEvents", SUM(revenue) AS revenue, COUNT(*) AS days
    FROM "Ga4DailyTotal" WHERE "propertyId" = ${propertyId} AND channel = ${ORGANIC_CHANNEL} AND country = '' AND device = '' AND ${between(range)}`);
  return { sessions: num(row?.sessions), engagedSessions: num(row?.engaged), keyEvents: num(row?.keyEvents), revenue: toMoneyString(row?.revenue?.toString() ?? "0"), days: num(row?.days) };
}

const crawlOf = (row: { finishedAt: Date; pagesFetched: number; indexablePages: number; critical: number; warning: number; notice: number }) => ({
  finishedAt: row.finishedAt.toISOString(),
  pagesFetched: row.pagesFetched,
  indexablePages: row.indexablePages,
  critical: row.critical,
  warning: row.warning,
  notice: row.notice,
});

/** The report's contents for one website and month, from stored rows only. */
export async function buildReportData(propertyId: string, month: string, now = new Date()): Promise<SeoReportData> {
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: { id: true, displayName: true, domain: true, clientId: true, gscSiteUrl: true, ga4PropertyId: true, ga4Currency: true, client: { select: { name: true } } },
  });
  if (!property) throw new NotFoundError("That website was not found.");
  const current = monthRange(month);
  const previous = monthRange(shiftMonth(month, -1));
  const lastYear = monthRange(shiftMonth(month, -12));
  const monthStart = toDbDate(current.start);
  const monthEnd = toDbDate(addDay(current.end));

  // Search Console
  let search: SeoReportData["search"] = null;
  let keywords: SeoReportData["keywords"] = null;
  const hasSearch = property.gscSiteUrl || (await db.gscDailyTotal.count({ where: { propertyId, date: { gte: monthStart, lt: monthEnd } } })) > 0;
  if (hasSearch) {
    const [cur, prev, yoy, queries, pages] = await Promise.all([
      searchTotals(propertyId, current),
      searchTotals(propertyId, previous),
      searchTotals(propertyId, lastYear),
      topRows("GscQueryDaily", propertyId, current, 10),
      topRows("GscPageDaily", propertyId, current, 10),
    ]);
    const [prevQueries, prevPages] = await Promise.all([
      clicksFor("GscQueryDaily", propertyId, previous, queries.map((q) => q.key)),
      clicksFor("GscPageDaily", propertyId, previous, pages.map((p) => p.key)),
    ]);
    search = {
      current: cur,
      previous: prev,
      lastYear: yoy,
      daysInMonth: Number(current.end.slice(8, 10)),
      topQueries: queries.map((q) => ({ query: q.key.slice(0, 500), clicks: num(q.clicks), impressions: num(q.impressions), position: num(q.impressions) > 0 ? num(q.weighted) / num(q.impressions) : null, previousClicks: prevQueries.get(q.key) ?? 0 })),
      topPages: pages.map((p) => ({ page: (urlPathKey(p.key) ?? p.key).slice(0, 2000), clicks: num(p.clicks), impressions: num(p.impressions), previousClicks: prevPages.get(p.key) ?? 0 })),
    };
    keywords = await keywordMovement(propertyId, current, previous);
  }

  // GA4
  let organic: SeoReportData["organic"] = null;
  const hasOrganic = property.ga4PropertyId || (await db.ga4DailyTotal.count({ where: { propertyId, date: { gte: monthStart, lt: monthEnd } } })) > 0;
  if (hasOrganic) {
    const [cur, prev] = await Promise.all([organicTotals(propertyId, current), organicTotals(propertyId, previous)]);
    organic = { current: cur, previous: prev, currency: property.ga4Currency };
  }

  // Crawls: the latest finished by the month's end, and the one before it.
  const crawls = await db.seoCrawlHistory.findMany({ where: { propertyId, finishedAt: { lt: monthEnd } }, orderBy: { finishedAt: "desc" }, take: 2 });
  const technical = crawls[0] ? { latest: crawlOf(crawls[0]), previous: crawls[1] ? crawlOf(crawls[1]) : null } : null;

  // Opportunities
  const inMonth = { gte: monthStart, lt: monthEnd };
  const [opened, done, resolved, openNow, top] = await Promise.all([
    db.seoOpportunity.count({ where: { propertyId, firstSeenAt: inMonth } }),
    db.seoOpportunity.count({ where: { propertyId, status: "DONE", resolvedAt: inMonth } }),
    db.seoOpportunity.count({ where: { propertyId, status: "RESOLVED", resolvedAt: inMonth } }),
    db.seoOpportunity.count({ where: { propertyId, status: { in: ["OPEN", "TASK_CREATED"] } } }),
    db.seoOpportunity.findMany({ where: { propertyId, status: { in: ["OPEN", "TASK_CREATED"] } }, orderBy: [{ severity: "asc" }, { impact: "desc" }], take: 5, select: { title: true, severity: true } }),
  ]);

  // Google reviews for the client's connected locations.
  const accounts = await db.socialAccount.findMany({
    where: { clientId: property.clientId, provider: "GOOGLE_BUSINESS_PROFILE", status: { not: "DISCONNECTED" }, gbpListing: { lastSyncedAt: { not: null } } },
    select: { id: true, gbpListing: { select: { averageRating: true } } },
  });
  let reviews: SeoReportData["reviews"] = null;
  if (accounts.length) {
    const monthReviews = await db.gbpReview.findMany({ where: { socialAccountId: { in: accounts.map((a) => a.id) }, createdAt: inMonth }, select: { rating: true, replyComment: true } });
    const ratings = accounts.map((a) => a.gbpListing?.averageRating).filter((r): r is number => typeof r === "number");
    reviews = {
      locations: accounts.length,
      newReviews: monthReviews.length,
      averageInMonth: monthReviews.length ? monthReviews.reduce((s, r) => s + r.rating, 0) / monthReviews.length : null,
      unanswered: monthReviews.filter((r) => !r.replyComment).length,
      googleRating: ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null,
    };
  }

  // Core Web Vitals: the origin on phones, the latest period ending by the month's end.
  const cwvRow = await db.cwvSnapshot.findFirst({ where: { propertyId, url: "", formFactor: "PHONE", periodEnd: { lte: toDbDate(current.end) } }, orderBy: { periodEnd: "desc" } });
  const cwv = cwvRow ? { periodEnd: cwvRow.periodEnd.toISOString().slice(0, 10), formFactor: cwvRow.formFactor, lcp: cwvRow.lcp, inp: cwvRow.inp, cls: cwvRow.cls } : null;

  const changes = await db.seoChangeEvent.findMany({
    where: { propertyId, periodEnd: { gte: monthStart, lte: toDbDate(current.end) } },
    orderBy: [{ severity: "asc" }, { periodEnd: "desc" }],
    take: 10,
    select: { title: true, severity: true, periodEnd: true },
  });

  return seoReportDataSchema.parse({
    version: 1,
    website: { name: property.displayName.slice(0, 300), domain: property.domain, client: property.client.name.slice(0, 300) },
    month,
    generatedAt: now.toISOString(),
    search,
    keywords,
    organic,
    technical,
    opportunities: { opened, done, resolved, openNow, top: top.map((t) => ({ title: t.title.slice(0, 300), severity: t.severity })) },
    reviews,
    cwv,
    changes: changes.map((c) => ({ title: c.title.slice(0, 300), severity: c.severity, periodEnd: c.periodEnd.toISOString().slice(0, 10) })),
  });
}

function addDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function staffOnly(actor: Actor) {
  // The same answer as an id that does not exist.
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new NotFoundError("That report does not exist.");
}

async function propertyOf(propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That website was not found.");
  return property;
}

/** Generate — or regenerate, while it is a draft — a website's report for a completed month. */
export async function generateSeoReport(actor: Actor, input: { propertyId: string; month: string }, now = new Date()) {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await propertyOf(input.propertyId);
  if (!reportableMonths(now).includes(input.month)) throw new ValidationError("Choose a completed month from the last 13.");
  const existing = await db.seoReport.findUnique({ where: { propertyId_month: { propertyId: input.propertyId, month: input.month } }, select: { id: true, status: true } });
  if (existing?.status === "PUBLISHED") throw new ConflictError("This report is published. Unpublish it before generating it again.");
  const data = await buildReportData(input.propertyId, input.month, now);
  const generatedById = actor.type === "STAFF" ? actor.userId : null;
  return withAudit(
    { actor, action: existing ? "UPDATE" : "CREATE", entityType: "SeoReport", entityId: existing?.id ?? `${input.propertyId}:${input.month}`, after: { month: input.month, regenerated: Boolean(existing) } },
    (tx) =>
      tx.seoReport.upsert({
        where: { propertyId_month: { propertyId: input.propertyId, month: input.month } },
        create: { propertyId: input.propertyId, month: input.month, data, generatedById, generatedAt: now },
        update: { data, generatedById, generatedAt: now },
        select: { id: true, month: true },
      }),
  );
}

async function manageable(actor: Actor, reportId: string) {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  const report = await db.seoReport.findFirst({ where: { id: reportId, property: { client: { deletedAt: null } } }, select: { id: true, status: true, month: true, propertyId: true } });
  if (!report) throw new NotFoundError("That report does not exist.");
  return report;
}

/** The report's one human-written part. Plain text; drafts only. */
export async function setSeoReportNotes(actor: Actor, reportId: string, notes: string | null) {
  const report = await manageable(actor, reportId);
  if (report.status !== "DRAFT") throw new ConflictError("Unpublish the report before changing its notes.");
  const text = notes?.trim() ? notes.trim().slice(0, 5_000) : null;
  return withAudit({ actor, action: "UPDATE", entityType: "SeoReport", entityId: reportId, after: { notes: text ? "set" : "cleared" } }, (tx) =>
    tx.seoReport.update({ where: { id: reportId }, data: { notes: text }, select: { id: true } }),
  );
}

/** Put the report in front of the client, or take it back. */
export async function setSeoReportPublished(actor: Actor, reportId: string, published: boolean) {
  const report = await manageable(actor, reportId);
  if ((report.status === "PUBLISHED") === published) throw new ConflictError(published ? "This report is already published." : "This report is not published.");
  const result = await withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "SeoReport", entityId: reportId, before: { status: report.status }, after: { status: published ? "PUBLISHED" : "DRAFT", month: report.month } },
    (tx) =>
      tx.seoReport.update({
        where: { id: reportId },
        data: published ? { status: "PUBLISHED", publishedAt: new Date(), publishedById: actor.type === "STAFF" ? actor.userId : null } : { status: "DRAFT", publishedAt: null, publishedById: null },
        select: { id: true, status: true },
      }),
  );
  if (published) await announcePublished(reportId);
  return result;
}

async function announcePublished(reportId: string) {
  try {
    const report = await db.seoReport.findUniqueOrThrow({ where: { id: reportId }, select: { id: true, month: true, property: { select: { displayName: true, clientId: true, client: { select: { name: true } } } } } });
    const label = reportMonthLabel(report.month);
    const users = await db.user.findMany({ where: { clientId: report.property.clientId, type: "CLIENT", status: "ACTIVE" }, select: { email: true } });
    for (const user of users) {
      await sendTemplate("CLIENT_NOTIFICATION", {
        to: user.email,
        variables: {
          clientName: report.property.client.name,
          subject: `Your ${label} SEO report for ${report.property.displayName}`,
          body: `Your SEO report for ${label} is ready: search traffic, keywords, site health and what we worked on.`,
          actionLabel: "Open the report",
          actionUrl: absoluteUrl(`/portal/seo/reports/${report.id}`),
        },
        entity: { type: "SeoReport", id: report.id },
      });
    }
  } catch (error) {
    rLog.error({ err: error, reportId }, "announcing an SEO report failed");
  }
}

/** A website's reports, newest month first, for staff. */
export async function listSeoReports(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await propertyOf(propertyId);
  return db.seoReport.findMany({
    where: { propertyId },
    orderBy: { month: "desc" },
    select: { id: true, month: true, status: true, generatedAt: true, publishedAt: true, generatedBy: { select: { name: true } } },
  });
}

/** Published reports for the signed-in client's websites — the session decides whose. */
export async function portalSeoReports(actor: PortalActor) {
  return db.seoReport.findMany({
    where: { status: "PUBLISHED", property: { clientId: actor.clientId, client: { deletedAt: null } } },
    orderBy: [{ month: "desc" }, { property: { displayName: "asc" } }],
    select: { id: true, month: true, publishedAt: true, property: { select: { displayName: true, domain: true } } },
  });
}

/**
 * One report, for whoever may read it: staff with `seo.intelligence.view`,
 * or a client reading their own website's published report. Anything else is
 * "not found" — the same answer as an id that does not exist.
 */
export async function getSeoReport(actor: Actor, reportId: string) {
  const report = await db.seoReport.findFirst({
    where: { id: reportId, property: { client: { deletedAt: null } } },
    select: { id: true, month: true, status: true, data: true, notes: true, generatedAt: true, publishedAt: true, propertyId: true, property: { select: { clientId: true } }, generatedBy: { select: { name: true } } },
  });
  if (!report) throw new NotFoundError("That report does not exist.");
  if (actor.type === "CLIENT") {
    if (!actor.clientId || report.property.clientId !== actor.clientId || report.status !== "PUBLISHED") throw new NotFoundError("That report does not exist.");
  } else {
    requirePermission(actor, "seo.intelligence.view");
  }
  const data = readSeoReportData(report.data);
  if (!data) throw new NotFoundError("That report could not be read.");
  const { property: _property, ...rest } = report;
  void _property;
  return { ...rest, data };
}

/**
 * The scheduler's job: from the 3rd of a month, draft last month's report for
 * every active website with Search Console or GA4 that has none yet. Never
 * touches an existing report, drafted or published.
 */
export async function draftDueReports(options: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = options.now ?? new Date();
  if (now.getUTCDate() < AUTO_DRAFT_DAY) return 0;
  const month = reportableMonths(now, 1)[0] as string;
  const due = await db.seoProperty.findMany({
    where: {
      isActive: true,
      client: { deletedAt: null },
      OR: [{ gscSiteUrl: { not: null } }, { ga4PropertyId: { not: null } }],
      reports: { none: { month } },
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 3,
    select: { id: true },
  });
  let drafted = 0;
  for (const property of due) {
    try {
      const data = await buildReportData(property.id, month, now);
      await db.seoReport.create({ data: { propertyId: property.id, month, data, generatedAt: now } });
      drafted++;
    } catch (error) {
      // A concurrent run drafting the same report hits the unique key; anything else is logged.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) rLog.error({ err: error, propertyId: property.id }, "drafting an SEO report failed");
    }
  }
  return drafted;
}
