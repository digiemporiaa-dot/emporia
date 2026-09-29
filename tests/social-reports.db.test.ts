import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { periodSummary, listPublished, PUBLISHED_PAGE_SIZE } from "@/lib/services/social-summary.service";
import { socialOverview } from "@/lib/services/social-overview.service";
import { clientApprovalQueue } from "@/lib/services/social-approval.service";
import {
  generateReport,
  getReport,
  listReports,
  portalReports,
  reportableMonths,
  setReportNotes,
  setReportPublished,
} from "@/lib/services/social-report.service";
import { reportCsv } from "@/lib/social/report-doc";
import { buildGrid } from "@/lib/social/calendar";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Overview, Published, Approvals queue, monthly reports, and the board view.
 *
 * Pinned: figures come from stored rows only, and a figure nobody reported is
 * null; engagement rate is total engagement over total reach, not an average
 * of rates; "top" is by rate; months are India-time months; a report is only
 * for a completed month, frozen when generated, regenerable only as a draft,
 * and visible to a client only once published — and only their own.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `srp${Date.now()}`;

function staff(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Account manager",
    email: "am@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const ALL = ["social.view", "social.analytics.view", "social.reports.view", "social.reports.manage"];

// A completed month well inside the reportable window, and its neighbours.
const NOW = new Date("2026-10-15T06:00:00Z");
const MONTH = "2026-09";

describeDb("overview, published, approvals and reports", () => {
  let userId = "";
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let campaign = "";
  let manager: Actor;
  let portalA: PortalActor;
  let portalB: PortalActor;

  async function post(data: {
    provider?: "INSTAGRAM" | "LINKEDIN";
    type?: "REEL" | "TEXT" | "CAROUSEL";
    at: string;
    status?: "PUBLISHED" | "SCHEDULED" | "FAILED" | "DRAFT";
    metrics?: Record<string, number | null>;
    campaignId?: string | null;
    title?: string;
    clientId?: string;
  }) {
    const clientId = data.clientId ?? clientA;
    const item = await db.contentCalendarItem.create({
      data: {
        clientId,
        projectId: projectA,
        title: data.title ?? `${TAG} post ${data.at}`,
        channel: "INSTAGRAM",
        stage: data.status === "PUBLISHED" || data.status === undefined ? "PUBLISHED" : "APPROVED",
        campaignId: data.campaignId ?? null,
      },
      select: { id: true },
    });
    const created = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        provider: data.provider ?? "INSTAGRAM",
        type: data.type ?? "REEL",
        status: data.status ?? "PUBLISHED",
        publishedAt: (data.status ?? "PUBLISHED") === "PUBLISHED" ? new Date(data.at) : null,
        scheduledFor: new Date(data.at),
        externalUrl: "https://example.com/p",
      },
      select: { id: true },
    });
    if (data.metrics) {
      await db.socialMetricSnapshot.create({
        data: { postId: created.id, clientId, capturedOn: new Date(data.at.slice(0, 10)), ...data.metrics },
      });
    }
    return { itemId: item.id, postId: created.id };
  }

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    manager = staff(userId, ALL);
    const [a, b] = await Promise.all(
      ["A", "B"].map((k) => db.client.create({ data: { name: `${TAG} ${k}`, slug: `${TAG}-${k.toLowerCase()}` }, select: { id: true } })),
    );
    clientA = a!.id;
    clientB = b!.id;
    projectA = (
      await db.project.create({
        data: { code: `R-${TAG}`.slice(0, 20), name: "Retainer", clientId: clientA, managerId: userId, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    campaign = (
      await db.campaign.create({ data: { name: `${TAG} Festive`, clientId: clientA, platform: "META_ADS", ownerId: userId, startsAt: new Date() }, select: { id: true } })
    ).id;
    const portal = (clientId: string): PortalActor => ({
      userId,
      type: "CLIENT",
      name: "Client",
      email: "c@example.com",
      roleName: "CLIENT_USER",
      roleId: null,
      clientId,
      permissions: new Set<string>(),
      ip: null,
      userAgent: "vitest",
    });
    portalA = portal(clientA);
    portalB = portal(clientB);

    // September (India time).
    await post({ at: "2026-09-05T13:30:00Z", metrics: { reach: 1_000, impressions: 1_500, likes: 90, comments: 10, followersGained: 4 }, campaignId: campaign, title: `${TAG} Loved reel` });
    await post({ at: "2026-09-12T13:30:00Z", metrics: { reach: 9_000, impressions: 12_000, likes: 180, comments: 0, followersGained: null } });
    await post({ provider: "LINKEDIN", type: "TEXT", at: "2026-09-20T06:00:00Z" }); // unmeasured
    // 30 Sep 20:00 UTC is 1 Oct 01:30 in India: October's, not September's.
    await post({ at: "2026-09-30T20:00:00Z", metrics: { reach: 50, likes: 50 } });
    // August, for month over month.
    await post({ at: "2026-08-10T13:30:00Z", metrics: { reach: 2_000, impressions: 3_000, likes: 20 } });
    // October plan (the month after the report).
    await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: `${TAG} October idea`, channel: "INSTAGRAM", stage: "DRAFT", scheduledFor: new Date("2026-10-08T04:30:00Z") },
    });
  });

  afterAll(async () => {
    await db.socialReport.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.approval.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialInternalReview.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialMetricSnapshot.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.campaign.deleteMany({ where: { id: campaign } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // The shared period summary
  // -------------------------------------------------------------------------

  it("sums what was reported for an India-time month, and picks the top by rate", async () => {
    const s = await periodSummary(clientA, new Date("2026-08-31T18:30:00Z"), new Date("2026-09-30T18:30:00Z"));
    expect(s.posts).toBe(3);
    expect(s.measured).toBe(2);
    expect(s.totals.reach).toEqual({ value: 10_000, reporting: 2, total: 3 });
    expect(s.totals.followersGained).toEqual({ value: 4, reporting: 1, total: 3 });
    expect(s.totals.engagement.value).toBe(280);
    // Total engagement over total reach: 280 / 10,000 — not the mean of 10% and 2%.
    expect(s.rate.value).toBeCloseTo(2.8, 5);
    expect(s.topPost).toMatchObject({ title: `${TAG} Loved reel`, rate: 10 });
    expect(s.topPlatform?.provider).toBe("INSTAGRAM");
    expect(s.topCampaign).toMatchObject({ id: campaign, rate: 10 });
    expect(s.byProvider.find((p) => p.provider === "LINKEDIN")).toMatchObject({ posts: 1, measured: 0, rate: null });
  });

  // -------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------

  it("counts work in progress from stored rows, and shows figures only to analytics viewers", async () => {
    await post({ at: "2026-11-01T06:00:00Z", status: "SCHEDULED" });
    await post({ at: "2026-09-02T06:00:00Z", status: "FAILED" });
    const pending = await post({ at: "2026-11-02T06:00:00Z", status: "DRAFT" });
    await db.socialInternalReview.create({
      data: { contentItemId: pending.itemId, clientId: clientA, round: 1, snapshot: {}, submittedById: userId },
    });
    await db.approval.create({
      data: { clientId: clientA, contentItemId: pending.itemId, title: "Social", requestedById: userId, status: "PENDING" },
    });
    // A non-social approval for the same client is not counted.
    const plain = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: `${TAG} blog`, channel: "BLOG", stage: "CLIENT_REVIEW" },
      select: { id: true },
    });
    await db.approval.create({ data: { clientId: clientA, contentItemId: plain.id, title: "Blog", requestedById: userId, status: "PENDING" } });

    const overview = await socialOverview(manager, clientA, NOW);
    expect(overview.work).toEqual({ internalReviews: 1, clientApprovals: 1, scheduled: 1, failed: 1 });
    expect(overview.performance?.posts).toBe(1); // the 1 Oct (India) post
    expect(overview.platforms.find((p) => p.provider === "INSTAGRAM")?.accounts).toEqual([]);

    const noAnalytics = await socialOverview(staff(userId, ["social.view"]), clientA, NOW);
    expect(noAnalytics.performance).toBeNull();
    await expect(socialOverview(staff(userId, []), clientA, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    const queue = await clientApprovalQueue(manager, clientA);
    expect(queue.pending.map((a) => a.contentItem?.id)).toEqual([pending.itemId]);
  });

  // -------------------------------------------------------------------------
  // Published
  // -------------------------------------------------------------------------

  it("pages published posts newest first, filters by platform, and hides figures without analytics", async () => {
    const all = await listPublished(manager, { clientId: clientA, provider: null, campaignId: null, page: 1 });
    expect(all.total).toBe(5);
    expect(all.posts.map((p) => p.publishedAt)).toEqual([...all.posts.map((p) => p.publishedAt)].sort().reverse());
    expect(all.posts.every((p) => p.figures !== null)).toBe(true);
    expect(PUBLISHED_PAGE_SIZE).toBeGreaterThanOrEqual(5);

    const linkedin = await listPublished(manager, { clientId: clientA, provider: "LINKEDIN", campaignId: null, page: 1 });
    expect(linkedin.total).toBe(1);
    expect(linkedin.posts[0]?.figures).toEqual({ reach: null, impressions: null, engagement: null, rate: null });

    const bare = await listPublished(staff(userId, ["social.view"]), { clientId: clientA, provider: null, campaignId: null, page: 1 });
    expect(bare.posts.every((p) => p.figures === null)).toBe(true);
    expect((await listPublished(manager, { clientId: clientB, provider: null, campaignId: campaign, page: 1 })).total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  it("offers only completed months from the last two years", async () => {
    const months = reportableMonths(NOW);
    expect(months[0]).toBe("2026-09");
    expect(months).not.toContain("2026-10");
    expect(months).toHaveLength(24);
    await expect(generateReport(manager, { clientId: clientA, month: "2026-10" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    await expect(generateReport(manager, { clientId: clientA, month: "2024-01" }, NOW)).rejects.toBeInstanceOf(ValidationError);
  });

  it("freezes the month's figures, the month before, and the plan for the month after", async () => {
    const { id } = await generateReport(manager, { clientId: clientA, month: MONTH }, NOW);
    const report = await getReport(manager, id);
    expect(report.status).toBe("DRAFT");
    expect(report.data.current).toMatchObject({ posts: 3, measured: 2, reach: { value: 10_000, reporting: 2, total: 3 } });
    expect(report.data.current.rate.value).toBeCloseTo(2.8, 5);
    expect(report.data.previous).toMatchObject({ posts: 1, reach: { value: 2_000, reporting: 1, total: 1 } });
    expect(report.data.topPost?.title).toBe(`${TAG} Loved reel`);
    expect(report.data.topCampaign?.name).toBe(`${TAG} Festive`);
    expect(report.data.nextMonth).toMatchObject({ month: "2026-10", ideas: 1 });
    expect(report.data.nextMonth.items[0]).toMatchObject({ title: `${TAG} October idea`, day: "2026-10-08" });

    // Frozen: a late snapshot does not change the report until it is regenerated.
    const late = await post({ at: "2026-09-25T13:30:00Z", metrics: { reach: 500, likes: 5 } });
    expect((await getReport(manager, id)).data.current.posts).toBe(3);
    await generateReport(manager, { clientId: clientA, month: MONTH }, NOW);
    expect((await getReport(manager, id)).data.current.posts).toBe(4);
    await db.contentCalendarItem.delete({ where: { id: late.itemId } });
    await generateReport(manager, { clientId: clientA, month: MONTH }, NOW);
  });

  it("keeps drafts from the client, and publishes only to the client it belongs to", async () => {
    const { id } = await generateReport(manager, { clientId: clientA, month: MONTH }, NOW);
    await expect(getReport(portalA, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await portalReports(portalA)).toEqual([]);

    await setReportNotes(manager, id, "Reels carried the month.");
    await setReportPublished(manager, id, true);
    expect((await getReport(portalA, id)).notes).toBe("Reels carried the month.");
    expect((await portalReports(portalA)).map((r) => r.id)).toEqual([id]);
    await expect(getReport(portalB, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await portalReports(portalB)).toEqual([]);

    // Published is frozen: no regeneration, no note changes, until unpublished.
    await expect(generateReport(manager, { clientId: clientA, month: MONTH }, NOW)).rejects.toBeInstanceOf(ConflictError);
    await expect(setReportNotes(manager, id, "Edited")).rejects.toBeInstanceOf(ConflictError);
    await setReportPublished(manager, id, false);
    await expect(getReport(portalA, id)).rejects.toBeInstanceOf(NotFoundError);

    const audits = await db.auditLog.count({ where: { entityType: "SocialReport", entityId: id, action: "STATUS_CHANGE" } });
    expect(audits).toBe(2);
  });

  it("needs the report permissions, and never lets a client generate or list", async () => {
    await expect(listReports(staff(userId, ["social.view"]), clientA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(generateReport(staff(userId, ["social.view", "social.reports.view"]), { clientId: clientA, month: "2026-08" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const clientWithPerms = { ...portalA, permissions: new Set(ALL) };
    await expect(generateReport(clientWithPerms, { clientId: clientA, month: "2026-08" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listReports(clientWithPerms, clientA)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("downloads as CSV with figures, and defuses a title a spreadsheet would run", async () => {
    const { id } = await generateReport(manager, { clientId: clientA, month: MONTH }, NOW);
    const data = (await getReport(manager, id)).data;
    const csv = reportCsv({ ...data, topPost: data.topPost ? { ...data.topPost, title: "=HYPERLINK(\"x\")" } : null });
    expect(csv).toContain("Posts published,3");
    expect(csv).toContain("Reach,10000,2,3");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  // -------------------------------------------------------------------------
  // Board
  // -------------------------------------------------------------------------

  it("gives the board the month the list covers", () => {
    const board = buildGrid("board", { year: 2026, month: 9, day: 14 }, "Asia/Kolkata", NOW);
    const list = buildGrid("list", { year: 2026, month: 9, day: 14 }, "Asia/Kolkata", NOW);
    expect(board.range).toEqual(list.range);
    expect(board.view).toBe("board");
    expect(board.days).toHaveLength(30);
  });
});
