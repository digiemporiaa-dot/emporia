import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { log } from "@/lib/logger";
import { record } from "@/lib/services/audit.service";
import { searchConsoleFor } from "@/lib/services/seo-intel/gsc-connection.service";
import { queryAll } from "@/lib/seo-intel/providers/gsc";
import { normalizeGscRows, type NormalizedRow } from "@/lib/seo-intel/normalize/gsc";
import { planGscSync, type SyncRange } from "@/lib/seo-intel/sync-plan";
import { eachDay, fromDbDate, GSC_TIME_ZONE, todayIn, toDbDate } from "@/lib/seo-intel/dates";
import { SeoAccessError, SeoCredentialsError } from "@/lib/seo-intel/providers/errors";
import type { SearchConsoleProvider } from "@/lib/seo-intel/providers/types";
import type { Actor } from "@/lib/actor/types";

/**
 * Search Console sync: fetch → normalise → store, per day
 * (docs/SEO-INTELLIGENCE-PLAN.md, Part C).
 *
 * - **Stored, not live.** Screens read these tables; nothing on a page waits
 *   on Google.
 * - **One run per property at a time**, by a lease on the connection that
 *   expires on its own if a run dies.
 * - **Idempotent per day.** A day is replaced whole — its old rows deleted and
 *   the new ones written in one transaction — so re-reading a revised day, or
 *   a run repeated after a failure, never double counts.
 * - **Honest about failure.** Revoked credentials or lost access mark the
 *   connection as needing a person; a quota or outage leaves it connected and
 *   the next run retries. Either way the reason is stored and shown.
 */

const syncLog = log("seo-sync");

/** Per-day caps. Google returns the top rows by clicks; beyond this the tail is left out and the run says so. */
export const GSC_QUERY_ROWS_PER_DAY = 5_000;
export const GSC_PAGE_ROWS_PER_DAY = 5_000;
const COUNTRY_ROWS_PER_RANGE = 100_000;
const LEASE_MS = 15 * 60_000;
/** How long a connection waits between scheduled syncs once its history is complete. */
const SYNC_EVERY_MS = 6 * 60 * 60_000;

export type SyncOutcome =
  | { status: "skipped"; reason: string }
  | { status: "SUCCEEDED" | "PARTIAL" | "FAILED"; daysWritten: number; rowsWritten: number; error: string | null; runId: string };

type DayRows = {
  totals: NormalizedRow[];
  devices: NormalizedRow[];
  countries: NormalizedRow[];
  queries: NormalizedRow[];
  pages: NormalizedRow[];
};

async function fetchRange(provider: SearchConsoleProvider, siteUrl: string, range: SyncRange) {
  const base = { siteUrl, startDate: range.start, endDate: range.end };
  const [totals, devices, countries] = await Promise.all([
    queryAll(provider, { ...base, dimensions: ["date"] }, 1_000),
    queryAll(provider, { ...base, dimensions: ["date", "device"] }, 5_000),
    queryAll(provider, { ...base, dimensions: ["date", "country"] }, COUNTRY_ROWS_PER_RANGE),
  ]);

  const byDay = new Map<string, DayRows>();
  const day = (date: string) => {
    let entry = byDay.get(date);
    if (!entry) {
      entry = { totals: [], devices: [], countries: [], queries: [], pages: [] };
      byDay.set(date, entry);
    }
    return entry;
  };
  let dropped = 0;
  for (const [bucket, result, dims] of [
    ["totals", totals, ["date"]],
    ["devices", devices, ["date", "device"]],
    ["countries", countries, ["date", "country"]],
  ] as const) {
    const normalized = normalizeGscRows(result.rows, dims);
    dropped += normalized.dropped;
    for (const row of normalized.rows) day(row.date as string)[bucket].push(row);
  }
  return { byDay, day, dropped, truncated: countries.truncated };
}

async function fetchDayDetail(provider: SearchConsoleProvider, siteUrl: string, date: string) {
  const base = { siteUrl, startDate: date, endDate: date };
  const [queries, pages] = await Promise.all([
    queryAll(provider, { ...base, dimensions: ["query"] }, GSC_QUERY_ROWS_PER_DAY),
    queryAll(provider, { ...base, dimensions: ["page"] }, GSC_PAGE_ROWS_PER_DAY),
  ]);
  const q = normalizeGscRows(queries.rows, ["query"]);
  const p = normalizeGscRows(pages.rows, ["page"]);
  return { queries: q.rows, pages: p.rows, dropped: q.dropped + p.dropped, truncated: queries.truncated || pages.truncated };
}

