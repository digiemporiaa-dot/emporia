import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import { periodSummary, type PeriodSummary } from "@/lib/services/social-summary.service";
import { CALENDAR_TIME_ZONE, startOfZonedDay, zonedDay, ymdKey } from "@/lib/social/calendar";
import { readReportData, socialReportDataSchema, type SocialReportData } from "@/lib/social/report-doc";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Monthly social reports (brief §32–33).
 *
 * A report is generated from stored metrics and stored content by
 * `periodSummary` — the same numbers the Overview shows — and frozen, so what
 * a client read does not shift when a late snapshot lands. No model writes any
 * part of it; the only human text is the optional notes. Staff generate and
 * publish (`social.reports.manage`); a client sees only *published* reports,
 * of their own client, scoped by their session.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** How far back a report can be generated. */
const MAX_MONTHS_BACK = 24;

type YM = { year: number; month: number };
const ym = (value: string): YM => {
  const [year, month] = value.split("-").map(Number) as [number, number];
  return { year, month };
};
const key = ({ year, month }: YM) => `${year}-${String(month).padStart(2, "0")}`;
const shift = ({ year, month }: YM, by: number): YM => {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};
const start = (m: YM) => startOfZonedDay({ year: m.year, month: m.month, day: 1 }, CALENDAR_TIME_ZONE);

/** Completed months a report can be generated for, newest first. */
export function reportableMonths(now = new Date()): string[] {
  const today = zonedDay(now, CALENDAR_TIME_ZONE);
  const current = { year: today.year, month: today.month };
  return Array.from({ length: MAX_MONTHS_BACK }, (_, i) => key(shift(current, -(i + 1))));
}

function figures(summary: PeriodSummary): SocialReportData["current"] {
  return {
    posts: summary.posts,
    measured: summary.measured,
    reach: summary.totals.reach,
    impressions: summary.totals.impressions,
    engagement: summary.totals.engagement,
    followersGained: summary.totals.followersGained,
    rate: summary.rate,
  };
}

async function buildData(clientId: string, clientName: string, month: string, now: Date): Promise<SocialReportData> {
  const m = ym(month);
  const [current, previous] = await Promise.all([
    periodSummary(clientId, start(m), start(shift(m, 1))),
    periodSummary(clientId, start(shift(m, -1)), start(m)),
  ]);

  // The following month, as it is planned right now.
  const next = shift(m, 1);
  const planned = await db.contentCalendarItem.findMany({
    where: { clientId, scheduledFor: { gte: start(next), lt: start(shift(next, 1)) } },
    orderBy: { scheduledFor: "asc" },
    select: { title: true, scheduledFor: true, stage: true, socialPosts: { select: { provider: true } } },
  });
  const stages = new Map<string, number>();
  for (const item of planned) stages.set(item.stage, (stages.get(item.stage) ?? 0) + 1);

  return socialReportDataSchema.parse({
    version: 1,
    clientName,
    month,
    generatedAt: now.toISOString(),
    current: figures(current),
    previous: figures(previous),
    byProvider: current.byProvider,
    topPost: current.topPost
      ? {
          title: current.topPost.title,
          provider: current.topPost.provider,
          type: current.topPost.type,
          publishedAt: current.topPost.publishedAt,
          externalUrl: current.topPost.externalUrl,
          reach: current.topPost.reach,
          engagement: current.topPost.engagement,
          rate: current.topPost.rate,
        }
      : null,
    topPlatform: current.topPlatform,
    topCampaign: current.topCampaign ? { name: current.topCampaign.name, rate: current.topCampaign.rate } : null,
    content: {
      formats: current.formats.map((f) => ({ provider: f.provider, type: f.type, posts: f.posts, avgRate: f.avgRate })).slice(0, 60),
      campaigns: current.campaigns.map((c) => ({ name: c.name, posts: c.posts, rate: c.rate })).slice(0, 50),
      pillars: current.pillars.slice(0, 50),
    },
    nextMonth: {
      month: key(next),
      ideas: planned.length,
      versions: planned.reduce((sum, item) => sum + item.socialPosts.length, 0),
      byStage: [...stages.entries()].map(([stage, ideas]) => ({ stage, ideas })),
      items: planned.slice(0, 40).map((item) => ({
        title: item.title,
        day: item.scheduledFor ? ymdKey(zonedDay(item.scheduledFor, CALENDAR_TIME_ZONE)) : null,
        stage: item.stage,
        platforms: [...new Set(item.socialPosts.map((p) => p.provider))] as SocialProvider[],
      })),
    },
    truncated: current.truncated || previous.truncated,
  });
}

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF") throw new NotFoundError("That report does not exist.");
}

