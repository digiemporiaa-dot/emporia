import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { addDays, toDbDate } from "@/lib/seo-intel/dates";
import { computeGa4Organic, crmOrganicFunnel, crmPeriod, ga4OrganicOverview } from "@/lib/services/seo-intel/organic.service";
import { pageFunnel } from "@/lib/services/analytics.service";
import { detectOpportunities } from "@/lib/services/seo-intel/opportunity.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Organic → revenue against the database: GA4 figures for any website, and
 * for the agency's own website the chain from an organic first visit to a
 * lead, an opportunity, a client and a payment — with revenue hidden from
 * whoever may not see invoices, and the page funnel's sessions filled from
 * GA4. Dates sit in March 2025 so no other test's rows fall inside.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `or${Date.now().toString(36)}`;
const HOST = `agency-${TAG}.example.com`;
const LATEST = "2025-03-31";
const SEO_PAGE = `/services/seo-${TAG}`;
const BLOG_PAGE = `/blog/${TAG}`;

describeDb("Organic → revenue", () => {
  let staffId = "";
  let agencyClientId = "";
  let otherClientId = "";
  let propertyId = "";
  let otherPropertyId = "";
  let serviceId = "";
  const clientIds: string[] = [];
  const leadIds: string[] = [];
  const invoiceIds: string[] = [];

  const actor = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "MARKETING_MANAGER", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions), ...overrides }) as Actor;
  const full = () => actor(["seo.intelligence.view", "analytics.view", "invoices.view", "leads.view", "leads.view.team"]);
  const noMoney = () => actor(["seo.intelligence.view", "analytics.view", "leads.view", "leads.view.team"]);

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    agencyClientId = (await db.client.create({ data: { name: `Agency ${TAG}`, slug: `agency-${TAG}`, ownerId: staffId, isInternal: true }, select: { id: true } })).id;
    otherClientId = (await db.client.create({ data: { name: `Other ${TAG}`, slug: `other-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (await db.seoProperty.create({ data: { clientId: agencyClientId, domain: HOST, displayName: "Agency", crawlFrequency: "MANUAL", ga4PropertyId: "properties/1", ga4Currency: "INR" }, select: { id: true } })).id;
    otherPropertyId = (await db.seoProperty.create({ data: { clientId: otherClientId, domain: `other-${HOST}`, displayName: "Other", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    await db.seoConnection.create({ data: { propertyId, source: "ANALYTICS", method: "SERVICE_ACCOUNT", status: "CONNECTED", externalId: "properties/1" } });
    serviceId = (await db.service.create({ data: { slug: `svc-${TAG}`, name: `SEO ${TAG}`, shortDescription: "x" }, select: { id: true } })).id;

    const totals = [];
    const landing = [];
    const gscPages = [];
    const gscPairs = [];
    for (let i = 0; i < 56; i++) {
      const date = toDbDate(addDays(LATEST, -i));
      const current = i < 28;
      totals.push(
        { propertyId, date, channel: "Organic Search", sessions: current ? 100 : 80, engagedSessions: 60, keyEvents: 2, revenue: "10.50" },
        { propertyId, date, channel: "Direct", sessions: 50, engagedSessions: 20, keyEvents: 1, revenue: "0" },
        { propertyId, date, channel: "Organic Search", country: "IN", sessions: 70, engagedSessions: 40, keyEvents: 1, revenue: "5" },
        { propertyId, date, channel: "Organic Search", country: "AE", sessions: 30, engagedSessions: 20, keyEvents: 1, revenue: "5.50" },
        { propertyId, date, channel: "Organic Search", device: "mobile", sessions: 60, engagedSessions: 30, keyEvents: 1, revenue: "0" },
      );
      if (current) {
        landing.push(
          { propertyId, date, landingPage: SEO_PAGE, channel: "Organic Search", sessions: 50, engagedSessions: 30, keyEvents: 2, revenue: "10.50" },
          { propertyId, date, landingPage: BLOG_PAGE, channel: "Organic Search", sessions: 50, engagedSessions: 30, keyEvents: 0, revenue: "0" },
          { propertyId, date, landingPage: SEO_PAGE, channel: "Direct", sessions: 10, engagedSessions: 4, keyEvents: 0, revenue: "0" },
        );
        gscPages.push({ propertyId, date, page: `https://${HOST}${SEO_PAGE}/`, clicks: 5, impressions: 100, position: 4 });
        gscPairs.push(
          { propertyId, date, query: "seo agency", page: `https://${HOST}${SEO_PAGE}/`, clicks: 4, impressions: 60, position: 3 },
          { propertyId, date, query: "seo company", page: `https://${HOST}${SEO_PAGE}/`, clicks: 1, impressions: 40, position: 6 },
        );
      }
    }
    await db.ga4DailyTotal.createMany({ data: totals });
    await db.ga4LandingDaily.createMany({ data: landing });
    await db.gscPageDaily.createMany({ data: gscPages });
    await db.gscQueryPageDaily.createMany({ data: gscPairs });

    // Leads on 15 March: two organic (one becomes a paying client), one paid, one unknown.
    const sourceId = (await db.leadSource.findFirstOrThrow({ select: { id: true } })).id;
    const touch = (data: { source?: string; medium?: string; referrer?: string }) =>
      db.uTMTracking.create({ data: { visitorId: `v-${TAG}`, touch: "FIRST", landingPath: SEO_PAGE, occurredAt: new Date("2025-03-10T10:00:00Z"), ...data }, select: { id: true } }).then((t) => t.id);
    const created = new Date("2025-03-15T10:00:00Z");
    const client = async (name: string) => {
      const id = (await db.client.create({ data: { name: `${name} ${TAG}`, slug: `${name.toLowerCase()}-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
      clientIds.push(id);
      return id;
    };
    const organicClient = await client("Organicco");
    const paidClient = await client("Paidco");
    const lead = async (data: Record<string, unknown>) => {
      const id = (await db.lead.create({ data: { name: "Lead", sourceId, createdAt: created, ...data } as never, select: { id: true } })).id;
      leadIds.push(id);
      return id;
    };
    const organicLead = await lead({ firstTouchId: await touch({ referrer: "https://www.google.com/" }), landingPath: `${SEO_PAGE}/?utm_x=1`, status: "QUALIFIED", serviceId, convertedClientId: organicClient, convertedAt: created });
    await lead({ firstTouchId: await touch({ source: "google", medium: "organic" }), landingPath: BLOG_PAGE, status: "NEW" });
    await lead({ firstTouchId: await touch({ source: "google", medium: "cpc", referrer: "https://www.google.com/" }), landingPath: SEO_PAGE, status: "WON", convertedClientId: paidClient, convertedAt: created });
    await lead({ landingPath: SEO_PAGE, status: "NEW" });
    await db.opportunity.create({ data: { leadId: organicLead, title: "SEO retainer", value: "120000.00", ownerId: staffId } });

    for (const [clientId, amount] of [[organicClient, "25000.00"], [paidClient, "9999.00"]] as const) {
      const invoice = await db.invoice.create({ data: { number: `INV-${TAG}-${clientId.slice(-4)}`, clientId, status: "PAID", issuedAt: new Date("2025-03-16"), dueAt: new Date("2025-03-30"), total: amount, dueTotal: "0" }, select: { id: true } });
      invoiceIds.push(invoice.id);
      await db.payment.create({ data: { invoiceId: invoice.id, clientId, amount, status: "CAPTURED", idempotencyKey: `pay-${TAG}-${clientId}`, receivedAt: new Date("2025-03-20T10:00:00Z") } });
    }
  });

  afterAll(async () => {
    if (!agencyClientId) return;
    await db.seoOpportunity.deleteMany({ where: { propertyId } });
    await db.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await db.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await db.opportunity.deleteMany({ where: { leadId: { in: leadIds } } });
    await db.lead.deleteMany({ where: { id: { in: leadIds } } });
    await db.uTMTracking.deleteMany({ where: { visitorId: `v-${TAG}` } });
    await db.client.deleteMany({ where: { id: { in: clientIds } } });
    await db.seoProperty.deleteMany({ where: { id: { in: [propertyId, otherPropertyId] } } });
    await db.client.deleteMany({ where: { id: { in: [agencyClientId, otherClientId] } } });
    await db.service.deleteMany({ where: { id: serviceId } });
  });

  describe("GA4", () => {
    it("organic KPIs against the previous period, channels, trend, landing pages with Search Console context", async () => {
      const ga4 = await computeGa4Organic(propertyId, "28d");
      if (ga4.state !== "ready") throw new Error("expected data");
      expect(ga4.period.current).toEqual({ start: "2025-03-04", end: LATEST });
      expect(ga4.current).toEqual({ sessions: 2800, engagedSessions: 1680, keyEvents: 56, revenue: "294.00", engagementRate: 0.6, keyEventRate: 0.02 });
      expect(ga4.previous.sessions).toBe(2240);
      expect(ga4.allSessions).toBe(4200);
      expect(ga4.organicShare).toBeCloseTo(2 / 3);
      expect(ga4.channels).toEqual([{ channel: "Organic Search", sessions: 2800 }, { channel: "Direct", sessions: 1400 }]);
      expect(ga4.trend).toHaveLength(28);
      expect(ga4.trend[0]).toEqual({ day: "2025-03-04", value: 100 });
      expect(ga4.landing.map((row) => [row.path, row.sessions, row.keyEvents, row.revenue])).toEqual([
        [BLOG_PAGE, 1400, 0, "0.00"],
        [SEO_PAGE, 1400, 56, "294.00"],
      ]);
      const seo = ga4.landing.find((row) => row.path === SEO_PAGE)!;
      expect(seo.search).toEqual({ clicks: 140, impressions: 2800 });
      expect(seo.queries.map((q) => q.query)).toEqual(["seo agency", "seo company"]);
      expect(ga4.countries.map((row) => [row.country, row.sessions])).toEqual([["IN", 1960], ["AE", 840]]);
      expect(ga4.devices.map((row) => [row.device, row.sessions])).toEqual([["mobile", 1680]]);
    });

    it("states without data, and staff only", async () => {
      expect((await computeGa4Organic(otherPropertyId)).state).toBe("not-connected");
      await expect(ga4OrganicOverview(actor(["seo.intelligence.view"], { type: "CLIENT", clientId: otherClientId }), otherPropertyId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("CRM — the agency's own website", () => {
    it("the funnel from organic first visits to payments, by landing page, service and campaign", async () => {
      const ga4 = await computeGa4Organic(propertyId, "28d");
      const crm = await crmOrganicFunnel(full(), propertyId, crmPeriod(ga4.state === "ready" ? ga4.period : null));
      if (crm.state !== "ready") throw new Error("expected ready");
      expect(crm.totalLeads).toBe(4);
      expect(crm.unknownSource).toBe(1);
      expect(crm.funnel).toEqual({ leads: 2, qualified: 1, opportunities: 1, clients: 1, revenue: "25000.00", revenueClients: 1 });
      const seo = crm.landing.find((row) => row.key === SEO_PAGE)!;
      expect(seo).toMatchObject({ leads: 1, qualified: 1, clients: 1, revenue: "25000.00", sessions: 1400 });
      expect(seo.leadRate).toBeCloseTo(1 / 1400);
      expect(seo.queries.map((q) => q.query)).toEqual(["seo agency", "seo company"]);
      expect(crm.landing.find((row) => row.key === BLOG_PAGE)).toMatchObject({ leads: 1, clients: 0, revenue: "0.00" });
      expect(crm.service.find((row) => row.key === serviceId)).toMatchObject({ label: `SEO ${TAG}`, leads: 1, revenue: "25000.00" });
      expect(crm.campaign.map((row) => row.label)).toEqual(["No campaign"]);
    });

    it("no payment figures without invoices.view; no lead figures without analytics.view; client sites do not apply", async () => {
      const period = crmPeriod({ period: "28d", current: { start: "2025-03-04", end: LATEST }, previous: { start: "2025-02-04", end: "2025-03-03" }, comparedWith: "" });
      const crm = await crmOrganicFunnel(noMoney(), propertyId, period);
      if (crm.state !== "ready") throw new Error("expected ready");
      expect(crm.funnel.revenue).toBeNull();
      expect(crm.funnel.leads).toBe(2);
      expect(crm.landing.every((row) => row.revenue === null)).toBe(true);
      expect((await crmOrganicFunnel(actor(["seo.intelligence.view"]), propertyId, period)).state).toBe("no-permission");
      expect((await crmOrganicFunnel(full(), otherPropertyId, period)).state).toBe("not-applicable");
      // A sales executive sees only their own leads: none of these are assigned.
      const own = await crmOrganicFunnel(actor(["seo.intelligence.view", "analytics.view", "leads.view"]), propertyId, period);
      expect(own.state === "ready" && own.funnel.leads).toBe(0);
    });

    it("without a GA4 period the CRM covers the 28 days to yesterday", () => {
      expect(crmPeriod(null, new Date("2026-10-05T12:00:00Z")).current).toEqual({ start: "2026-09-07", end: "2026-10-04" });
    });

    it("the page funnel's sessions come from the agency website's GA4, all channels", async () => {
      const rows = await pageFunnel(full(), { preset: "all", from: new Date(2025, 2, 1), to: new Date(2025, 3, 1) });
      expect(rows.find((row) => row.path === SEO_PAGE)).toMatchObject({ leads: 3, sessions: 1680, clients: 2 });
      expect(rows.find((row) => row.path === "Unknown")?.sessions ?? null).toBeNull();
    });
  });

  describe("Command Center", () => {
    it("flags organic landing pages that rarely convert, and does not run without key events", async () => {
      const result = await detectOpportunities(propertyId, new Date("2025-04-02T06:00:00Z"));
      expect(result.sources).toContain("ANALYTICS");
      const finding = await db.seoOpportunity.findFirstOrThrow({ where: { propertyId, fingerprint: `analytics:low-conversion:${BLOG_PAGE}` } });
      expect(finding).toMatchObject({ source: "ANALYTICS", impact: 1400, impactUnit: "sessions", severity: "MEDIUM", status: "OPEN" });
      expect(await db.seoOpportunity.count({ where: { propertyId, fingerprint: `analytics:low-conversion:${SEO_PAGE}` } })).toBe(0);

      await db.ga4DailyTotal.updateMany({ where: { propertyId }, data: { keyEvents: 0 } });
      await db.ga4LandingDaily.updateMany({ where: { propertyId }, data: { keyEvents: 0 } });
      const again = await detectOpportunities(propertyId, new Date("2025-04-03T06:00:00Z"));
      expect(again.sources).not.toContain("ANALYTICS");
      expect((await db.seoOpportunity.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("OPEN");
    });
  });
});
