import "server-only";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth/rbac";
import { visibilityFilter } from "@/lib/services/crm.service";
import { Decimal, div, mul, toMoneyString, ZERO } from "@/lib/money";
import { rangeFilter, type DateRange } from "@/lib/analytics/range";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Analytics.
 *
 * Everything here is read from the database. Nothing is estimated, modelled or
 * back-filled: a dimension with no data reports no data, and the screen says so
 * (CLAUDE.md 2 rule 5).
 *
 * Two authorization rules shape the shape of the results:
 *
 *  - Lead figures are filtered by `visibilityFilter`, so an actor who may only
 *    see their own leads gets analytics over their own leads.
 *  - Revenue is `null` — not zero, not omitted — for an actor without
 *    `invoices.view`. A marketing manager holds `analytics.view` and no
 *    finance permission, and must not learn what clients pay by reading a
 *    breakdown (CLAUDE.md 2 rule 2).
 *
 * Money is Decimal throughout and leaves as fixed-precision strings.
 */

// ---------------------------------------------------------------------------
// Revenue attribution
// ---------------------------------------------------------------------------

/**
 * Money received per client in the range, and which lead each client is
 * attributed to.
 *
 * A client can be converted from more than one lead. Attributing its revenue to
 * every one of them would count the same money repeatedly, so each client is
 * attributed once, to the lead that converted it first.
 */
async function revenueByClient(
  range: DateRange,
): Promise<{ received: Map<string, Decimal>; total: Decimal }> {
  const rows = await db.payment.groupBy({
    by: ["clientId"],
    where: { status: "CAPTURED", receivedAt: rangeFilter(range) },
    _sum: { amount: true },
  });

  const received = new Map<string, Decimal>();
  let total = ZERO;

  for (const row of rows) {
    const amount = new Decimal(row._sum.amount?.toString() ?? "0");
    received.set(row.clientId, amount);
    total = total.plus(amount);
  }

  return { received, total };
}

type ConvertingLead = {
  clientId: string;
  landingPath: string | null;
  sourceId: string;
  serviceId: string | null;
  cityId: string | null;
  campaignId: string | null;
  popupId: string | null;
  assignedToId: string | null;
};

/** One lead per converted client — the earliest conversion wins. */
async function convertingLeads(where: Prisma.LeadWhereInput): Promise<ConvertingLead[]> {
  const rows = await db.lead.findMany({
    where: { ...where, deletedAt: null, convertedClientId: { not: null } },
    orderBy: [{ convertedAt: "asc" }, { createdAt: "asc" }],
    select: {
      convertedClientId: true,
      landingPath: true,
      sourceId: true,
      serviceId: true,
      cityId: true,
      campaignId: true,
      popupId: true,
      assignedToId: true,
    },
  });

  const seen = new Set<string>();
  const first: ConvertingLead[] = [];

  for (const row of rows) {
    const clientId = row.convertedClientId;
    if (!clientId || seen.has(clientId)) continue;
    seen.add(clientId);
    first.push({ ...row, clientId });
  }

  return first;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type Overview = {
  leads: number;
  qualified: number;
  won: number;
  lost: number;
  /** Percentage with one decimal, e.g. "12.5". Null when there are no leads. */
  conversionRate: string | null;
  /** Stated budget on leads still in play. */
  pipelineValue: string;
  /** Money actually received in the range. Null without `invoices.view`. */
  revenue: string | null;
  /** Outstanding across every unpaid invoice, not range-limited. */
  outstanding: string | null;
  activeClients: number;
  activeProjects: number;
  tasksDue: number;
  tasksOverdue: number;
  /** True when the actor sees only their own leads. */
  ownLeadsOnly: boolean;
};

const OPEN_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] as const;