/** Generate — or regenerate, while it is a draft — a client's report for a completed month. */
export async function generateReport(actor: Actor, input: { clientId: string; month: string }, now = new Date()) {
  requirePermission(actor, "social.reports.manage");
  staffOnly(actor);
  const scope = await resolveClientScope(actor, input.clientId);
  if (!MONTH.test(input.month) || !reportableMonths(now).includes(input.month)) {
    throw new ValidationError(`Choose a completed month from the last ${MAX_MONTHS_BACK}.`);
  }

  const existing = await db.socialReport.findUnique({
    where: { clientId_month: { clientId: scope, month: input.month } },
    select: { id: true, status: true },
  });
  if (existing?.status === "PUBLISHED") {
    throw new ConflictError("This report is published. Unpublish it before generating it again.");
  }

  const client = await db.client.findUniqueOrThrow({ where: { id: scope }, select: { name: true } });
  const data = await buildData(scope, client.name, input.month, now);

  return withAudit(
    {
      actor,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "SocialReport",
      entityId: existing?.id ?? `${scope}:${input.month}`,
      after: { month: input.month, regenerated: Boolean(existing), posts: data.current.posts },
    },
    (tx) =>
      tx.socialReport.upsert({
        where: { clientId_month: { clientId: scope, month: input.month } },
        create: { clientId: scope, month: input.month, data, generatedById: actor.userId, generatedAt: now },
        update: { data, generatedById: actor.userId, generatedAt: now },
        select: { id: true, month: true },
      }),
  );
}

async function draftOrPublished(actor: Actor, reportId: string) {
  requirePermission(actor, "social.reports.manage");
  staffOnly(actor);
  const report = await db.socialReport.findUnique({ where: { id: reportId }, select: { id: true, clientId: true, status: true, month: true } });
  if (!report) throw new NotFoundError("That report does not exist.");
  await resolveClientScope(actor, report.clientId);
  return report;
}

/** The report's one human-written part. Plain text; drafts only. */
export async function setReportNotes(actor: Actor, reportId: string, notes: string | null) {
  const report = await draftOrPublished(actor, reportId);
  if (report.status !== "DRAFT") throw new ConflictError("Unpublish the report before changing its notes.");
  const text = notes?.trim() ? notes.trim().slice(0, 5_000) : null;
  return withAudit(
    { actor, action: "UPDATE", entityType: "SocialReport", entityId: reportId, after: { notes: text ? "set" : "cleared" } },
    (tx) => tx.socialReport.update({ where: { id: reportId }, data: { notes: text }, select: { id: true } }),
  );
}

/** Put the report in front of the client, or take it back. */
export async function setReportPublished(actor: Actor, reportId: string, published: boolean) {
  const report = await draftOrPublished(actor, reportId);
  if ((report.status === "PUBLISHED") === published) {
    throw new ConflictError(published ? "This report is already published." : "This report is not published.");
  }
  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "SocialReport",
      entityId: reportId,
      before: { status: report.status },
      after: { status: published ? "PUBLISHED" : "DRAFT", month: report.month },
    },
    (tx) =>
      tx.socialReport.update({
        where: { id: reportId },
        data: published
          ? { status: "PUBLISHED", publishedAt: new Date(), publishedById: actor.userId }
          : { status: "DRAFT", publishedAt: null, publishedById: null },
        select: { id: true, status: true },
      }),
  );
}

/** A client's reports, newest month first, for staff. */
export async function listReports(actor: Actor, clientId: string) {
  requirePermission(actor, "social.reports.view");
  staffOnly(actor);
  const scope = await resolveClientScope(actor, clientId);
  return db.socialReport.findMany({
    where: { clientId: scope },
    orderBy: { month: "desc" },
    select: {
      id: true,
      month: true,
      status: true,
      generatedAt: true,
      publishedAt: true,
      generatedBy: { select: { name: true } },
    },
  });
}

/** Published reports for the signed-in client — the session decides whose. */
export async function portalReports(actor: PortalActor) {
  return db.socialReport.findMany({
    where: { clientId: actor.clientId, status: "PUBLISHED" },
    orderBy: { month: "desc" },
    select: { id: true, month: true, publishedAt: true },
  });
}

/**
 * One report, for whoever may read it: staff with `social.reports.view`
 * within their scope, or a client reading their own published report. Any
 * other case is "not found" — the same answer as an id that does not exist.
 */
export async function getReport(actor: Actor, reportId: string) {
  const report = await db.socialReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      clientId: true,
      month: true,
      status: true,
      data: true,
      notes: true,
      generatedAt: true,
      publishedAt: true,
      generatedBy: { select: { name: true } },
    },
  });
  if (!report) throw new NotFoundError("That report does not exist.");

  if (actor.type === "CLIENT") {
    if (!actor.clientId || report.clientId !== actor.clientId || report.status !== "PUBLISHED") {
      throw new NotFoundError("That report does not exist.");
    }
  } else {
    requirePermission(actor, "social.reports.view");
    await resolveClientScope(actor, report.clientId);
  }

  const data = readReportData(report.data);
  if (!data) throw new NotFoundError("That report could not be read.");
  return { ...report, data };
}
