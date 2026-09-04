import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  breakdowns,
  campaignPerformance,
  overview,
  popupFunnel,
  revenueByDimension,
} from "@/lib/services/analytics.service";
import { createCampaign, importMetrics, recordMetric } from "@/lib/services/campaign.service";
import { resolveRange } from "@/lib/analytics/range";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * The phase 14 exit criterion: the dashboard answers "which source produces the
 * highest-value leads" from real data, and shows an empty state where data does
 * not exist.
 *
 * The fixture below is built so the answer is *not* the source with the most
 * leads — a report that only counts volume would get it wrong.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const RANGE = resolveRange("ytd");

describeDb("analytics", () => {
  let prisma: PrismaClient;
  let actor: Actor;
  let marketer: Actor;
  let stranger: Actor;

  const tag = `analytics-${Date.now()}`;
  let bigSourceId = "";
  let smallSourceId = "";
  let serviceId = "";
  let cityId = "";
  let campaignId = "";
  let popupId = "";
  const clientIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const staff = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });

    const base = {
      userId: staff.id,
      name: "Analyst",
      email: "analyst@emporia.test",
      type: "STAFF" as const,
      roleName: "ADMIN" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };

    actor = {
      ...base,
      permissions: new Set([
        "analytics.view",
        "leads.view",
        "leads.view.team",
        "invoices.view",
        "campaigns.view",
        "campaigns.create",
        "campaigns.edit",
        "popups.view",
      ]),
    };

    // Holds analytics but no finance permission — the marketing manager case.
    marketer = {
      ...base,
      permissions: new Set(["analytics.view", "leads.view", "leads.view.team", "campaigns.view"]),
    };

    stranger = { ...base, permissions: new Set(["leads.view"]) };

    // ── Fixture ───────────────────────────────────────────────────────────
    // "Referral" brings 1 lead worth real money. "Paid" brings 3 that are not.
    const [big, small] = await Promise.all([
      prisma.leadSource.create({
        data: { name: `${tag} paid`, slug: `${tag}-paid`, type: "ADS" },
        select: { id: true },
      }),
      prisma.leadSource.create({
        data: { name: `${tag} referral`, slug: `${tag}-referral`, type: "REFERRAL" },
        select: { id: true },
      }),
    ]);
    bigSourceId = big.id;
    smallSourceId = small.id;

    const [service, city] = await Promise.all([
      prisma.service.create({
        data: { slug: `${tag}-service`, name: `${tag} service`, shortDescription: "Fixture" },
        select: { id: true },
      }),
      prisma.city.create({
        data: { slug: `${tag}-city`, name: `${tag} city`, state: "Fixture" },
        select: { id: true },
      }),
    ]);
    serviceId = service.id;
    cityId = city.id;

    const campaign = await createCampaign(actor, {
      name: `${tag} campaign`,
      platform: "GOOGLE_ADS",
      budget: "100000.00",
      currency: "INR",
      ownerId: staff.id,
      status: "ACTIVE",
      startsAt: new Date(Date.now() - 30 * 86400000),
    });
    campaignId = campaign.id;

    const popup = await prisma.popup.create({
      data: {
        name: `${tag} popup`,
        title: "Talk to us",
        trigger: "TIME_DELAY",
        frequency: "ONCE_PER_SESSION",
        isActive: false,
      },
      select: { id: true },
    });
    popupId = popup.id;

    // The high-volume source: three leads, big stated budgets, none converted.
    for (let i = 0; i < 3; i += 1) {
      await prisma.lead.create({
        data: {
          name: `${tag} paid lead ${i}`,
          sourceId: bigSourceId,
          serviceId,
          cityId,
          campaignId,
          popupId,
          budget: "500000.00",
          status: i === 0 ? "QUALIFIED" : "NEW",
        },
      });
    }

    // The low-volume source: one lead, modest budget, converted and paid.
    const client = await prisma.client.create({
      data: { name: `${tag} client`, slug: `${tag}-client` },
      select: { id: true },
    });
    clientIds.push(client.id);

    await prisma.lead.create({
      data: {
        name: `${tag} referral lead`,
        sourceId: smallSourceId,
        serviceId,
        cityId,
        budget: "60000.00",
        status: "WON",
        convertedClientId: client.id,
        convertedAt: new Date(),
      },
    });

    const invoice = await prisma.invoice.create({
      data: {
        number: `INV-ANALYTICS-${Date.now()}`,
        clientId: client.id,
        status: "PAID",
        currency: "INR",
        issuedAt: new Date(),
        dueAt: new Date(Date.now() + 86400000),
        subtotal: "750000.00",
        discountTotal: "0.00",
        taxTotal: "0.00",
        total: "750000.00",
        paidTotal: "750000.00",
        dueTotal: "0.00",
      },
      select: { id: true },
    });

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        clientId: client.id,
        amount: "750000.00",
        currency: "INR",
        gateway: "BANK_TRANSFER",
        status: "CAPTURED",
        idempotencyKey: `analytics-${Date.now()}`,
        receivedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.invoice.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.lead.deleteMany({ where: { sourceId: { in: [bigSourceId, smallSourceId] } } });
    await prisma.campaignMetric.deleteMany({ where: { campaignId } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.popupAnalytics.deleteMany({ where: { popupId } });
    await prisma.popup.deleteMany({ where: { id: popupId } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.leadSource.deleteMany({ where: { id: { in: [bigSourceId, smallSourceId] } } });
    await prisma.service.deleteMany({ where: { id: serviceId } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.$disconnect();
  });

  // ── The exit criterion ────────────────────────────────────────────────

  it("ranks sources by the value they produced, not by volume", async () => {
    const result = await breakdowns(actor, RANGE);

    const paid = result.source.find((row) => row.id === bigSourceId);
    const referral = result.source.find((row) => row.id === smallSourceId);

    expect(paid?.leads).toBe(3);
    expect(referral?.leads).toBe(1);

    // Volume and stated budget both favour "paid"; realised revenue does not.
    expect(paid?.pipelineValue).toBe("1500000.00");
    expect(paid?.revenue).toBe("0.00");
    expect(referral?.revenue).toBe("750000.00");

    // Which means the referral source sorts first.
    const ranked = result.source.filter((row) => row.id === bigSourceId || row.id === smallSourceId);
    expect(ranked[0]?.id).toBe(smallSourceId);
  });

  it("reports a conversion rate per source, and none where there are no leads", async () => {
    const result = await breakdowns(actor, RANGE);

    expect(result.source.find((row) => row.id === smallSourceId)?.conversionRate).toBe("100.0");
    expect(result.source.find((row) => row.id === bigSourceId)?.conversionRate).toBe("0.0");

    // A source nobody used does not appear at all rather than as a row of zeros.
    const unused = await prisma.leadSource.create({
      data: { name: `${tag} unused`, slug: `${tag}-unused`, type: "OTHER" },
      select: { id: true },
    });
    const after = await breakdowns(actor, RANGE);
    expect(after.source.some((row) => row.id === unused.id)).toBe(false);
    await prisma.leadSource.delete({ where: { id: unused.id } });
  });

  // ── Revenue attribution ───────────────────────────────────────────────

  it("counts a client's revenue once even when two leads converted it", async () => {
    const before = await revenueByDimension(actor, RANGE);
    const beforeTotal = before.service.find((row) => row.id === serviceId)?.revenue;

    // A second lead pointing at the same client — a duplicate enquiry that was
    // also marked converted. Naive attribution would count the money twice.
    const duplicate = await prisma.lead.create({
      data: {
        name: `${tag} duplicate`,
        sourceId: smallSourceId,
        serviceId,
        cityId,
        status: "WON",
        convertedClientId: clientIds[0] as string,
        convertedAt: new Date(),
      },
      select: { id: true },
    });

    const after = await revenueByDimension(actor, RANGE);
    expect(after.service.find((row) => row.id === serviceId)?.revenue).toBe(beforeTotal);

    await prisma.lead.delete({ where: { id: duplicate.id } });
  });

  it("reports revenue by service and city from real payments", async () => {
    const result = await revenueByDimension(actor, RANGE);

    expect(result.service.find((row) => row.id === serviceId)?.revenue).toBe("750000.00");
    expect(result.city.find((row) => row.id === cityId)?.revenue).toBe("750000.00");
  });

  // ── Authorization ─────────────────────────────────────────────────────

  it("withholds revenue from an actor without finance permission", async () => {
    const result = await breakdowns(marketer, RANGE);

    expect(result.revenueWithheld).toBe(true);
    for (const row of result.source) expect(row.revenue).toBeNull();

    // Lead figures are still there — it is the money that is withheld.
    expect(result.source.find((row) => row.id === bigSourceId)?.leads).toBe(3);

    const summary = await overview(marketer, RANGE);
    expect(summary.revenue).toBeNull();
    expect(summary.outstanding).toBeNull();
    expect(summary.leads).toBeGreaterThan(0);
  });

  it("refuses the money-only report outright without finance permission", async () => {
    await expect(revenueByDimension(marketer, RANGE)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses analytics without analytics.view", async () => {
    await expect(overview(stranger, RANGE)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(breakdowns(stranger, RANGE)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ── Overview ──────────────────────────────────────────────────────────

  it("summarises leads, pipeline and revenue", async () => {
    const summary = await overview(actor, RANGE);

    expect(summary.leads).toBeGreaterThanOrEqual(4);
    expect(summary.won).toBeGreaterThanOrEqual(1);
    expect(summary.qualified).toBeGreaterThanOrEqual(1);
    // Stated budget on leads still in play: the three NEW/QUALIFIED paid leads.
    expect(summary.pipelineValue).toBe("1500000.00");
    expect(summary.revenue).toBe("750000.00");
    expect(typeof summary.conversionRate).toBe("string");
  });

  it("returns no conversion rate rather than zero when nothing came in", async () => {
    // A range that predates the whole fixture.
    const empty = { preset: "30d" as const, from: new Date("2000-01-01"), to: new Date("2000-02-01") };
    const summary = await overview(actor, empty);

    expect(summary.leads).toBe(0);
    expect(summary.conversionRate).toBeNull();
    expect(summary.pipelineValue).toBe("0.00");
    expect(summary.revenue).toBe("0.00");
  });

  // ── Campaign performance ──────────────────────────────────────────────

  it("computes CTR, CPC and cost per lead from recorded metrics only", async () => {
    await recordMetric(actor, {
      campaignId,
      date: new Date(),
      impressions: 10_000,
      clicks: 250,
      conversions: 12,
      spend: "18750.00",
    });

    const rows = await campaignPerformance(actor, RANGE);
    const row = rows.find((r) => r.id === campaignId);

    expect(row?.impressions).toBe(10_000);
    expect(row?.ctr).toBe("2.50");
    expect(row?.cpc).toBe("75.00");
    // Three leads carry this campaign, so 18750 / 3.
    expect(row?.leads).toBe(3);
    expect(row?.cpl).toBe("6250.00");
    // Nobody recorded revenue against it, which is not the same as zero.
    expect(row?.reportedRevenue).toBeNull();
    expect(row?.days).toBe(1);
  });

  it("corrects a day rather than adding a second row for it", async () => {
    const day = new Date();

    await recordMetric(actor, {
      campaignId,
      date: day,
      impressions: 10_000,
      clicks: 250,
      conversions: 12,
      spend: "18750.00",
    });
    await recordMetric(actor, {
      campaignId,
      date: day,
      impressions: 11_000,
      clicks: 260,
      conversions: 13,
      spend: "19000.00",
    });

    const rows = await campaignPerformance(actor, RANGE);
    const row = rows.find((r) => r.id === campaignId);

    expect(row?.days).toBe(1);
    expect(row?.impressions).toBe(11_000);
    expect(row?.spend).toBe("19000.00");
  });

  it("shows no rates for a campaign with no data", async () => {
    const bare = await createCampaign(actor, {
      name: `${tag} bare`,
      platform: "SEO",
      budget: "0",
      currency: "INR",
      ownerId: actor.userId,
      status: "DRAFT",
      startsAt: new Date(),
    });

    const rows = await campaignPerformance(actor, RANGE);
    const row = rows.find((r) => r.id === bare.id);

    expect(row?.days).toBe(0);
    expect(row?.ctr).toBeNull();
    expect(row?.cpc).toBeNull();
    expect(row?.cpl).toBeNull();
    expect(row?.spend).toBe("0.00");

    await prisma.campaign.delete({ where: { id: bare.id } });
  });

  // ── Metric import ─────────────────────────────────────────────────────

  it("imports a CSV and reports every row it refused", async () => {
    const result = await importMetrics(
      actor,
      campaignId,
      [
        "date,impressions,clicks,conversions,spend,revenue",
        "2026-03-01,5000,120,4,9000.00,45000.00",
        "2026-03-02,6000,140,5,9500.50,",
        "2026-03-03,not-a-number,10,1,100.00",
        "2026-03-04,900,999999,1,100.00",
        "nonsense",
      ].join("\n"),
    );

    expect(result.imported).toBe(3);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]).toContain("Line 4");
    expect(result.rejected[1]).toContain("Line 6");

    const rows = await prisma.campaignMetric.findMany({
      where: { campaignId, date: { gte: new Date("2026-03-01"), lt: new Date("2026-03-05") } },
      orderBy: { date: "asc" },
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]?.source).toBe("IMPORT");
    expect(rows[0]?.spend.toString()).toBe("9000");
    expect(rows[0]?.revenue?.toString()).toBe("45000");
    // A blank revenue column stays null rather than becoming a measured zero.
    expect(rows[1]?.revenue).toBeNull();
  });

  it("keeps the last row when a file repeats a day", async () => {
    await importMetrics(
      actor,
      campaignId,
      ["2026-04-01,100,10,1,50.00", "2026-04-01,200,20,2,80.00"].join("\n"),
    );

    const rows = await prisma.campaignMetric.findMany({
      where: { campaignId, date: new Date("2026-04-01") },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.impressions).toBe(200);
  });

  it("refuses to import for an actor who cannot edit campaigns", async () => {
    await expect(importMetrics(marketer, campaignId, "2026-05-01,1,1,1,1.00")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  // ── Popups ────────────────────────────────────────────────────────────

  it("reports a popup funnel and no rate without views", async () => {
    const rows = await popupFunnel(actor, RANGE);
    const row = rows.find((r) => r.id === popupId);

    expect(row?.views).toBe(0);
    expect(row?.submissionRate).toBeNull();

    await prisma.popupAnalytics.createMany({
      data: [
        { popupId, event: "IMPRESSION", visitorId: "v1", path: "/" },
        { popupId, event: "VIEW", visitorId: "v1", path: "/" },
        { popupId, event: "VIEW", visitorId: "v2", path: "/" },
        { popupId, event: "SUBMISSION", visitorId: "v1", path: "/" },
      ],
    });

    const after = await popupFunnel(actor, RANGE);
    const updated = after.find((r) => r.id === popupId);

    expect(updated?.views).toBe(2);
    expect(updated?.submissions).toBe(1);
    expect(updated?.submissionRate).toBe("50.0");
  });
});
