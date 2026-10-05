import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { log } from "@/lib/logger";
import { record, withAudit } from "@/lib/services/audit.service";
import { systemActor, type Actor } from "@/lib/actor/types";
import { saveTask } from "@/lib/services/project.service";
import { toDbDate } from "@/lib/seo-intel/dates";
import { thresholdsFor } from "@/lib/services/seo-intel/thresholds.service";
import { computeKeywordOpportunities } from "@/lib/services/seo-intel/keyword.service";
import { computeContentFindings, CONTENT_TYPES } from "@/lib/services/seo-intel/content.service";
import { indexationConflicts } from "@/lib/services/seo-intel/indexation.service";
import { getSEOOverview } from "@/lib/services/seo-intel/overview.service";
import { computeCoverage } from "@/lib/services/seo-intel/local.service";
import { computeNap } from "@/lib/services/seo-intel/nap.service";
import { computeInternational } from "@/lib/services/seo-intel/international.service";
import { REVIEW_SYNC_INTERVAL_MS } from "@/lib/services/seo-intel/reviews.service";
import { reviewStats } from "@/lib/seo-intel/engine/reviews";
import { countryName } from "@/lib/geo/countries";
import { latestGa4Day } from "@/lib/services/seo-intel/organic.service";
import { landingStatsByPath } from "@/lib/services/seo-intel/ga4-read.service";
import { lowConversionPages } from "@/lib/seo-intel/engine/organic";
import { ORGANIC_CHANNEL } from "@/lib/seo-intel/normalize/ga4";
import { resolvePeriod } from "@/lib/seo-intel/periods";
import {
  fromChanges,
  fromContent,
  fromAnalytics,
  fromIndexation,
  fromInternational,
  fromKeywords,
  fromLinks,
  fromLocal,
  fromNap,
  fromReviews,
  fromTechnical,
  reconcile,
  type Candidate,
  type Source,
  type TechnicalGroup,
} from "@/lib/seo-intel/engine/opportunities";
import type { ChangeInsight } from "@/lib/seo-intel/engine/changes";
import type { SeoEffort, SeoOpportunitySource, SeoOpportunityStatus, SeoSeverity } from "@/generated/prisma/enums";

/**
 * The opportunity engine's storage, schedule and actions (Phase 10).
 *
 * Detection runs daily per website: every rule proposes candidates, the
 * stored list is reconciled with them, and "What changed" is kept as a dated
 * event history. Only sources that actually ran can resolve stored items.
 */

const oLog = log("seo-opportunities");
const CONTENT_CAP_PER_TYPE = 50;
const DETECT_EVERY_MS = 20 * 60 * 60_000;

async function technicalGroups(propertyId: string): Promise<TechnicalGroup[] | null> {
  const run = await db.crawlRun.findFirst({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { id: true } });
  if (!run) return null;
  const groups = await db.crawlIssue.groupBy({ by: ["rule", "severity"], where: { runId: run.id, severity: { in: ["CRITICAL", "WARNING"] } }, _count: { _all: true } });
  const samples = await db.crawlIssue.findMany({
    where: { runId: run.id, severity: { in: ["CRITICAL", "WARNING"] }, pageId: { not: null } },
    select: { rule: true, page: { select: { url: true } } },
    orderBy: { id: "asc" },
    take: 2_000,
  });
  return groups.map((group) => ({
    rule: group.rule,
    severity: group.severity,
    count: group._count._all,
    sample: samples.filter((s) => s.rule === group.rule && s.page).slice(0, 5).map((s) => s.page!.url),
  }));
}

