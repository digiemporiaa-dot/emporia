import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { log } from "@/lib/logger";
import { record } from "@/lib/services/audit.service";
import { analyticsFor } from "@/lib/services/seo-intel/ga4-connection.service";
import { reportAll, type AnalyticsProvider } from "@/lib/seo-intel/providers/ga4";
import { GA4_METRICS, normalizeGa4Report, ORGANIC_CHANNEL, type Ga4Dimension, type Ga4Row } from "@/lib/seo-intel/normalize/ga4";
import { planGscSync, type SyncRange } from "@/lib/seo-intel/sync-plan";
import { eachDay, fromDbDate, todayIn, toDbDate } from "@/lib/seo-intel/dates";
import { SeoAccessError, SeoCredentialsError } from "@/lib/seo-intel/providers/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * GA4 sync (Phase 9): fetch → normalise → store, per day, exactly as the
 * Search Console sync does — a lease so one run per website at a time, each
 * day replaced whole in one transaction, the recent days re-read every run
 * (GA4 revises them for a day or two), and 16 months of history walked back
 * a month per run. Days are the GA4 property's own time zone's days.
 */

const syncLog = log("seo-sync");

/** Top landing page × channel rows per day, by sessions. Beyond this the tail is left out and the run says so. */
export const GA4_LANDING_ROWS_PER_DAY = 2_000;
export const GA4_RECENT_DAYS = 3;
const RANGE_ROWS = 50_000;
const LEASE_MS = 15 * 60_000;
const SYNC_EVERY_MS = 6 * 60 * 60_000;

export type Ga4SyncOutcome =
  | { status: "skipped"; reason: string }
  | { status: "SUCCEEDED" | "PARTIAL" | "FAILED"; daysWritten: number; rowsWritten: number; error: string | null; runId: string };

type DayRows = { channels: Ga4Row[]; countries: Ga4Row[]; devices: Ga4Row[]; landing: Ga4Row[] };

async function report(provider: AnalyticsProvider, property: string, range: { start: string; end: string }, dimensions: Ga4Dimension[], cap: number, organicOnly = false) {
  const { report: raw, truncated } = await reportAll(
    provider,
    {
      property,
      startDate: range.start,
      endDate: range.end,
      dimensions,
      metrics: [...GA4_METRICS],
      orderBySessions: true,
      ...(organicOnly ? { filter: { field: "sessionDefaultChannelGroup", value: ORGANIC_CHANNEL } } : {}),
    },
    cap,
  );
  return { ...normalizeGa4Report(raw, dimensions), truncated };
}

async function fetchRange(provider: AnalyticsProvider, property: string, range: SyncRange) {
  const [channels, countries, devices] = await Promise.all([
    report(provider, property, range, ["date", "sessionDefaultChannelGroup"], RANGE_ROWS),
    report(provider, property, range, ["date", "countryId"], RANGE_ROWS, true),
    report(provider, property, range, ["date", "deviceCategory"], RANGE_ROWS, true),
  ]);
  const byDay = new Map<string, DayRows>();
  const day = (date: string) => {
    let entry = byDay.get(date);
    if (!entry) {
      entry = { channels: [], countries: [], devices: [], landing: [] };
      byDay.set(date, entry);
    }
    return entry;
  };
  for (const row of channels.rows) day(row.date as string).channels.push(row);
  for (const row of countries.rows) day(row.date as string).countries.push(row);
  for (const row of devices.rows) day(row.date as string).devices.push(row);
  return {
    day,
    dropped: channels.dropped + countries.dropped + devices.dropped,
    truncated: channels.truncated || countries.truncated || devices.truncated,
  };
}

/** Replace one day's rows in one transaction. Returns rows written. */
async function writeDay(propertyId: string, date: string, rows: DayRows): Promise<number> {
  const day = toDbDate(date);
  const metric = (row: Ga4Row) => ({ sessions: row.sessions, engagedSessions: row.engagedSessions, keyEvents: row.keyEvents, revenue: row.revenue });
  await db.$transaction(
    async (tx) => {
      await tx.ga4DailyTotal.deleteMany({ where: { propertyId, date: day } });
      await tx.ga4LandingDaily.deleteMany({ where: { propertyId, date: day } });
      const totals = [
        ...rows.channels.map((row) => ({ propertyId, date: day, channel: row.channel as string, country: "", device: "", ...metric(row) })),
        ...rows.countries.map((row) => ({ propertyId, date: day, channel: ORGANIC_CHANNEL, country: row.country as string, device: "", ...metric(row) })),
        ...rows.devices.map((row) => ({ propertyId, date: day, channel: ORGANIC_CHANNEL, country: "", device: row.device as string, ...metric(row) })),
      ];
      if (totals.length) await tx.ga4DailyTotal.createMany({ data: totals, skipDuplicates: true });
      if (rows.landing.length) {
        await tx.ga4LandingDaily.createMany({
          data: rows.landing.map((row) => ({ propertyId, date: day, landingPage: row.landingPage as string, channel: row.channel as string, ...metric(row) })),
        });
      }
    },
    { timeout: 60_000 },
  );
  return rows.channels.length + rows.countries.length + rows.devices.length + rows.landing.length;
}

