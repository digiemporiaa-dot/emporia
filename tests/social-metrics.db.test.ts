import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  COLLECT_FOR_DAYS,
  collectMetrics,
  metricsForPost,
  socialReport,
} from "@/lib/services/social-metrics.service";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { encryptSecret } from "@/lib/security/secret";
import { startLinkedInDouble, type LinkedInDouble } from "./support/linkedin-double";
import type { Actor } from "@/lib/actor/types";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * Reading numbers back, and reporting them.
 *
 * Nearly every test here is a variation on one rule: **absent is not zero**. A
 * metric the platform does not report must never become a 0 that flows into a
 * sum, an average, and eventually a slide a client is shown.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `met8-${Date.now()}`;
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

function staffWith(userId: string, permissions: string[]): Actor {
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

describeDb("social metrics", () => {
  let double: LinkedInDouble;
  let resolve: (p: SocialProvider) => Promise<LinkedInProvider | UnconfiguredSocialProvider>;
  let staff: Actor;
  let clientA = "";
  let projectA = "";
  let accountA = "";
  let userId = "";
  let counter = 0;

  async function published(over: {
    provider?: SocialProvider;
    publishedAt?: Date;
    externalPostId?: string | null;
    accountId?: string | null;
  } = {}) {
    counter += 1;
    const item = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        title: `${SUFFIX} idea ${counter}`,
        channel: "LINKEDIN",
        stage: "PUBLISHED",
      },
      select: { id: true },
    });
    return db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId: clientA,
        accountId: over.accountId === undefined ? accountA : over.accountId,
        provider: over.provider ?? "LINKEDIN",
        type: "TEXT",
        status: "PUBLISHED",
        caption: `Copy ${counter}.`,
        publishedAt: over.publishedAt ?? ago(1),
        externalPostId:
          over.externalPostId === undefined
            ? "urn:li:share:7000000000000000001"
            : over.externalPostId,
        externalUrl: "https://www.linkedin.com/feed/update/x",
      },
      select: { id: true, contentItemId: true },
    });
  }

  beforeAll(async () => {
    double = await startLinkedInDouble();
    const provider = new LinkedInProvider({
      clientId: "app-id",
      clientSecret: "app-secret",
      authBase: `${double.url}/oauth/v2`,
      apiBase: `${double.url}/v2`,
      restBase: `${double.url}/rest`,
    });
    resolve = async (which) =>
      which === "LINKEDIN" ? provider : new UnconfiguredSocialProvider(which);

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    staff = staffWith(user.id, ["social.view", "social.analytics.view"]);

    const client = await db.client.create({
      data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` },
      select: { id: true },
    });
    clientA = client.id;

    const project = await db.project.create({
      data: {
        code: `${SUFFIX}-A`.slice(0, 20),
        name: "A retainer",
        clientId: clientA,
        managerId: user.id,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectA = project.id;

    const account = await db.socialAccount.create({
      data: {
        clientId: clientA,
        provider: "LINKEDIN",
        externalId: `${SUFFIX}-member`,
        name: "Northwind on LinkedIn",
        status: "CONNECTED",
        accessToken: encryptSecret("li-access-token"),
      },
      select: { id: true },
    });
    accountA = account.id;
  });

  afterEach(async () => {
    await db.socialMetricSnapshot.deleteMany({ where: { clientId: clientA } });
    await db.socialPost.deleteMany({ where: { clientId: clientA } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: clientA } });
  });

  afterAll(async () => {
    await double.close();
    await db.socialAccount.deleteMany({ where: { clientId: clientA } });
    await db.project.deleteMany({ where: { clientId: clientA } });
    await db.client.deleteMany({ where: { id: clientA } });
  });

  // -------------------------------------------------------------------------
  // Collection
  // -------------------------------------------------------------------------

  it("captures what the platform reported", async () => {
    const post = await published();
    const run = await collectMetrics(new Date(), resolve);

    expect(run.captured).toBe(1);
    const snapshot = await db.socialMetricSnapshot.findFirstOrThrow({
      where: { postId: post.id },
      select: { likes: true, comments: true, impressions: true, reach: true },
    });
    expect(snapshot.likes).toBe(12);
    expect(snapshot.comments).toBe(3);
  });

  it("stores what the platform would not say as null, never as zero", async () => {
    const post = await published();
    await collectMetrics(new Date(), resolve);

    const snapshot = await db.socialMetricSnapshot.findFirstOrThrow({
      where: { postId: post.id },
      select: { impressions: true, reach: true, clicks: true, shares: true },
    });
    // The whole point. Zero would be a measurement nobody made.
    expect(snapshot.impressions).toBeNull();
    expect(snapshot.reach).toBeNull();
    expect(snapshot.clicks).toBeNull();
    expect(snapshot.shares).toBeNull();
  });

  it("keeps one snapshot per day and updates it on a second run", async () => {
    const post = await published();
    await collectMetrics(new Date(), resolve);

    double.engagement({ likesSummary: { totalLikes: 30 }, commentsSummary: { aggregatedTotalComments: 9 } });
    await collectMetrics(new Date(), resolve);
    double.engagement({ likesSummary: { totalLikes: 12 }, commentsSummary: { aggregatedTotalComments: 3 } });

    const snapshots = await db.socialMetricSnapshot.findMany({
      where: { postId: post.id },
      select: { likes: true },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.likes).toBe(30);
  });

  it("skips a platform that does not report metrics instead of writing zeros", async () => {
    const post = await published({ provider: "X" });
    const run = await collectMetrics(new Date(), resolve);

    expect(run.skipped.find((s) => s.postId === post.id)?.reason).toContain("does not report");
    expect(await db.socialMetricSnapshot.count({ where: { postId: post.id } })).toBe(0);
  });

  it("writes nothing when the platform reports no figures at all", async () => {
    const post = await published();
    double.engagement({ likesSummary: {}, commentsSummary: {} });

    const run = await collectMetrics(new Date(), resolve);
    double.engagement({ likesSummary: { totalLikes: 12 }, commentsSummary: { aggregatedTotalComments: 3 } });

    // A row of nulls would claim we measured and found nothing.
    expect(run.skipped.find((s) => s.postId === post.id)?.reason).toContain("no figures");
    expect(await db.socialMetricSnapshot.count({ where: { postId: post.id } })).toBe(0);
  });

  it("stops asking about posts older than the collection window", async () => {
    await published({ publishedAt: ago(COLLECT_FOR_DAYS + 2) });
    const run = await collectMetrics(new Date(), resolve);
    expect(run.attempted).toBe(0);
  });

  it("skips a post with no external id to ask about", async () => {
    await published({ externalPostId: null });
    const run = await collectMetrics(new Date(), resolve);
    expect(run.attempted).toBe(0);
  });

  it("records a platform failure without stopping the run", async () => {
    const broken = await published();
    await published();
    double.failWith("socialActions", 500);

    const run = await collectMetrics(new Date(), resolve);
    expect(run.failed.length + run.captured).toBe(2);
    expect(run.captured).toBe(1);
    expect(broken.id).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  it("totals only the posts that reported, and says how many did", async () => {
    await published();
    await published();
    await collectMetrics(new Date(), resolve);
    // A third post nobody has metrics for.
    await published();

    const report = await socialReport(staff, { clientId: clientA, from: ago(30), to: ago(-1) });

    expect(report.posts).toBe(3);
    expect(report.measured).toBe(2);
    expect(report.totals.likes).toEqual({ value: 24, reporting: 2, total: 3 });
  });

  it("reports a metric nobody measured as absent rather than zero", async () => {
    await published();
    await collectMetrics(new Date(), resolve);

    const report = await socialReport(staff, { clientId: clientA, from: ago(30), to: ago(-1) });

    // The difference between "nobody saw it" and "we were not told".
    expect(report.totals.impressions.value).toBeNull();
    expect(report.totals.impressions.reporting).toBe(0);
    expect(report.totals.likes.value).toBe(12);
  });

  it("says which platforms cannot report at all", async () => {
    await published({ provider: "X" });
    await published({ provider: "LINKEDIN" });
    await collectMetrics(new Date(), resolve);

    const report = await socialReport(staff, { clientId: clientA, from: ago(30), to: ago(-1) });
    const x = report.byProvider.find((entry) => entry.provider === "X")!;
    const linkedin = report.byProvider.find((entry) => entry.provider === "LINKEDIN")!;

    expect(x.reportsMetrics).toBe(false);
    expect(x.measured).toBe(0);
    expect(linkedin.reportsMetrics).toBe(true);
    expect(linkedin.measured).toBe(1);
  });

  it("ranks the best posts by what was actually reported", async () => {
    const quiet = await published();
    await collectMetrics(new Date(), resolve);

    double.engagement({ likesSummary: { totalLikes: 500 }, commentsSummary: { aggregatedTotalComments: 50 } });
    const loud = await published();
    await collectMetrics(new Date(), resolve);
    double.engagement({ likesSummary: { totalLikes: 12 }, commentsSummary: { aggregatedTotalComments: 3 } });

    const report = await socialReport(staff, { clientId: clientA, from: ago(30), to: ago(-1) });
    expect(report.top[0]!.postId).toBe(loud.id);
    expect(report.top.map((entry) => entry.postId)).toContain(quiet.id);
  });

  it("leaves unmeasured posts out of the ranking rather than ranking them zero", async () => {
    await published();
    const report = await socialReport(staff, { clientId: clientA, from: ago(30), to: ago(-1) });
    expect(report.top).toHaveLength(0);
    expect(report.posts).toBe(1);
  });

  it("honours the date range", async () => {
    await published({ publishedAt: ago(40) });
    const report = await socialReport(staff, { clientId: clientA, from: ago(7), to: ago(-1) });
    expect(report.posts).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Permissions and isolation
  // -------------------------------------------------------------------------

  it("refuses an actor without social.analytics.view", async () => {
    const viewer = staffWith(userId, ["social.view"]);
    await expect(
      socialReport(viewer, { clientId: clientA, from: ago(30), to: ago(-1) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never lets a portal user report on another client", async () => {
    const other = await db.client.create({
      data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` },
      select: { id: true },
    });
    const portal: Actor = {
      ...staffWith(userId, ["social.view", "social.analytics.view"]),
      type: "CLIENT",
      roleName: "CLIENT_USER",
      clientId: other.id,
    };

    await expect(
      socialReport(portal, { clientId: clientA, from: ago(30), to: ago(-1) }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await published();
    const own = await socialReport(portal, { clientId: null, from: ago(30), to: ago(-1) });
    expect(own.posts).toBe(0);

    await db.client.delete({ where: { id: other.id } });
  });

  it("gives one post its own history", async () => {
    const post = await published();
    await collectMetrics(new Date(), resolve);

    const history = await metricsForPost(staff, post.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.likes).toBe(12);
  });
});