async function linkGroups(propertyId: string) {
  const run = await db.crawlRun.findFirst({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { id: true, suggestionCount: true } });
  if (!run || run.suggestionCount === null) return null;
  const rows = await db.internalLinkSuggestion.findMany({
    where: { runId: run.id },
    select: { query: true, position: true, impressions: true, targetPage: { select: { url: true } }, sourcePage: { select: { url: true } } },
  });
  const groups = new Map<string, { target: string; query: string; position: number; impressions: number; sources: string[] }>();
  for (const row of rows) {
    const key = `${row.targetPage.url}\n${row.query}`;
    const group = groups.get(key) ?? { target: row.targetPage.url, query: row.query, position: row.position, impressions: row.impressions, sources: [] };
    group.sources.push(row.sourcePage.url);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Local coverage counts as run only with a finished crawl, Search Console
 * data and both lists filled: without demand figures a gap cannot be judged,
 * so nothing stored may be resolved.
 */
async function localCandidates(propertyId: string, minImpressions: number): Promise<Candidate[] | null> {
  const coverage = await computeCoverage(propertyId);
  if (!coverage.run || !coverage.range || !coverage.services.length || !coverage.cities.length) return null;
  const serviceName = new Map(coverage.services.map((s) => [s.id, s.name]));
  const cityName = new Map(coverage.cities.map((c) => [c.cityId, c.name]));
  return fromLocal(
    coverage.cells.map((cell) => ({
      serviceId: cell.serviceId,
      serviceName: serviceName.get(cell.serviceId) ?? "",
      cityId: cell.cityId,
      cityName: cityName.get(cell.cityId) ?? "",
      status: cell.status,
      url: cell.page?.url ?? null,
      demand: cell.demand,
    })),
    minImpressions,
  );
}

/** Needs a business profile with an address or phone; the site half also needs a crawl. */
async function napCandidates(propertyId: string): Promise<Candidate[] | null> {
  const nap = await computeNap(propertyId);
  if (!nap.profileReady || !nap.report) return null;
  const report = nap.report;
  return fromNap({
    hasCrawl: !!nap.run,
    hasAddress: !!(nap.truth.street || nap.truth.locality || nap.truth.postalCode),
    schemaPages: report.schemaPages,
    schemaMismatches: report.schemaMismatches,
    incompletePages: [...new Set(report.incomplete.filter((row) => row.required.length).map((row) => row.url))],
    phoneOnSite: report.phoneOnSite,
    listings: nap.listings.map((listing, i) => ({ id: listing.id, name: listing.name, mismatches: report.listing[i]?.mismatches ?? [] })),
  });
}

/**
 * Runs only when every connected location of the client was read within two
 * sync intervals — a location Google would not answer for must not have its
 * findings resolved.
 */
async function reviewCandidates(propertyId: string, now: Date, t: Awaited<ReturnType<typeof thresholdsFor>>): Promise<Candidate[] | null> {
  const property = await db.seoProperty.findUnique({ where: { id: propertyId }, select: { clientId: true } });
  if (!property) return null;
  const accounts = await db.socialAccount.findMany({
    where: { clientId: property.clientId, provider: "GOOGLE_BUSINESS_PROFILE", status: "CONNECTED" },
    select: { id: true, name: true, gbpListing: { select: { lastSyncedAt: true } } },
  });
  const fresh = new Date(now.getTime() - 2 * REVIEW_SYNC_INTERVAL_MS);
  if (!accounts.length || accounts.some((a) => !a.gbpListing?.lastSyncedAt || a.gbpListing.lastSyncedAt < fresh)) return null;
  const options = { unansweredDays: t["reviews.unansweredDays"], lowRating: t["reviews.lowRating"], quietDays: t["reviews.quietDays"] };
  const locations = [];
  for (const account of accounts) {
    const reviews = await db.gbpReview.findMany({ where: { socialAccountId: account.id }, select: { rating: true, createdAt: true, replyComment: true, repliedAt: true } });
    const stats = reviewStats(reviews, now, options);
    locations.push({ id: account.id, name: account.name, unanswered: stats.unanswered, unansweredLow: stats.unansweredLow, daysSinceLast: stats.daysSinceLast });
  }
  return fromReviews(locations, options);
}

/** Needs a crawl (to know the versions) and Search Console (to know the traffic). */
async function internationalCandidates(propertyId: string): Promise<Candidate[] | null> {
  const analysis = await computeInternational(propertyId);
  if (!analysis.run || !analysis.period) return null;
  return fromInternational(analysis.missing.map((row) => ({ ...row, name: countryName(row.country) ?? row.country })));
}

/**
 * Needs synced GA4 data with key events: a site that records none has no rate
 * to compare pages against, so nothing it found before may be resolved.
 */
async function analyticsCandidates(propertyId: string, t: Awaited<ReturnType<typeof thresholdsFor>>): Promise<Candidate[] | null> {
  const latest = await latestGa4Day(propertyId);
  if (!latest) return null;
  const range = resolvePeriod("28d", latest).current;
  const site = await db.ga4DailyTotal.aggregate({
    where: { propertyId, channel: ORGANIC_CHANNEL, country: "", device: "", date: { gte: toDbDate(range.start), lte: toDbDate(range.end) } },
    _sum: { sessions: true, keyEvents: true },
  });
  const sessions = site._sum.sessions ?? 0;
  const keyEvents = site._sum.keyEvents ?? 0;
  if (sessions === 0 || keyEvents === 0) return null;
  const pages = await landingStatsByPath(propertyId, range, ORGANIC_CHANNEL);
  return fromAnalytics(
    lowConversionPages(
      [...pages].map(([path, stats]) => ({ path, sessions: stats.sessions, keyEvents: stats.keyEvents })),
      keyEvents / sessions,
      { minSessions: t["analytics.minSessions"], rateShare: t["analytics.rateShare"] },
    ),
  );
}

/** Run every source for one website and reconcile the stored list. */
export async function detectOpportunities(propertyId: string, now = new Date()) {
  const t = await thresholdsFor(propertyId);
  const candidates: Candidate[] = [];
  const ran = new Set<Source>();
  const attempt = async (source: Source, run: () => Promise<Candidate[] | null>) => {
    try {
      const found = await run();
      if (found) {
        candidates.push(...found);
        ran.add(source);
      }
    } catch (error) {
      // A failing source is skipped, never read as "everything fixed".
      oLog.error({ err: error, propertyId, source }, "opportunity source failed");
    }
  };

  await attempt("KEYWORDS", async () => {
    const computed = await computeKeywordOpportunities(propertyId);
    return computed ? fromKeywords(computed.all, t["opportunities.commandCenterCap"]) : null;
  });
  await attempt("CONTENT", async () => {
    const computed = await computeContentFindings(propertyId);
    return computed ? fromContent(CONTENT_TYPES.flatMap((type) => computed.findings[type]), CONTENT_CAP_PER_TYPE) : null;
  });
  await attempt("TECHNICAL", async () => {
    const groups = await technicalGroups(propertyId);
    return groups ? fromTechnical(groups) : null;
  });
  await attempt("INDEXATION", async () => {
    const groups = await indexationConflicts(propertyId);
    return groups ? fromIndexation(groups) : null;
  });
  await attempt("LINKS", async () => {
    const groups = await linkGroups(propertyId);
    return groups ? fromLinks(groups) : null;
  });
  await attempt("LOCAL", () => localCandidates(propertyId, t["local.gapMinImpressions"]));
  await attempt("NAP", () => napCandidates(propertyId));
  await attempt("REVIEWS", () => reviewCandidates(propertyId, now, t));
  await attempt("INTERNATIONAL", () => internationalCandidates(propertyId));
  await attempt("ANALYTICS", () => analyticsCandidates(propertyId, t));
  await attempt("CHANGES", async () => {
    const overview = await getSEOOverview(systemActor({ permissions: ["seo.intelligence.view"] }), propertyId, "28d");
    if (overview.state !== "ready") return null;
    await recordChangeEvents(propertyId, overview.changes);
    return fromChanges(overview.changes);
  });

  const stored = await db.seoOpportunity.findMany({
    where: { propertyId },
    select: { id: true, fingerprint: true, source: true, status: true, impact: true, dismissedImpact: true },
  });
  const plan = reconcile(stored, candidates, ran);
  const fields = (c: Candidate) => ({
    source: c.source as SeoOpportunitySource,
    type: c.type,
    title: c.title.slice(0, 300),
    url: c.url,
    query: c.query,
    evidence: c.evidence as Prisma.InputJsonValue,
    impact: Math.round(c.impact),
    impactUnit: c.impactUnit,
    severity: c.severity as SeoSeverity,
    effort: c.effort as SeoEffort,
    lastSeenAt: now,
  });

  await db.$transaction(async (tx) => {
    if (plan.create.length) {
      await tx.seoOpportunity.createMany({
        data: plan.create.map((c) => ({ propertyId, fingerprint: c.fingerprint, firstSeenAt: now, ...fields(c) })),
        skipDuplicates: true,
      });
    }
    for (const { id, candidate } of plan.refresh) await tx.seoOpportunity.update({ where: { id }, data: fields(candidate) });
    for (const { id, candidate } of plan.reopen) {
      await tx.seoOpportunity.update({
        where: { id },
        data: { ...fields(candidate), status: "OPEN", resolvedAt: null, dismissedAt: null, dismissedById: null, dismissReason: null, dismissedImpact: null },
      });
    }
    if (plan.resolve.length) await tx.seoOpportunity.updateMany({ where: { id: { in: plan.resolve } }, data: { status: "RESOLVED", resolvedAt: now } });
    await tx.seoProperty.update({ where: { id: propertyId }, data: { lastDetectedAt: now } });
  }, { timeout: 60_000 });

  return { created: plan.create.length, refreshed: plan.refresh.length, reopened: plan.reopen.length, resolved: plan.resolve.length, sources: [...ran] };
}

async function recordChangeEvents(propertyId: string, changes: readonly ChangeInsight[]) {
  for (const change of changes) {
    const periodEnd = toDbDate(change.range.current.end);
    const data = {
      severity: change.severity.toUpperCase() as SeoSeverity,
      direction: change.direction,
      title: change.title.slice(0, 300),
      entityType: change.entity.type,
      entityKeys: change.entity.keys.slice(0, 50),
      range: change.range as unknown as Prisma.InputJsonValue,
    };
    await db.seoChangeEvent.upsert({
      where: { propertyId_key_periodEnd: { propertyId, key: change.key, periodEnd } },
      create: { propertyId, key: change.key, periodEnd, ...data },
      update: data,
    });
  }
}

/** The daily schedule: a couple of websites per scheduler run. */
export async function detectDueOpportunities(options: { now?: Date; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const due = await db.seoProperty.findMany({
    where: { isActive: true, client: { deletedAt: null }, OR: [{ lastDetectedAt: null }, { lastDetectedAt: { lt: new Date(now.getTime() - DETECT_EVERY_MS) } }] },
    orderBy: [{ lastDetectedAt: { sort: "asc", nulls: "first" } }],
    take: options.limit ?? 2,
    select: { id: true },
  });
  let detected = 0;
  for (const { id } of due) {
    try {
      await detectOpportunities(id, now);
      detected += 1;
    } catch (error) {
      oLog.error({ err: error, propertyId: id }, "opportunity detection failed");
    }
  }
  return { detected };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

export const OPEN_STATUSES: SeoOpportunityStatus[] = ["OPEN", "TASK_CREATED"];
export const STATUS_FILTERS = ["active", "OPEN", "TASK_CREATED", "DONE", "DISMISSED", "RESOLVED"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type OpportunityFilters = {
  clientId?: string;
  propertyId?: string;
  source?: SeoOpportunitySource;
  status?: StatusFilter;
  severity?: SeoSeverity;
  effort?: SeoEffort;
  assigneeId?: string | "me" | "none";
  q?: string;
};

function whereFor(actor: Actor, filters: OpportunityFilters): Prisma.SeoOpportunityWhereInput {
  const status = filters.status ?? "active";
  const where: Prisma.SeoOpportunityWhereInput = {
    property: { isActive: true, client: { deletedAt: null, ...(filters.clientId ? { id: filters.clientId } : {}) } },
    status: status === "active" ? { in: OPEN_STATUSES } : status,
  };
  if (filters.propertyId) where.propertyId = filters.propertyId;
  if (filters.source) where.source = filters.source;
  if (filters.severity) where.severity = filters.severity;
  if (filters.effort) where.effort = filters.effort;
  if (filters.assigneeId === "me") where.assigneeId = actor.userId;
  else if (filters.assigneeId === "none") where.assigneeId = null;
  else if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.q) where.OR = [{ title: { contains: filters.q, mode: "insensitive" } }, { url: { contains: filters.q, mode: "insensitive" } }, { query: { contains: filters.q, mode: "insensitive" } }];
  return where;
}

/** Agency-wide, worst first: severity, then impact. Paged in the database. */
export async function listOpportunities(actor: Actor, filters: OpportunityFilters = {}, params: Partial<PageParams> = {}) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const { page, perPage, skip, take } = toSkipTake(params);
  const where = whereFor(actor, filters);
  const [rows, total, bySource, byStatus] = await Promise.all([
    db.seoOpportunity.findMany({
      where,
      orderBy: [{ severity: "asc" }, { impact: "desc" }, { firstSeenAt: "asc" }],
      skip,
      take,
      select: {
        id: true, type: true, source: true, title: true, url: true, query: true, evidence: true, impact: true, impactUnit: true,
        severity: true, effort: true, status: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true, dismissReason: true,
        property: { select: { id: true, displayName: true, projectId: true, client: { select: { id: true, name: true } } } },
        assignee: { select: { id: true, name: true } },
        projectTask: { select: { id: true, title: true, status: true, projectId: true } },
      },
    }),
    db.seoOpportunity.count({ where }),
    db.seoOpportunity.groupBy({ by: ["source"], where: { ...where, source: undefined }, _count: { _all: true } }),
    db.seoOpportunity.groupBy({ by: ["status"], where: { ...where, status: undefined }, _count: { _all: true } }),
  ]);
  return {
    list: paged(rows, total, page, perPage),
    bySource: Object.fromEntries(bySource.map((row) => [row.source, row._count._all])) as Partial<Record<SeoOpportunitySource, number>>,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Partial<Record<SeoOpportunityStatus, number>>,
  };
}

/** Open items per website, for the portfolio view. */
export async function opportunitiesByWebsite(actor: Actor) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const rows = await db.seoOpportunity.groupBy({
    by: ["propertyId", "severity"],
    where: { status: { in: OPEN_STATUSES }, property: { isActive: true, client: { deletedAt: null } } },
    _count: { _all: true },
  });
  const properties = await db.seoProperty.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.propertyId))] } },
    select: { id: true, displayName: true, lastDetectedAt: true, client: { select: { name: true } } },
  });
  return properties
    .map((property) => {
      const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
      for (const row of rows) if (row.propertyId === property.id) counts[row.severity] += row._count._all;
      return { ...property, counts, total: counts.HIGH + counts.MEDIUM + counts.LOW };
    })
    .sort((a, b) => b.counts.HIGH - a.counts.HIGH || b.total - a.total);
}