/** Replace one day's rows for a property in one transaction. Returns rows written. */
async function writeDay(propertyId: string, date: string, rows: DayRows): Promise<number> {
  const day = toDbDate(date);
  const metric = (row: NormalizedRow) => ({ clicks: row.clicks, impressions: row.impressions, position: row.position });
  await db.$transaction(async (tx) => {
    await tx.gscDailyTotal.deleteMany({ where: { propertyId, date: day } });
    await tx.gscQueryDaily.deleteMany({ where: { propertyId, date: day } });
    await tx.gscPageDaily.deleteMany({ where: { propertyId, date: day } });
    await tx.gscDailyTotal.createMany({
      data: [
        ...rows.totals.map((row) => ({ propertyId, date: day, device: "", country: "", ...metric(row) })),
        ...rows.devices.map((row) => ({ propertyId, date: day, device: row.device as string, country: "", ...metric(row) })),
        ...rows.countries.map((row) => ({ propertyId, date: day, device: "", country: row.country as string, ...metric(row) })),
      ],
      skipDuplicates: true,
    });
    if (rows.queries.length) {
      await tx.gscQueryDaily.createMany({
        data: rows.queries.map((row) => ({ propertyId, date: day, query: row.query as string, ...metric(row) })),
        skipDuplicates: true,
      });
    }
    if (rows.pages.length) {
      await tx.gscPageDaily.createMany({
        data: rows.pages.map((row) => ({ propertyId, date: day, page: row.page as string, ...metric(row) })),
        skipDuplicates: true,
      });
    }
  }, { timeout: 60_000 });
  return rows.totals.length + rows.devices.length + rows.countries.length + rows.queries.length + rows.pages.length;
}

/**
 * Sync one property's Search Console data. `provider` is a seam for tests;
 * normally it is built from the stored connection.
 */
export async function syncGscProperty(
  propertyId: string,
  options: { trigger: "SCHEDULED" | "MANUAL"; provider?: SearchConsoleProvider; now?: Date } = { trigger: "SCHEDULED" },
): Promise<SyncOutcome> {
  const now = options.now ?? new Date();

  // The lease: only a connected, unleased connection is claimed.
  const claimed = await db.seoConnection.updateMany({
    where: {
      propertyId,
      source: "SEARCH_CONSOLE",
      status: "CONNECTED",
      externalId: { not: null },
      OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
    },
    data: { syncLockedUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now },
  });
  if (claimed.count === 0) return { status: "skipped", reason: "Not connected, or a sync is already running." };

  const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId, source: "SEARCH_CONSOLE" } } });
  const plan = planGscSync({
    today: todayIn(GSC_TIME_ZONE, now),
    backfilledFrom: connection.backfilledFrom ? fromDbDate(connection.backfilledFrom) : null,
  });
  const run = await db.seoSyncRun.create({
    data: {
      propertyId,
      source: "SEARCH_CONSOLE",
      trigger: options.trigger,
      rangeFrom: toDbDate(plan.ranges.at(-1)!.start),
      rangeTo: toDbDate(plan.end),
    },
    select: { id: true },
  });

  const provider = options.provider ?? searchConsoleFor(connection);
  const siteUrl = connection.externalId as string;
  let daysWritten = 0;
  let rowsWritten = 0;
  let dropped = 0;
  let truncated = false;
  let backfilledFrom = connection.backfilledFrom ? fromDbDate(connection.backfilledFrom) : null;
  let error: string | null = null;
  let needsPerson = false;

  try {
    for (const range of plan.ranges) {
      const fetched = await fetchRange(provider, siteUrl, range);
      dropped += fetched.dropped;
      truncated ||= fetched.truncated;
      // Newest first, so a run cut short still leaves the most useful days.
      for (const date of eachDay(range.start, range.end).reverse()) {
        const rows = fetched.day(date);
        if (rows.totals.length > 0) {
          const detail = await fetchDayDetail(provider, siteUrl, date);
          rows.queries = detail.queries;
          rows.pages = detail.pages;
          dropped += detail.dropped;
          truncated ||= detail.truncated;
        }
        rowsWritten += await writeDay(propertyId, date, rows);
        daysWritten++;
      }
      // A range counts once every day in it is written.
      backfilledFrom = backfilledFrom && backfilledFrom < range.start ? backfilledFrom : range.start;
    }

    // Nothing older than Google keeps: what it no longer has, neither do we.
    const oldest = toDbDate(plan.oldest);
    await db.gscDailyTotal.deleteMany({ where: { propertyId, date: { lt: oldest } } });
    await db.gscQueryDaily.deleteMany({ where: { propertyId, date: { lt: oldest } } });
    await db.gscPageDaily.deleteMany({ where: { propertyId, date: { lt: oldest } } });
  } catch (caught) {
    needsPerson = caught instanceof SeoCredentialsError || caught instanceof SeoAccessError;
    error =
      caught instanceof Error && "publicMessage" in caught
        ? String((caught as { publicMessage: string }).publicMessage)
        : "The sync failed unexpectedly. It will be tried again.";
    syncLog.warn({ err: caught, propertyId, runId: run.id }, "search console sync failed");
  }

  const latest = await db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } });
  const status = error ? (daysWritten > 0 ? "PARTIAL" : "FAILED") : "SUCCEEDED";
  const notes = [
    truncated ? "Very large site: the least-clicked queries and pages beyond the daily cap were left out." : null,
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
        // The cursor only moves over days that were actually written.
        backfilledFrom: backfilledFrom ? toDbDate(backfilledFrom) : null,
        ...(error
          ? { lastSyncError: error, failureCount: { increment: 1 }, ...(needsPerson ? { status: "ERROR" as const } : {}) }
          : { lastSyncedAt: new Date(), lastSyncError: null, failureCount: 0 }),
      },
    }),
  ]);

  syncLog.info({ propertyId, runId: run.id, status, daysWritten, rowsWritten }, "search console sync finished");
  return { status, daysWritten, rowsWritten, error, runId: run.id };
}