/** Sync one website's GA4 data. `provider` is a seam for tests. */
export async function syncGa4Property(
  propertyId: string,
  options: { trigger: "SCHEDULED" | "MANUAL"; provider?: AnalyticsProvider; now?: Date } = { trigger: "SCHEDULED" },
): Promise<Ga4SyncOutcome> {
  const now = options.now ?? new Date();
  const claimed = await db.seoConnection.updateMany({
    where: {
      propertyId,
      source: "ANALYTICS",
      status: "CONNECTED",
      externalId: { not: null },
      OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
    },
    data: { syncLockedUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now },
  });
  if (claimed.count === 0) return { status: "skipped", reason: "Not connected, or a sync is already running." };

  const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } } });
  const property = await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId }, select: { ga4TimeZone: true, timezone: true } });
  let today: string;
  try {
    today = todayIn(property.ga4TimeZone ?? property.timezone, now);
  } catch {
    today = todayIn("UTC", now);
  }
  const plan = planGscSync({ today, backfilledFrom: connection.backfilledFrom ? fromDbDate(connection.backfilledFrom) : null, recentDays: GA4_RECENT_DAYS });
  const run = await db.seoSyncRun.create({
    data: { propertyId, source: "ANALYTICS", trigger: options.trigger, rangeFrom: toDbDate(plan.ranges.at(-1)!.start), rangeTo: toDbDate(plan.end) },
    select: { id: true },
  });

  const provider = options.provider ?? analyticsFor(connection);
  const ga4Property = connection.externalId as string;
  let daysWritten = 0;
  let rowsWritten = 0;
  let dropped = 0;
  let truncated = false;
  let backfilledFrom = connection.backfilledFrom ? fromDbDate(connection.backfilledFrom) : null;
  let error: string | null = null;
  let needsPerson = false;

  try {
    for (const range of plan.ranges) {
      const fetched = await fetchRange(provider, ga4Property, range);
      dropped += fetched.dropped;
      truncated ||= fetched.truncated;
      for (const date of eachDay(range.start, range.end).reverse()) {
        const rows = fetched.day(date);
        // A day with no sessions has no landing pages to ask for.
        if (rows.channels.some((row) => row.sessions > 0)) {
          const landing = await report(provider, ga4Property, { start: date, end: date }, ["landingPage", "sessionDefaultChannelGroup"], GA4_LANDING_ROWS_PER_DAY);
          rows.landing = landing.rows;
          dropped += landing.dropped;
          truncated ||= landing.truncated;
        }
        rowsWritten += await writeDay(propertyId, date, rows);
        daysWritten++;
      }
      backfilledFrom = backfilledFrom && backfilledFrom < range.start ? backfilledFrom : range.start;
    }
    const oldest = toDbDate(plan.oldest);
    await db.ga4DailyTotal.deleteMany({ where: { propertyId, date: { lt: oldest } } });
    await db.ga4LandingDaily.deleteMany({ where: { propertyId, date: { lt: oldest } } });
  } catch (caught) {
    needsPerson = caught instanceof SeoCredentialsError || caught instanceof SeoAccessError;
    error =
      caught instanceof Error && "publicMessage" in caught
        ? String((caught as { publicMessage: string }).publicMessage)
        : "The sync failed unexpectedly. It will be tried again.";
    syncLog.warn({ err: caught, propertyId, runId: run.id }, "analytics sync failed");
  }

  const latest = await db.ga4DailyTotal.aggregate({ where: { propertyId, sessions: { gt: 0 } }, _max: { date: true } });
  const status = error ? (daysWritten > 0 ? "PARTIAL" : "FAILED") : "SUCCEEDED";
  const notes = [
    truncated ? `Very large site: landing pages beyond the top ${GA4_LANDING_ROWS_PER_DAY.toLocaleString("en")} a day were left out.` : null,
    dropped > 0 ? `${dropped} malformed row${dropped === 1 ? "" : "s"} from Google ignored.` : null,
  ].filter(Boolean);

  await db.$transaction([
    db.seoSyncRun.update({
      where: { id: run.id },
      data: { status, daysWritten, rowsWritten, error: [error, ...notes].filter(Boolean).join(" ") || null, finishedAt: new Date() },
    }),
    db.seoConnection.update({
      where: { id: connection.id },
      data: {
        syncLockedUntil: null,
        dataThrough: latest._max.date,
        backfilledFrom: backfilledFrom ? toDbDate(backfilledFrom) : null,
        ...(error
          ? { lastSyncError: error, failureCount: { increment: 1 }, ...(needsPerson ? { status: "ERROR" as const } : {}) }
          : { lastSyncedAt: new Date(), lastSyncError: null, failureCount: 0 }),
      },
    }),
  ]);
  syncLog.info({ propertyId, runId: run.id, status, daysWritten, rowsWritten }, "analytics sync finished");
  return { status, daysWritten, rowsWritten, error, runId: run.id };
}

