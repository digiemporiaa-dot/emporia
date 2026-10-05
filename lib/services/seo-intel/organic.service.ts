import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { Decimal, toMoneyString, ZERO } from "@/lib/money";
import { visibilityFilter } from "@/lib/services/crm.service";
import { convertingLeads, landingKey, revenueByClient } from "@/lib/services/analytics.service";
import { landingStatsByPath } from "@/lib/services/seo-intel/ga4-read.service";
import { addDays, eachDay, fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import { resolvePeriod, type DayRange, type ResolvedPeriod, type SeoPeriod } from "@/lib/seo-intel/periods";
import { isOrganicTouch, rate, urlPathKey } from "@/lib/seo-intel/engine/organic";
import { ORGANIC_CHANNEL } from "@/lib/seo-intel/normalize/ga4";
import type { Actor } from "@/lib/actor/types";

/**
 * Organic search → traffic, leads and revenue (Phase 9).
 *
 * Two halves, never mixed:
 *  - **GA4**, for any website: organic sessions, engagement, key events and
 *    GA4's own revenue figure, in the GA4 property's currency.
 *  - **The CRM**, for the agency's own website only (its leads are the only
 *    ones Emporia captures): leads whose first touch was organic search, and
 *    the opportunities, clients and captured payments that followed — every
 *    arrow a foreign key. Payment revenue needs `invoices.view`.
 *
 * Keywords appear as context: the Search Console queries a landing page
 * ranks for. Leads and revenue are never divided among them (decided
 * 2026-10-05).
 */

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

const between = (range: DayRange) => Prisma.sql`date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date`;
const num = (value: unknown) => Number(value ?? 0);
const dec = (value: { toString(): string } | null | undefined) => new Decimal(value?.toString() ?? "0");

type ChannelRow = { channel: string; sessions: bigint | number | null; engaged: bigint | number | null; keyEvents: number | null; revenue: { toString(): string } | null };

export type Ga4Kpis = { sessions: number; engagedSessions: number; keyEvents: number; revenue: string; engagementRate: number | null; keyEventRate: number | null };

const EMPTY_KPIS: Ga4Kpis = { sessions: 0, engagedSessions: 0, keyEvents: 0, revenue: "0.00", engagementRate: null, keyEventRate: null };

function kpisOf(row: ChannelRow | undefined): Ga4Kpis {
  if (!row) return EMPTY_KPIS;
  const sessions = num(row.sessions);
  const engagedSessions = num(row.engaged);
  const keyEvents = num(row.keyEvents);
  return { sessions, engagedSessions, keyEvents, revenue: toMoneyString(dec(row.revenue)), engagementRate: rate(engagedSessions, sessions), keyEventRate: rate(keyEvents, sessions) };
}

async function channelTotals(propertyId: string, range: DayRange) {
  return db.$queryRaw<ChannelRow[]>(Prisma.sql`
    SELECT channel, SUM(sessions) AS sessions, SUM("engagedSessions") AS engaged, SUM("keyEvents") AS "keyEvents", SUM(revenue) AS revenue
    FROM "Ga4DailyTotal"
    WHERE "propertyId" = ${propertyId} AND country = '' AND device = '' AND ${between(range)}
    GROUP BY channel`);
}

export async function latestGa4Day(propertyId: string): Promise<string | null> {
  const latest = await db.ga4DailyTotal.aggregate({ where: { propertyId, sessions: { gt: 0 } }, _max: { date: true } });
  return latest._max.date ? fromDbDate(latest._max.date) : null;
}

type QueryRow = { query: string; page: string; clicks: bigint | number | null; impressions: bigint | number | null };

/** Search Console clicks and impressions per landing path, and each path's top queries. */
async function searchConsoleByPath(propertyId: string, range: DayRange, paths: Set<string>) {
  const [pages, pairs] = await Promise.all([
    db.$queryRaw<{ page: string; clicks: bigint | number | null; impressions: bigint | number | null }[]>(Prisma.sql`
      SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions FROM "GscPageDaily"
      WHERE "propertyId" = ${propertyId} AND ${between(range)} GROUP BY page`),
    db.$queryRaw<QueryRow[]>(Prisma.sql`
      SELECT query, page, SUM(clicks) AS clicks, SUM(impressions) AS impressions FROM "GscQueryPageDaily"
      WHERE "propertyId" = ${propertyId} AND ${between(range)}
      GROUP BY query, page ORDER BY SUM(clicks) DESC, SUM(impressions) DESC LIMIT 20000`),
  ]);
  const totals = new Map<string, { clicks: number; impressions: number }>();
  for (const row of pages) {
    const key = urlPathKey(row.page);
    if (!key || !paths.has(key)) continue;
    const entry = totals.get(key) ?? { clicks: 0, impressions: 0 };
    entry.clicks += num(row.clicks);
    entry.impressions += num(row.impressions);
    totals.set(key, entry);
  }
  const queries = new Map<string, { query: string; clicks: number; impressions: number }[]>();
  for (const row of pairs) {
    const key = urlPathKey(row.page);
    if (!key || !paths.has(key)) continue;
    const list = queries.get(key) ?? [];
    if (list.length < 3 && !list.some((q) => q.query === row.query)) list.push({ query: row.query, clicks: num(row.clicks), impressions: num(row.impressions) });
    queries.set(key, list);
  }
  return { totals, queries };
}

/** The GA4 half, without an actor: callers scope the website. */
export async function computeGa4Organic(propertyId: string, period: SeoPeriod = "28d") {
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: { id: true, ga4Currency: true, client: { select: { isInternal: true } }, connections: { where: { source: "ANALYTICS" }, select: { status: true, lastSyncError: true, lastSyncedAt: true } } },
  });
  if (!property) throw new NotFoundError("That website was not found.");
  const connection = property.connections[0] ?? null;
  const latest = await latestGa4Day(propertyId);
  if (!latest) {
    return connection
      ? { state: "no-data" as const, connection, isInternal: property.client.isInternal }
      : { state: "not-connected" as const, connection, isInternal: property.client.isInternal };
  }

  const resolved = resolvePeriod(period, latest);
  const [current, previous, trendRows, countryRows, deviceRows, landing] = await Promise.all([
    channelTotals(propertyId, resolved.current),
    channelTotals(propertyId, resolved.previous),
    db.ga4DailyTotal.findMany({ where: { propertyId, channel: ORGANIC_CHANNEL, country: "", device: "", date: { gte: toDbDate(resolved.current.start), lte: toDbDate(resolved.current.end) } }, select: { date: true, sessions: true } }),
    db.$queryRaw<ChannelRow[]>(Prisma.sql`
      SELECT country AS channel, SUM(sessions) AS sessions, SUM("engagedSessions") AS engaged, SUM("keyEvents") AS "keyEvents", SUM(revenue) AS revenue
      FROM "Ga4DailyTotal" WHERE "propertyId" = ${propertyId} AND channel = ${ORGANIC_CHANNEL} AND country <> '' AND ${between(resolved.current)}
      GROUP BY country ORDER BY SUM(sessions) DESC LIMIT 25`),
    db.$queryRaw<ChannelRow[]>(Prisma.sql`
      SELECT device AS channel, SUM(sessions) AS sessions, SUM("engagedSessions") AS engaged, SUM("keyEvents") AS "keyEvents", SUM(revenue) AS revenue
      FROM "Ga4DailyTotal" WHERE "propertyId" = ${propertyId} AND channel = ${ORGANIC_CHANNEL} AND device <> '' AND ${between(resolved.current)}
      GROUP BY device ORDER BY SUM(sessions) DESC`),
    landingStatsByPath(propertyId, resolved.current, ORGANIC_CHANNEL),
  ]);

  const top = [...landing].sort((a, b) => b[1].sessions - a[1].sessions || a[0].localeCompare(b[0])).slice(0, 50);
  const gsc = await searchConsoleByPath(propertyId, resolved.current, new Set(top.map(([path]) => path)));
  const trendByDay = new Map(trendRows.map((row) => [fromDbDate(row.date), row.sessions]));
  const allSessions = current.reduce((sum, row) => sum + num(row.sessions), 0);
  const organic = kpisOf(current.find((row) => row.channel === ORGANIC_CHANNEL));

  return {
    state: "ready" as const,
    connection,
    isInternal: property.client.isInternal,
    currency: property.ga4Currency,
    period: resolved,
    current: organic,
    previous: kpisOf(previous.find((row) => row.channel === ORGANIC_CHANNEL)),
    allSessions,
    organicShare: rate(organic.sessions, allSessions),
    channels: current.map((row) => ({ channel: row.channel, sessions: num(row.sessions) })).sort((a, b) => b.sessions - a.sessions),
    trend: eachDay(resolved.current.start, resolved.current.end).map((day) => ({ day, value: trendByDay.get(day) ?? 0 })),
    landing: top.map(([path, stats]) => ({
      path,
      ...stats,
      keyEventRate: rate(stats.keyEvents, stats.sessions),
      search: gsc.totals.get(path) ?? null,
      queries: gsc.queries.get(path) ?? [],
    })),
    landingPages: landing.size,
    countries: countryRows.map((row) => ({ country: row.channel, ...kpisOf(row) })),
    devices: deviceRows.map((row) => ({ device: row.channel, ...kpisOf(row) })),
  };
}