// ---------------------------------------------------------------------------
// Acting
// ---------------------------------------------------------------------------

async function opportunityFor(id: string) {
  const row = await db.seoOpportunity.findFirst({
    where: { id, property: { client: { deletedAt: null } } },
    select: {
      id: true, status: true, title: true, url: true, query: true, evidence: true, impact: true, impactUnit: true, severity: true, type: true, source: true,
      propertyId: true, projectTaskId: true, property: { select: { clientId: true, displayName: true } },
    },
  });
  if (!row) throw new NotFoundError("That opportunity was not found.");
  return row;
}

async function setStatus(actor: Actor, id: string, data: Prisma.SeoOpportunityUpdateInput, allowed: SeoOpportunityStatus[], message: string) {
  requirePermission(actor, "seo.opportunities.manage");
  staffOnly(actor);
  const row = await opportunityFor(id);
  if (!allowed.includes(row.status)) throw new ValidationError(message);
  await withAudit({ actor, action: "STATUS_CHANGE", entityType: "SeoOpportunity", entityId: id, before: { status: row.status } }, (tx) =>
    tx.seoOpportunity.update({ where: { id }, data, select: { id: true, status: true } }),
  );
}

export async function dismissOpportunity(actor: Actor, id: string, reason: string) {
  requirePermission(actor, "seo.opportunities.manage");
  staffOnly(actor);
  const row = await opportunityFor(id);
  await setStatus(
    actor,
    id,
    { status: "DISMISSED", dismissedAt: new Date(), dismissedBy: { connect: { id: actor.userId } }, dismissReason: reason.slice(0, 500) || null, dismissedImpact: row.impact },
    ["OPEN", "TASK_CREATED"],
    "Only open opportunities can be dismissed.",
  );
}

