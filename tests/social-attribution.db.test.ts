import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { campaignForTouch } from "@/lib/attribution/server";
import { socialAttribution } from "@/lib/services/social-attribution.service";
import { socialInsights } from "@/lib/services/social-insights.service";
import { resolveRange } from "@/lib/analytics/range";
import type { Actor } from "@/lib/actor/types";

/**
 * Social → lead → opportunity → client → revenue, and the insights service,
 * against the database.
 *
 * Pinned: a lead counts only through its last touch's tags — a post's own
 * `utm_content`, or a social touch whose campaign resolves to this client's
 * campaign (by the same rule lead capture uses). Paid traffic naming the same
 * campaign, another client's campaign, a deleted lead and an ambiguous name
 * do not count. Revenue is money received in the period, once per client,
 * through the lead that converted it first. Money is hidden without the
 * permission, lead counts follow lead visibility, and a portal user gets
 * nothing.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `sat${Date.now()}`;
const RANGE = resolveRange("30d");

function staff(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Analyst",
    email: "analyst@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const ALL = ["social.analytics.view", "leads.view", "leads.view.team", "opportunities.view", "invoices.view"];

describeDb("social attribution and insights", () => {
  let userId = "";
  let otherUserId = "";
  let clientA = "";
  let clientB = "";
  let payerX = "";
  let payerY = "";
  let sourceId = "";
  let diwali = "";
  let otherCampaign = "";
  let postTagged = "";
  const tag = `reel-${TAG.slice(-8)}`;

  async function touch(data: { source?: string; medium?: string; campaign?: string; content?: string }) {
    return (
      await db.uTMTracking.create({ data: { visitorId: `${TAG}-v`, touch: "LAST", ...data }, select: { id: true } })
    ).id;
  }

  async function lead(name: string, lastTouchId: string | null, extra: Record<string, unknown> = {}) {
    return (
      await db.lead.create({
        data: { name: `${TAG} ${name}`, sourceId, lastTouchId, assignedToId: userId, ...extra },
        select: { id: true },
      })
    ).id;
  }

  async function paid(clientId: string, amount: string) {
    const invoice = await db.invoice.create({
      data: {
        number: `INV-${TAG}-${clientId.slice(-4)}`,
        clientId,
        status: "PAID",
        currency: "INR",
        issuedAt: new Date(),
        dueAt: new Date(),
        subtotal: amount,
        discountTotal: "0.00",
        taxTotal: "0.00",
        total: amount,
        paidTotal: amount,
        dueTotal: "0.00",
      },
      select: { id: true },
    });
    await db.payment.create({
      data: {
        invoiceId: invoice.id,
        clientId,
        amount,
        currency: "INR",
        gateway: "BANK_TRANSFER",
        status: "CAPTURED",
        idempotencyKey: `${TAG}-${clientId}`,
        receivedAt: new Date(),
      },
    });
  }

  beforeAll(async () => {
    const users = await db.user.findMany({ where: { type: "STAFF" }, take: 2, select: { id: true } });
    userId = users[0]!.id;
    otherUserId = users[1]?.id ?? users[0]!.id;

    const clients = await Promise.all(
      ["A", "B", "X", "Y"].map((k) => db.client.create({ data: { name: `${TAG} ${k}`, slug: `${TAG}-${k.toLowerCase()}` }, select: { id: true } })),
    );
    [clientA, clientB, payerX, payerY] = clients.map((c) => c.id) as [string, string, string, string];
    sourceId = (await db.leadSource.create({ data: { name: `${TAG} src`, slug: `${TAG}-src`, type: "SOCIAL" }, select: { id: true } })).id;

    const campaign = (name: string, clientId: string) =>
      db.campaign.create({ data: { name, clientId, platform: "META_ADS", ownerId: userId, startsAt: new Date() }, select: { id: true } });
    diwali = (await campaign(`${TAG} Diwali 2026`, clientA)).id;
    otherCampaign = (await campaign(`${TAG} Other brand`, clientB)).id;

    const project = await db.project.create({
      data: { code: `S-${TAG}`.slice(0, 20), name: "Retainer", clientId: clientA, managerId: userId, startsAt: new Date(), status: "ACTIVE" },
      select: { id: true },
    });
    const item = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: project.id, title: `${TAG} Diwali reel`, channel: "INSTAGRAM", stage: "PUBLISHED", campaignId: diwali },
      select: { id: true },
    });
    postTagged = (
      await db.socialPost.create({
        data: { contentItemId: item.id, clientId: clientA, provider: "INSTAGRAM", type: "REEL", status: "PUBLISHED", utmContent: tag, publishedAt: new Date() },
        select: { id: true },
      })
    ).id;

    const slug = `${TAG} diwali 2026`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // L1: through the post's own tag. Converted to X; one won and one open deal.
    const l1 = await lead("via post", await touch({ source: "instagram", medium: "social", campaign: slug, content: tag }), {
      convertedClientId: payerX,
      convertedAt: new Date(),
    });
    await db.opportunity.createMany({
      data: [
        { leadId: l1, title: "Won deal", value: "50000.00", stage: "WON", ownerId: userId },
        { leadId: l1, title: "Open deal", value: "20000.50", stage: "PROPOSAL", ownerId: userId },
        { leadId: l1, title: "Lost deal", value: "99999.00", stage: "LOST", ownerId: userId },
      ],
    });
    await paid(payerX, "30000.25");

    // L2: a social touch naming the campaign the way the publisher writes it.
    await lead("via campaign slug", await touch({ source: "facebook", medium: "social", campaign: slug }), { assignedToId: otherUserId });

    // Not counted: paid traffic naming the same campaign; another client's
    // campaign; a deleted lead; no touch.
    await lead("paid search", await touch({ source: "google", medium: "cpc", campaign: slug }));
    await lead("other client", await touch({ source: "instagram", medium: "social", campaign: `${TAG} Other brand` }));
    await lead("deleted", await touch({ source: "instagram", medium: "social", content: tag }), { deletedAt: new Date() });
    await lead("no touch", null);

    // L5: created long before the period, first converter of Y, paid this period.
    await lead("old converter", await touch({ source: "instagram", medium: "social", content: tag }), {
      createdAt: new Date("2020-01-01"),
      convertedClientId: payerY,
      convertedAt: new Date("2020-02-01"),
    });
    await paid(payerY, "1000.00");
  });

  afterAll(async () => {
    const clients = [clientA, clientB, payerX, payerY];
    await db.payment.deleteMany({ where: { clientId: { in: clients } } });
    await db.invoice.deleteMany({ where: { clientId: { in: clients } } });
    await db.opportunity.deleteMany({ where: { lead: { sourceId } } });
    await db.lead.deleteMany({ where: { sourceId } });
    await db.uTMTracking.deleteMany({ where: { visitorId: `${TAG}-v` } });
    await db.leadSource.deleteMany({ where: { id: sourceId } });
    await db.socialMetricSnapshot.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: clients } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: clients } } });
    await db.project.deleteMany({ where: { clientId: { in: clients } } });
    await db.campaign.deleteMany({ where: { id: { in: [diwali, otherCampaign] } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
  });

  // -------------------------------------------------------------------------
  // Resolving a touch to a campaign (used by lead capture too)
  // -------------------------------------------------------------------------

  it("resolves a touch by post tag, exact name, then the publisher's form of the name", async () => {
    expect(await campaignForTouch(db, { content: tag })).toBe(diwali);
    expect(await campaignForTouch(db, { campaign: `${TAG} DIWALI 2026` })).toBe(diwali);
    expect(await campaignForTouch(db, { campaign: `${TAG} diwali 2026`.toLowerCase().replace(/[^a-z0-9]+/g, "-") })).toBe(diwali);
    expect(await campaignForTouch(db, { campaign: `${TAG}-nothing-like-it` })).toBeNull();
  });

  it("refuses to guess between two campaigns with the same name", async () => {
    const twin = await db.campaign.create({
      data: { name: `${TAG} Twin`, clientId: clientA, platform: "META_ADS", ownerId: userId, startsAt: new Date() },
      select: { id: true },
    });
    const twin2 = await db.campaign.create({
      data: { name: `${TAG} twin`, clientId: clientB, platform: "META_ADS", ownerId: userId, startsAt: new Date() },
      select: { id: true },
    });
    try {
      expect(await campaignForTouch(db, { campaign: `${TAG} Twin` })).toBeNull();
      expect(await campaignForTouch(db, { campaign: `${TAG}-twin`.toLowerCase() })).toBeNull();
    } finally {
      await db.campaign.deleteMany({ where: { id: { in: [twin.id, twin2.id] } } });
    }
  });

  // -------------------------------------------------------------------------
  // Attribution
  // -------------------------------------------------------------------------

  it("counts only attributable leads, and follows them to deals, clients and money", async () => {
    const result = await socialAttribution(staff(userId, ALL), { clientId: clientA, range: RANGE });
    if (!result.available) throw new Error("expected attribution");

    expect(result.totals).toEqual({
      leads: 2,
      opportunities: 3,
      pipeline: "20000.50",
      won: "50000.00",
      clients: 1,
      // X paid this period through L1; Y paid this period through L5, whose
      // lead predates the period and so is not counted as a lead.
      revenue: "31000.25",
    });
    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]).toMatchObject({ id: diwali, leads: 2, revenue: "31000.25" });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({ id: postTagged, leads: 1, clients: 1, revenue: "31000.25" });
  });

  it("hides money the viewer may not see, rather than showing zero", async () => {
    const result = await socialAttribution(staff(userId, ["social.analytics.view", "leads.view", "leads.view.team"]), {
      clientId: clientA,
      range: RANGE,
    });
    if (!result.available) throw new Error("expected attribution");
    expect(result.totals).toMatchObject({ leads: 2, pipeline: null, won: null, revenue: null });
    expect(result.moneyWithheld).toEqual({ opportunities: true, revenue: true });
  });

  it("counts only a viewer's own leads when that is all they may see", async () => {
    const result = await socialAttribution(staff(otherUserId, ["social.analytics.view", "leads.view"]), { clientId: clientA, range: RANGE });
    if (!result.available) throw new Error("expected attribution");
    expect(result.ownLeadsOnly).toBe(true);
    expect(result.totals.leads).toBe(otherUserId === userId ? 2 : 1);
  });

  it("needs lead access, and is never shown to a portal user", async () => {
    expect(await socialAttribution(staff(userId, ["social.analytics.view"]), { clientId: clientA, range: RANGE })).toEqual({
      available: false,
      reason: "no-lead-access",
    });
    const portal: Actor = { ...staff(userId, ALL), type: "CLIENT", clientId: clientA, roleName: "CLIENT_USER" };
    await expect(socialAttribution(portal, { clientId: clientA, range: RANGE })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gives each client only the leads that came through its own campaigns", async () => {
    // The "other client" lead: excluded from A above, and B's alone here.
    const result = await socialAttribution(staff(userId, ALL), { clientId: clientB, range: RANGE });
    if (!result.available) throw new Error("expected attribution");
    expect(result.totals).toMatchObject({ leads: 1, opportunities: 0, clients: 0, revenue: "0.00" });
    expect(result.campaigns.map((c) => c.id)).toEqual([otherCampaign]);
    expect(result.posts).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Insights, end to end
  // -------------------------------------------------------------------------

  it("builds trends from what each day added, and days per platform", async () => {
    const today = new Date();
    const day = (offset: number) => {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
      return d;
    };
    await db.socialMetricSnapshot.createMany({
      data: [
        { postId: postTagged, clientId: clientA, capturedOn: day(2), impressions: 100, likes: 10, reach: 80 },
        { postId: postTagged, clientId: clientA, capturedOn: day(1), impressions: 250, likes: 25, reach: 200 },
      ],
    });
    const insights = await socialInsights(staff(userId, ALL), { clientId: clientA, range: resolveRange("7d"), provider: null });

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const byDay = new Map(insights.trend.map((p) => [p.day, p]));
    expect(byDay.get(key(day(2)))).toMatchObject({ impressions: 100, engagement: 10 });
    expect(byDay.get(key(day(1)))).toMatchObject({ impressions: 150, engagement: 15 });
    expect(insights.provider).toBe("INSTAGRAM");
    expect(insights.weekdays).toHaveLength(7);
    expect(insights.types[0]).toMatchObject({ provider: "INSTAGRAM", type: "REEL", posts: 1, measured: 1 });
    expect(insights.lowest[0]).toMatchObject({ postId: postTagged, engagement: 25, rate: 12.5 });
    // One measured post is not a sample.
    expect(insights.bestDay).toBeNull();
  });
});