export async function overview(actor: Actor, range: DateRange): Promise<Overview> {
  requirePermission(actor, "analytics.view");

  const scope = visibilityFilter(actor);
  const leadWhere: Prisma.LeadWhereInput = {
    ...scope,
    deletedAt: null,
    createdAt: rangeFilter(range),
  };

  const seesMoney = can(actor, "invoices.view");
  const now = new Date();

  const [byStatus, pipeline, clients, projects, due, overdue, money] = await Promise.all([
    db.lead.groupBy({ by: ["status"], where: leadWhere, _count: { _all: true } }),
    db.lead.aggregate({
      where: { ...leadWhere, status: { in: [...OPEN_STAGES] } },
      _sum: { budget: true },
    }),
    db.client.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    db.project.count({ where: { status: { in: ["PLANNING", "ACTIVE"] } } }),
    // Cancelled tasks are not outstanding work, so they are not "due" either.
    db.projectTask.count({
      where: { status: { notIn: ["DONE", "CANCELLED"] }, dueAt: { gte: now, lt: addDays(now, 7) } },
    }),
    db.projectTask.count({
      where: { status: { notIn: ["DONE", "CANCELLED"] }, dueAt: { lt: now } },
    }),
    seesMoney
      ? Promise.all([
          revenueByClient(range),
          db.invoice.aggregate({
            where: { deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
            _sum: { dueTotal: true },
          }),
        ])
      : Promise.resolve(null),
  ]);

  const counts: Record<string, number> = {};
  let leads = 0;
  for (const row of byStatus) {
    counts[row.status] = row._count._all;
    leads += row._count._all;
  }

  const won = counts["WON"] ?? 0;

  return {
    leads,
    qualified: counts["QUALIFIED"] ?? 0,
    won,
    lost: counts["LOST"] ?? 0,
    // Left null rather than shown as 0% when nothing has come in: a rate over
    // zero leads is not a measurement.
    conversionRate: leads === 0 ? null : mul(div(won, leads), 100).toFixed(1),
    pipelineValue: toMoneyString(pipeline._sum.budget ?? 0),
    revenue: money ? toMoneyString(money[0].total) : null,
    outstanding: money ? toMoneyString(money[1]._sum.dueTotal ?? 0) : null,
    activeClients: clients,
    activeProjects: projects,
    tasksDue: due,
    tasksOverdue: overdue,
    ownLeadsOnly: Object.keys(scope).length > 0,
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export type BreakdownRow = {
  id: string;
  label: string;
  leads: number;
  qualified: number;
  won: number;
  /** Stated budget across the dimension's leads. */
  pipelineValue: string;
  /** Money received from clients this dimension produced. Null without `invoices.view`. */
  revenue: string | null;
  /** Won ÷ leads as a percentage with one decimal. Null when there are no leads. */
  conversionRate: string | null;
};

export type Breakdowns = {
  source: BreakdownRow[];
  service: BreakdownRow[];
  city: BreakdownRow[];
  campaign: BreakdownRow[];
  popup: BreakdownRow[];
  owner: BreakdownRow[];
  /** True when revenue was withheld because the actor cannot see finance. */
  revenueWithheld: boolean;
};

type Bucket = {
  leads: number;
  qualified: number;
  won: number;
  pipelineValue: Decimal;
  revenue: Decimal;
};

const UNATTRIBUTED = "__none__";

function emptyBucket(): Bucket {
  return { leads: 0, qualified: 0, won: 0, pipelineValue: ZERO, revenue: ZERO };
}

/**
 * Every breakdown in one pass.
 *
 * The leads are read once and bucketed in memory rather than run as six
 * separate grouped queries plus six revenue joins — and it keeps the revenue
 * attribution rule (one client, one lead) in exactly one place.
 */
export async function breakdowns(actor: Actor, range: DateRange): Promise<Breakdowns> {
  requirePermission(actor, "analytics.view");

  const scope = visibilityFilter(actor);
  const seesMoney = can(actor, "invoices.view");

  const leadWhere: Prisma.LeadWhereInput = {
    ...scope,
    deletedAt: null,
    createdAt: rangeFilter(range),
  };

  const [leads, labels, revenue, converting] = await Promise.all([
    db.lead.findMany({
      where: leadWhere,
      select: {
        status: true,
        budget: true,
        sourceId: true,
        serviceId: true,
        cityId: true,
        campaignId: true,
        popupId: true,
        assignedToId: true,
      },
    }),
    loadLabels(),
    seesMoney ? revenueByClient(range) : Promise.resolve(null),
    // Revenue is attributed by who *converted* the client, which may be a lead
    // created before this range. The range applies to the money, not the lead.
    seesMoney ? convertingLeads(scope) : Promise.resolve([]),
  ]);

  const dims = ["source", "service", "city", "campaign", "popup", "owner"] as const;
  const buckets: Record<(typeof dims)[number], Map<string, Bucket>> = {
    source: new Map(),
    service: new Map(),
    city: new Map(),
    campaign: new Map(),
    popup: new Map(),
    owner: new Map(),
  };

  const keyFor = (
    lead: { sourceId: string; serviceId: string | null; cityId: string | null; campaignId: string | null; popupId: string | null; assignedToId: string | null },
    dim: (typeof dims)[number],
  ): string => {
    switch (dim) {
      case "source":
        return lead.sourceId;
      case "service":
        return lead.serviceId ?? UNATTRIBUTED;
      case "city":
        return lead.cityId ?? UNATTRIBUTED;
      case "campaign":
        return lead.campaignId ?? UNATTRIBUTED;
      case "popup":
        return lead.popupId ?? UNATTRIBUTED;
      case "owner":
        return lead.assignedToId ?? UNATTRIBUTED;
    }
  };

  const bucket = (dim: (typeof dims)[number], key: string): Bucket => {
    const existing = buckets[dim].get(key);
    if (existing) return existing;
    const fresh = emptyBucket();
    buckets[dim].set(key, fresh);
    return fresh;
  };

  for (const lead of leads) {
    for (const dim of dims) {
      const entry = bucket(dim, keyFor(lead, dim));
      entry.leads += 1;
      if (lead.status === "QUALIFIED") entry.qualified += 1;
      if (lead.status === "WON") entry.won += 1;
      if (lead.budget) entry.pipelineValue = entry.pipelineValue.plus(lead.budget.toString());
    }
  }

  if (revenue) {
    for (const lead of converting) {
      const received = revenue.received.get(lead.clientId);
      if (!received || received.isZero()) continue;
      for (const dim of dims) {
        const entry = bucket(dim, keyFor(lead, dim));
        entry.revenue = entry.revenue.plus(received);
      }
    }
  }

  const toRows = (dim: (typeof dims)[number]): BreakdownRow[] =>
    [...buckets[dim].entries()]
      .map(([id, value]) => ({
        id,
        label: id === UNATTRIBUTED ? unattributedLabel(dim) : (labels[dim].get(id) ?? "Deleted"),
        leads: value.leads,
        qualified: value.qualified,
        won: value.won,
        pipelineValue: toMoneyString(value.pipelineValue),
        revenue: revenue ? toMoneyString(value.revenue) : null,
        conversionRate:
          value.leads === 0 ? null : mul(div(value.won, value.leads), 100).toFixed(1),
      }))
      // Highest realised value first, then pipeline, then volume — which is the
      // order that answers "which source produces the highest-value leads".
      .sort((a, b) => {
        const byRevenue = compareMoney(b.revenue, a.revenue);
        if (byRevenue !== 0) return byRevenue;
        const byPipeline = compareMoney(b.pipelineValue, a.pipelineValue);
        if (byPipeline !== 0) return byPipeline;
        return b.leads - a.leads;
      });

  return {
    source: toRows("source"),
    service: toRows("service"),
    city: toRows("city"),
    campaign: toRows("campaign"),
    popup: toRows("popup"),
    owner: toRows("owner"),
    revenueWithheld: !seesMoney,
  };
}

function compareMoney(a: string | null, b: string | null): number {
  if (a === null || b === null) return 0;
  return new Decimal(a).comparedTo(new Decimal(b));
}

function unattributedLabel(dim: string): string {
  switch (dim) {
    case "service":
      return "No service";
    case "city":
      return "No city";
    case "campaign":
      return "No campaign";
    case "popup":
      return "Not from a popup";
    case "owner":
      return "Unassigned";
    default:
      return "Unattributed";
  }
}

async function loadLabels() {
  const [sources, services, cities, campaigns, popups, staff] = await Promise.all([
    db.leadSource.findMany({ select: { id: true, name: true } }),
    db.service.findMany({ select: { id: true, name: true } }),
    db.city.findMany({ select: { id: true, name: true } }),
    db.campaign.findMany({ select: { id: true, name: true } }),
    db.popup.findMany({ select: { id: true, name: true } }),
    db.user.findMany({ where: { type: "STAFF" }, select: { id: true, name: true } }),
  ]);

  const map = (rows: { id: string; name: string }[]) =>
    new Map(rows.map((row) => [row.id, row.name]));

  return {
    source: map(sources),
    service: map(services),
    city: map(cities),
    campaign: map(campaigns),
    popup: map(popups),
    owner: map(staff),
  };
}

// ---------------------------------------------------------------------------
// Campaign performance
// ---------------------------------------------------------------------------

export type CampaignPerformanceRow = {
  id: string;
  name: string;
  platform: string;
  status: string;
  currency: string;
  budget: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: string;
  /** Only what the metrics actually recorded — null when none of them did. */
  reportedRevenue: string | null;
  /** Click-through rate as a percentage with two decimals. Null with no impressions. */
  ctr: string | null;
  /** Cost per click. Null with no clicks. */
  cpc: string | null;
  /** Cost per attributed lead. Null with no leads. */
  cpl: string | null;
  /** Leads in the CRM attributed to this campaign, in the range. */
  leads: number;
  won: number;
  /** How many days of data exist, so a reader knows how thin the numbers are. */
  days: number;
};

export async function campaignPerformance(
  actor: Actor,
  range: DateRange,
): Promise<CampaignPerformanceRow[]> {
  requirePermission(actor, "campaigns.view");

  const [campaigns, metrics, leadCounts, wonCounts] = await Promise.all([
    db.campaign.findMany({
      orderBy: [{ status: "asc" }, { startsAt: "desc" }],
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        budget: true,
        currency: true,
      },
    }),
    db.campaignMetric.groupBy({
      by: ["campaignId"],
      where: { date: rangeFilter(range) },
      _sum: { impressions: true, clicks: true, conversions: true, spend: true, revenue: true },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ["campaignId"],
      where: {
        ...visibilityFilter(actor),
        deletedAt: null,
        campaignId: { not: null },
        createdAt: rangeFilter(range),
      },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ["campaignId"],
      where: {
        ...visibilityFilter(actor),
        deletedAt: null,
        status: "WON",
        campaignId: { not: null },
        createdAt: rangeFilter(range),
      },
      _count: { _all: true },
    }),
  ]);

  const metricById = new Map(metrics.map((row) => [row.campaignId, row]));
  const leadsById = new Map(
    leadCounts.filter((row) => row.campaignId).map((row) => [row.campaignId as string, row._count._all]),
  );
  const wonById = new Map(
    wonCounts.filter((row) => row.campaignId).map((row) => [row.campaignId as string, row._count._all]),
  );

  return campaigns.map((campaign) => {
    const metric = metricById.get(campaign.id);
    const impressions = metric?._sum.impressions ?? 0;
    const clicks = metric?._sum.clicks ?? 0;
    const spend = new Decimal(metric?._sum.spend?.toString() ?? "0");
    const leads = leadsById.get(campaign.id) ?? 0;

    return {
      id: campaign.id,
      name: campaign.name,
      platform: campaign.platform,
      status: campaign.status,
      currency: campaign.currency,
      budget: toMoneyString(campaign.budget),
      impressions,
      clicks,
      conversions: metric?._sum.conversions ?? 0,
      spend: toMoneyString(spend),
      // `revenue` is nullable on the metric: summing to zero when nobody
      // recorded any would read as "we earned nothing", which is a different
      // claim from "nobody measured it".
      reportedRevenue:
        metric?._sum.revenue == null ? null : toMoneyString(metric._sum.revenue.toString()),
      ctr: impressions === 0 ? null : mul(div(clicks, impressions), 100).toFixed(2),
      cpc: clicks === 0 ? null : toMoneyString(div(spend, clicks)),
      cpl: leads === 0 ? null : toMoneyString(div(spend, leads)),
      leads,
      won: wonById.get(campaign.id) ?? 0,
      days: metric?._count._all ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Popup funnel
// ---------------------------------------------------------------------------

export type PopupFunnelRow = {
  id: string;
  name: string;
  impressions: number;
  views: number;
  formStarts: number;
  submissions: number;
  conversions: number;
  /** Submissions ÷ views as a percentage. Null with no views. */
  submissionRate: string | null;
};

export async function popupFunnel(actor: Actor, range: DateRange): Promise<PopupFunnelRow[]> {
  requirePermission(actor, "popups.view");

  const [popups, events] = await Promise.all([
    db.popup.findMany({ select: { id: true, name: true } }),
    db.popupAnalytics.groupBy({
      by: ["popupId", "event"],
      where: { occurredAt: rangeFilter(range) },
      _count: { _all: true },
    }),
  ]);

  const byPopup = new Map<string, Record<string, number>>();
  for (const row of events) {
    const entry = byPopup.get(row.popupId) ?? {};
    entry[row.event] = row._count._all;
    byPopup.set(row.popupId, entry);
  }

  return popups
    .map((popup) => {
      const counts = byPopup.get(popup.id) ?? {};
      const views = counts["VIEW"] ?? 0;
      const submissions = counts["SUBMISSION"] ?? 0;

      return {
        id: popup.id,
        name: popup.name,
        impressions: counts["IMPRESSION"] ?? 0,
        views,
        formStarts: counts["FORM_START"] ?? 0,
        submissions,
        conversions: counts["CONVERSION"] ?? 0,
        submissionRate: views === 0 ? null : mul(div(submissions, views), 100).toFixed(1),
      };
    })
    .sort((a, b) => b.submissions - a.submissions || b.views - a.views);
}

// ---------------------------------------------------------------------------
// Revenue by service and city
// ---------------------------------------------------------------------------

export type RevenueRow = { id: string; label: string; revenue: string; clients: number };

/**
 * Revenue by service and by city.
 *
 * Derived from the same one-lead-per-client attribution as the breakdowns, so
 * the two screens cannot disagree. Requires finance permission outright rather
 * than returning nulls: this report is only about money.
 */
export async function revenueByDimension(
  actor: Actor,
  range: DateRange,
): Promise<{ service: RevenueRow[]; city: RevenueRow[] }> {
  requirePermission(actor, "analytics.view");
  requirePermission(actor, "invoices.view");

  const [revenue, converting, labels] = await Promise.all([
    revenueByClient(range),
    convertingLeads(visibilityFilter(actor)),
    loadLabels(),
  ]);

  const service = new Map<string, { revenue: Decimal; clients: number }>();
  const city = new Map<string, { revenue: Decimal; clients: number }>();

  for (const lead of converting) {
    const received = revenue.received.get(lead.clientId);
    if (!received || received.isZero()) continue;

    for (const [map, key] of [
      [service, lead.serviceId ?? UNATTRIBUTED],
      [city, lead.cityId ?? UNATTRIBUTED],
    ] as const) {
      const entry = map.get(key) ?? { revenue: ZERO, clients: 0 };
      entry.revenue = entry.revenue.plus(received);
      entry.clients += 1;
      map.set(key, entry);
    }
  }

  const toRows = (map: Map<string, { revenue: Decimal; clients: number }>, dim: "service" | "city") =>
    [...map.entries()]
      .map(([id, value]) => ({
        id,
        label: id === UNATTRIBUTED ? unattributedLabel(dim) : (labels[dim].get(id) ?? "Deleted"),
        revenue: toMoneyString(value.revenue),
        clients: value.clients,
      }))
      .sort((a, b) => new Decimal(b.revenue).comparedTo(new Decimal(a.revenue)));

  return { service: toRows(service, "service"), city: toRows(city, "city") };
}

// ---------------------------------------------------------------------------
// Content → revenue, per page
// ---------------------------------------------------------------------------

/**
 * What a page is worth.
 *
 * The chain the whole product is built around, read backwards: a landing page
 * captured a lead, the lead was qualified, it became a client, and that client
 * paid. Every arrow is a real foreign key (CLAUDE.md 1), so this is a join
 * rather than an estimate.
 *
 * ## Revenue is attributed once, to the first page that brought the client
 *
 * A client can arrive through two leads from two different pages. Adding their
 * payments under both would make the column sum to more money than the agency
 * received, which is the kind of number that gets quoted in a meeting and then
 * cannot be defended. `convertingLeads` already resolves each client to its
 * earliest converting lead, so every payment is counted under exactly one page
 * — the same rule the service and city breakdowns use.
 *
 * ## Traffic is absent, not zero
 *
 * There is no pageview store and no analytics provider implemented
 * (`lib/reporting` defines the boundary and nothing fills it). Sessions and
 * conversion rate are therefore `null`, and the screen says "Not connected".
 * A zero would read as "this page gets no visitors", which is a claim nobody
 * has the data to make (CLAUDE.md 5).
 */
export type PageFunnelRow = {
  /** The landing path exactly as captured, normalised. */
  path: string;
  /** The page's admin title where one matches the path, else null. */
  title: string | null;
  /** Where to edit it, where the path resolves to a CMS page. */
  pageId: string | null;
  leads: number;
  qualified: number;
  clients: number;
  /** Fixed-precision string. Payments captured in range, attributed once. */
  revenue: string;
  /** Null, always, until a traffic source exists. Never zero. */
  sessions: number | null;
};

/**
 * A landing path, reduced to something two rows can agree on.
 *
 * `/pricing?utm_source=x` and `/pricing/` are the same page to a reader, and
 * splitting them across three rows would understate every one of them.
 */
function landingKey(path: string | null): string {
  if (!path) return UNATTRIBUTED;
  const trimmed = path.trim();
  if (!trimmed) return UNATTRIBUTED;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutQuery = withSlash.split(/[?#]/)[0] ?? withSlash;
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : "/";
}

/** Which lead statuses count as having got somewhere. */
const QUALIFIED: readonly string[] = [
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
];

export async function pageFunnel(actor: Actor, range: DateRange): Promise<PageFunnelRow[]> {
  requirePermission(actor, "analytics.view");

  // Revenue needs the invoicing permission, so an actor without it gets the
  // funnel with no money column rather than being refused the whole report.
  const seesRevenue = can(actor, "invoices.view");

  const [leads, converting, revenue] = await Promise.all([
    db.lead.findMany({
      where: { ...visibilityFilter(actor), deletedAt: null, createdAt: rangeFilter(range) },
      select: { landingPath: true, status: true },
    }),
    convertingLeads(visibilityFilter(actor)),
    seesRevenue ? revenueByClient(range) : Promise.resolve(null),
  ]);

  const rows = new Map<string, { leads: number; qualified: number; clients: number; revenue: Decimal }>();
  const blank = () => ({ leads: 0, qualified: 0, clients: 0, revenue: ZERO });

  for (const lead of leads) {
    const key = landingKey(lead.landingPath);
    const entry = rows.get(key) ?? blank();
    entry.leads += 1;
    if (QUALIFIED.includes(lead.status)) entry.qualified += 1;
    rows.set(key, entry);
  }

  for (const lead of converting) {
    const key = landingKey(lead.landingPath);
    const entry = rows.get(key) ?? blank();
    entry.clients += 1;
    const received = revenue?.received.get(lead.clientId);
    if (received) entry.revenue = entry.revenue.plus(received);
    rows.set(key, entry);
  }

  // Name the paths that are CMS pages, so a row is something to click rather
  // than a string to go and look up.
  const paths = [...rows.keys()].filter((key) => key !== UNATTRIBUTED);
  const slugs = paths.map((path) => path.replace(/^\//, "")).filter(Boolean);
  const pages = slugs.length
    ? await db.page.findMany({
        where: { slug: { in: slugs }, deletedAt: null },
        select: { id: true, slug: true, title: true },
      })
    : [];
  const bySlug = new Map(pages.map((page) => [page.slug, page]));

  return [...rows.entries()]
    .map(([path, value]) => {
      const page = bySlug.get(path.replace(/^\//, ""));
      return {
        path: path === UNATTRIBUTED ? "Unknown" : path,
        title: page?.title ?? null,
        pageId: page?.id ?? null,
        leads: value.leads,
        qualified: value.qualified,
        clients: value.clients,
        revenue: toMoneyString(value.revenue),
        // Not zero: nobody has the data to claim this page had no visitors.
        sessions: null,
      };
    })
    .sort(
      (a, b) =>
        new Decimal(b.revenue).comparedTo(new Decimal(a.revenue)) ||
        b.leads - a.leads ||
        a.path.localeCompare(b.path),
    );
}