export async function reopenOpportunity(actor: Actor, id: string) {
  await setStatus(actor, id, { status: "OPEN", dismissedAt: null, dismissedBy: { disconnect: true }, dismissReason: null, dismissedImpact: null, resolvedAt: null }, ["DISMISSED", "DONE", "RESOLVED"], "That opportunity is already open.");
}

export async function markOpportunityDone(actor: Actor, id: string) {
  await setStatus(actor, id, { status: "DONE", resolvedAt: new Date() }, ["OPEN", "TASK_CREATED"], "Only open opportunities can be marked done.");
}

export async function assignOpportunity(actor: Actor, id: string, assigneeId: string | null) {
  requirePermission(actor, "seo.opportunities.manage");
  staffOnly(actor);
  await opportunityFor(id);
  if (assigneeId) {
    const user = await db.user.findFirst({ where: { id: assigneeId, type: "STAFF", status: "ACTIVE" }, select: { id: true } });
    if (!user) throw new ValidationError("Choose an active staff member.");
  }
  await withAudit({ actor, action: "ASSIGN", entityType: "SeoOpportunity", entityId: id, after: { assigneeId } }, (tx) =>
    tx.seoOpportunity.update({ where: { id }, data: { assignee: assigneeId ? { connect: { id: assigneeId } } : { disconnect: true } }, select: { id: true } }),
  );
}