export async function ga4OrganicOverview(actor: Actor, propertyId: string, period: SeoPeriod = "28d") {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  return computeGa4Organic(propertyId, period);
}

// ---------------------------------------------------------------------------
// The CRM half — the agency's own website
// ---------------------------------------------------------------------------

const QUALIFIED = new Set(["QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"]);
const NONE = "__none__";

type Bucket = { leads: number; qualified: number; opportunities: number; clients: number; revenue: Decimal; revenueClients: number };
const blank = (): Bucket => ({ leads: 0, qualified: 0, opportunities: 0, clients: 0, revenue: ZERO, revenueClients: 0 });

/** The days the CRM half covers: the GA4 period when there is one, else the 28 days to yesterday (UTC). */
export function crmPeriod(ga4Period: ResolvedPeriod | null, now = new Date()): ResolvedPeriod {
  return ga4Period ?? resolvePeriod("28d", addDays(now.toISOString().slice(0, 10), -1));
}

export async function crmOrganicFunnel(actor: Actor, propertyId: string, period: ResolvedPeriod) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true, client: { select: { isInternal: true } } } });
  if (!property) throw new NotFoundError("That website was not found.");
  if (!property.client.isInternal) return { state: "not-applicable" as const };
  if (!can(actor, "analytics.view")) return { state: "no-permission" as const };

  const scope = visibilityFilter(actor);
  const seesMoney = can(actor, "invoices.view");
  const from = toDbDate(period.current.start);
  const to = toDbDate(addDays(period.current.end, 1));

  const [leads, converting, revenue, sessions] = await Promise.all([
    db.lead.findMany({
      where: { ...scope, deletedAt: null, createdAt: { gte: from, lt: to } },
      select: {
        status: true,
        landingPath: true,
        serviceId: true,
        cityId: true,
        campaignId: true,
        convertedClientId: true,
        firstTouch: { select: { source: true, medium: true, referrer: true } },
        _count: { select: { opportunities: true } },
      },
    }),
    seesMoney ? convertingLeads(scope) : Promise.resolve([]),
    // The range applies to the money, like every revenue figure in Analytics.
    seesMoney ? revenueByClient({ preset: "all", from, to }) : Promise.resolve(null),
    landingStatsByPath(propertyId, period.current, ORGANIC_CHANNEL),
  ]);

  const organic = leads.filter((lead) => isOrganicTouch(lead.firstTouch));
  const dims = { landing: new Map<string, Bucket>(), service: new Map<string, Bucket>(), city: new Map<string, Bucket>(), campaign: new Map<string, Bucket>() };
  const keys = (lead: { landingPath: string | null; serviceId: string | null; cityId: string | null; campaignId: string | null }) =>
    [
      [dims.landing, landingKey(lead.landingPath)],
      [dims.service, lead.serviceId ?? NONE],
      [dims.city, lead.cityId ?? NONE],
      [dims.campaign, lead.campaignId ?? NONE],
    ] as const;
  const funnel = blank();
  for (const lead of organic) {
    const qualified = QUALIFIED.has(lead.status);
    const opportunity = lead._count.opportunities > 0;
    const client = lead.convertedClientId !== null;
    for (const bucket of [funnel, ...keys(lead).map(([map, key]) => map.get(key) ?? map.set(key, blank()).get(key)!)]) {
      bucket.leads += 1;
      if (qualified) bucket.qualified += 1;
      if (opportunity) bucket.opportunities += 1;
      if (client) bucket.clients += 1;
    }
  }

  // Revenue: payments in the period from clients whose converting lead (the
  // earliest, attributed once) arrived through organic search.
  if (revenue && converting.length) {
    const touches = await db.lead.findMany({ where: { id: { in: converting.map((c) => c.leadId) } }, select: { id: true, firstTouch: { select: { source: true, medium: true, referrer: true } } } });
    const organicIds = new Set(touches.filter((t) => isOrganicTouch(t.firstTouch)).map((t) => t.id));
    for (const lead of converting) {
      const received = revenue.received.get(lead.clientId);
      if (!organicIds.has(lead.leadId) || !received || received.isZero()) continue;
      for (const bucket of [funnel, ...keys(lead).map(([map, key]) => map.get(key) ?? map.set(key, blank()).get(key)!)]) {
        bucket.revenue = bucket.revenue.plus(received);
        bucket.revenueClients += 1;
      }
    }
  }

  const ids = (map: Map<string, Bucket>) => [...map.keys()].filter((key) => key !== NONE);
  const [services, cities, campaigns] = await Promise.all([
    db.service.findMany({ where: { id: { in: ids(dims.service) } }, select: { id: true, name: true } }),
    db.city.findMany({ where: { id: { in: ids(dims.city) } }, select: { id: true, name: true } }),
    db.campaign.findMany({ where: { id: { in: ids(dims.campaign) } }, select: { id: true, name: true } }),
  ]);
  const names = { service: new Map(services.map((s) => [s.id, s.name])), city: new Map(cities.map((c) => [c.id, c.name])), campaign: new Map(campaigns.map((c) => [c.id, c.name])) };
  const out = (bucket: Bucket) => ({ ...bucket, revenue: seesMoney ? toMoneyString(bucket.revenue) : null });
  const rows = (map: Map<string, Bucket>, label: (key: string) => string) =>
    [...map]
      .map(([key, bucket]) => ({ key, label: label(key), ...out(bucket) }))
      .sort((a, b) => (b.revenue && a.revenue ? new Decimal(b.revenue).comparedTo(new Decimal(a.revenue)) : 0) || b.leads - a.leads || a.label.localeCompare(b.label));

  const landingPaths = new Set([...dims.landing.keys()].filter((key) => key !== NONE));
  const gsc = await searchConsoleByPath(propertyId, period.current, landingPaths);

  return {
    state: "ready" as const,
    period,
    seesMoney,
    totalLeads: leads.length,
    unknownSource: leads.filter((lead) => !lead.firstTouch).length,
    funnel: out(funnel),
    landing: rows(dims.landing, (key) => (key === NONE ? "Unknown page" : key)).map((row) => {
      const organicSessions = row.key === NONE ? null : (sessions.get(row.key)?.sessions ?? null);
      return { ...row, sessions: organicSessions, leadRate: organicSessions ? row.leads / organicSessions : null, queries: gsc.queries.get(row.key) ?? [] };
    }),
    service: rows(dims.service, (key) => (key === NONE ? "No service" : (names.service.get(key) ?? "Deleted"))),
    city: rows(dims.city, (key) => (key === NONE ? "No city" : (names.city.get(key) ?? "Deleted"))),
    campaign: rows(dims.campaign, (key) => (key === NONE ? "No campaign" : (names.campaign.get(key) ?? "Deleted"))),
  };
}