/** Sync now, from the screen. Rate limited per property: Google's quota is shared by everyone. */
export async function syncGscNow(actor: Actor, propertyId: string): Promise<SyncOutcome> {
  requirePermission(actor, "seo.intelligence.manage");
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That SEO property does not exist.");

  const limit = await checkRateLimit(`seo-sync:${propertyId}`, { limit: 3, windowMs: 10 * 60_000 });
  if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds, "This website was synced a moment ago. Try again in a few minutes.");

  const outcome = await syncGscProperty(propertyId, { trigger: "MANUAL" });
  if (outcome.status === "skipped") throw new ValidationError(outcome.reason);
  await record({ actor, action: "SYNC", entityType: "SeoProperty", entityId: propertyId, after: { source: "SEARCH_CONSOLE", status: outcome.status, daysWritten: outcome.daysWritten } });
  return outcome;
}

/**
 * The scheduler's job: properties whose data is due. Due means history still
 * filling, or the last success is older than six hours. A failing connection
 * backs off — 15 minutes, doubling, at most 12 hours — instead of hammering
 * Google every cron tick.
 */
export async function syncDueGscProperties(options: { limit?: number; now?: Date } = {}): Promise<{ synced: number; failed: number }> {
  const now = options.now ?? new Date();
  const candidates = await db.seoConnection.findMany({
    where: {
      source: "SEARCH_CONSOLE",
      status: "CONNECTED",
      externalId: { not: null },
      OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
      property: { isActive: true, client: { deletedAt: null } },
    },
    select: { propertyId: true, lastSyncedAt: true, lastAttemptAt: true, failureCount: true, backfilledFrom: true },
    orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }],
    take: 50,
  });

  const plan = planGscSync({ today: todayIn(GSC_TIME_ZONE, now), backfilledFrom: null });
  const due = candidates.filter((candidate) => {
    if (candidate.failureCount > 0 && candidate.lastAttemptAt) {
      const backoff = Math.min(15 * 60_000 * 2 ** (candidate.failureCount - 1), 12 * 60 * 60_000);
      if (now.getTime() - candidate.lastAttemptAt.getTime() < backoff) return false;
    }
    const historyIncomplete = !candidate.backfilledFrom || fromDbDate(candidate.backfilledFrom) > plan.oldest;
    const stale = !candidate.lastSyncedAt || now.getTime() - candidate.lastSyncedAt.getTime() >= SYNC_EVERY_MS;
    return historyIncomplete || stale;
  });

  let synced = 0;
  let failed = 0;
  for (const candidate of due.slice(0, options.limit ?? 2)) {
    const outcome = await syncGscProperty(candidate.propertyId, { trigger: "SCHEDULED", now });
    if (outcome.status === "SUCCEEDED") synced++;
    else if (outcome.status !== "skipped") failed++;
  }
  return { synced, failed };
}

/** The last few runs, for the screen. */
export async function recentGscSyncRuns(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  return db.seoSyncRun.findMany({
    where: { propertyId, source: "SEARCH_CONSOLE", property: { client: { deletedAt: null } } },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: { id: true, trigger: true, status: true, rangeFrom: true, rangeTo: true, daysWritten: true, rowsWritten: true, error: true, startedAt: true, finishedAt: true },
  });
}