const PRIORITY: Record<SeoSeverity, "HIGH" | "MEDIUM" | "LOW"> = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

function describe(row: Awaited<ReturnType<typeof opportunityFor>>): string {
  const lines = [`SEO opportunity for ${row.property.displayName}.`];
  if (row.url) lines.push(`Page: ${row.url}`);
  if (row.query) lines.push(`Query: ${row.query}`);
  lines.push(`Impact: ${row.impact} ${row.impactUnit}${row.impactUnit === "clicks" ? " (calculated by Emporia from Search Console)" : ""}.`);
  lines.push(`Evidence: ${JSON.stringify(row.evidence).slice(0, 2_000)}`);
  return lines.join("\n");
}

/**
 * Turn an opportunity into a project task. The project must belong to the
 * website's own client; the task is created through the project service, so
 * its permissions (tasks.create, tasks.assign, project visibility) apply too.
 */
export async function createTaskFromOpportunity(
  actor: Actor,
  id: string,
  input: { projectId: string; assigneeId?: string | null; dueAt?: Date | null },
) {
  requirePermission(actor, "seo.opportunities.manage");
  staffOnly(actor);
  const row = await opportunityFor(id);
  // A finding that came back may get a new task once its old one is finished.
  if (row.projectTaskId) {
    const existing = await db.projectTask.findUnique({ where: { id: row.projectTaskId }, select: { status: true } });
    if (existing && existing.status !== "DONE" && existing.status !== "CANCELLED") throw new ValidationError("A task for this opportunity is still open.");
  }
  if (row.status !== "OPEN") throw new ValidationError("Only open opportunities can become tasks.");
  const project = await db.project.findFirst({ where: { id: input.projectId }, select: { clientId: true } });
  if (!project || project.clientId !== row.property.clientId) throw new ValidationError("Choose a project of this website's client.");
  if (input.assigneeId && !can(actor, "tasks.assign")) throw new ValidationError("You do not have permission to assign tasks.");

  const task = await saveTask(actor, null, {
    projectId: input.projectId,
    title: row.title.slice(0, 200),
    description: describe(row),
    assigneeId: input.assigneeId ?? undefined,
    status: "TODO",
    priority: PRIORITY[row.severity],
    dueAt: input.dueAt ?? null,
  });

  await db.$transaction(async (tx) => {
    await tx.seoOpportunity.update({
      where: { id },
      data: { status: "TASK_CREATED", projectTask: { connect: { id: task.id } }, ...(input.assigneeId ? { assignee: { connect: { id: input.assigneeId } } } : {}) },
    });
    await record({ actor, action: "UPDATE", entityType: "SeoOpportunity", entityId: id, before: { status: row.status }, after: { status: "TASK_CREATED", projectTaskId: task.id } }, tx);
  });
  return task;
}

/** Projects of a website's client, for the Create task form. */
export async function taskTargets(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.opportunities.manage");
  staffOnly(actor);
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { clientId: true, projectId: true } });
  if (!property) throw new NotFoundError("That website was not found.");
  const [projects, staff] = await Promise.all([
    db.project.findMany({ where: { clientId: property.clientId, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    db.user.findMany({ where: { type: "STAFF", status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { defaultProjectId: property.projectId, projects, staff };
}

/** "Detect now" from the screen. Rate limited per website: detection reads a lot. */
export async function detectNow(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.opportunities.manage");
  staffOnly(actor);
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That website was not found.");
  const limit = await checkRateLimit(`seo-detect:${propertyId}`, { limit: 3, windowMs: 10 * 60_000 });
  if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds, "Opportunities were just detected for this website. Try again in a few minutes.");
  const result = await detectOpportunities(propertyId);
  await record({ actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, after: { detected: result } });
  return result;
}