export async function syncGa4Now(actor: Actor, propertyId: string): Promise<Ga4SyncOutcome> {
  requirePermission(actor, "seo.intelligence.manage");
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That SEO property does not exist.");
  const limit = await checkRateLimit(`seo-sync-ga4:${propertyId}`, { limit: 3, windowMs: 10 * 60_000 });
  if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds, "Analytics was synced a moment ago. Try again in a few minutes.");
  const outcome = await syncGa4Property(propertyId, { trigger: "MANUAL" });
  if (outcome.status === "skipped") throw new ValidationError(outcome.reason);
  await record({ actor, action: "SYNC", entityType: "SeoProperty", entityId: propertyId, after: { source: "ANALYTICS", status: outcome.status, daysWritten: outcome.daysWritten } });
  return outcome;
}

/**
 * The scheduler's job: history still filling, or the last success older than
 * six hours. A failing connection backs off — 15 minutes, doubling, at most
 * 12 hours.
 */
export async function syncDueGa4Properties(options: { limit?: number; now?: Date; provider?: AnalyticsProvider } = {}): Promise<{ synced: number; failed: number }> {
  const now = options.now ?? new Date();
  const candidates = await db.seoConnection.findMany({
    where: {
      source: "ANALYTICS",
      status: "CONNECTED",
      externalId: { not: null },
      OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
      property: { isActive: true, client: { deletedAt: null } },
    },
    select: { propertyId: true, lastSyncedAt: true, lastAttemptAt: true, failureCount: true, backfilledFrom: true },
    orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }],
    take: 50,
  });
  const plan = planGscSync({ today: todayIn("UTC", now), backfilledFrom: null });
  const due = candidates.filter((candidate) => {
    if (candidate.failureCount > 0 && candidate.lastAttemptAt) {
      const backoff = Math.min(15 * 60_000 * 2 ** (candidate.failureCount - 1), 12 * 60 * 60_000);
      if (now.getTime() - candidate.lastAttemptAt.getTime() < backoff) return false;
    }
    // "Complete" is judged against UTC days; a property's own zone is at most a day apart.
    const historyIncomplete = !candidate.backfilledFrom || fromDbDate(candidate.backfilledFrom) > plan.oldest;
    const stale = !candidate.lastSyncedAt || now.getTime() - candidate.lastSyncedAt.getTime() >= SYNC_EVERY_MS;
    return historyIncomplete || stale;
  });
  let synced = 0;
  let failed = 0;
  for (const candidate of due.slice(0, options.limit ?? 2)) {
    const outcome = await syncGa4Property(candidate.propertyId, { trigger: "SCHEDULED", now, provider: options.provider });
    if (outcome.status === "SUCCEEDED") synced++;
    else if (outcome.status !== "skipped") failed++;
  }
  return { synced, failed };
}

export async function recentGa4SyncRuns(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  return db.seoSyncRun.findMany({
    where: { propertyId, source: "ANALYTICS", property: { client: { deletedAt: null } } },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: { id: true, trigger: true, status: true, rangeFrom: true, rangeTo: true, daysWritten: true, rowsWritten: true, error: true, startedAt: true, finishedAt: true },
  });
}
