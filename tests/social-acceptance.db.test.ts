import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { connectAccount } from "@/lib/services/social-account.service";
import { completePendingConnection, startPendingConnection } from "@/lib/services/social-pending.service";
import { createSocialContent } from "@/lib/services/social-content.service";
import { savePost, setPostStatus } from "@/lib/services/social-post.service";
import { decideInternalReview, submitForInternalReview } from "@/lib/services/social-review.service";
import { requestSocialApproval } from "@/lib/services/social-approval.service";
import { decideApproval, getApproval, listApprovals } from "@/lib/services/portal.service";
import { publishDuePosts, type ResolveAdapter } from "@/lib/services/social-publish.service";
import { collectMetrics, socialReport } from "@/lib/services/social-metrics.service";
import { generateReport, getReport } from "@/lib/services/social-report.service";
import { socialPostSchema } from "@/lib/validation/social";
import { InstagramProvider } from "@/lib/social/instagram";
import { FacebookProvider } from "@/lib/social/facebook";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { CALENDAR_TIME_ZONE, zonedDay } from "@/lib/social/calendar";
import { startInstagramDouble, type InstagramDouble } from "./support/instagram-double";
import { startFacebookDouble, type FacebookDouble } from "./support/facebook-double";
import { startLinkedInDouble, type LinkedInDouble } from "./support/linkedin-double";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * The brief's acceptance scenario (§55), end to end, in one run.
 *
 * Create ABC Technologies; connect Instagram, Facebook and LinkedIn; create
 * the Diwali 2026 campaign and one idea with a different post per platform;
 * attach the creative; internal review; send to the client; the client sees
 * three posts pending and asks for a change on LinkedIn; a new version goes
 * back; the client approves; the posts are scheduled; the scheduler publishes
 * them and stores their external ids; analytics sync runs; the figures appear
 * in the dashboard; the monthly report includes the posts; and the audit trail
 * shows created, reviewed, approved, scheduled, published and synced.
 *
 * Every step is the real service a screen calls. The platforms are the
 * wire-level doubles the adapter tests use, running the real adapter code —
 * the one thing not exercised here is a live platform, which needs real
 * credentials.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `acc${Date.now()}`;

function staff(userId: string, name: string, permissions: string[]): Actor {
  return {
    userId,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@emporia.test`,
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("acceptance: ABC Technologies, Diwali 2026", () => {
  let ig: InstagramDouble;
  let fb: FacebookDouble;
  let li: LinkedInDouble;
  let resolve: ResolveAdapter;
  let instagram: InstagramProvider;
  let facebook: FacebookProvider;
  let linkedin: LinkedInProvider;

  let manager: Actor;
  let reviewer: Actor;
  let client: PortalActor;
  let clientId = "";
  let projectId = "";
  let campaignId = "";
  let mediaId = "";
  let itemId = "";
  let approvalId = "";
  const accounts: Record<"INSTAGRAM" | "FACEBOOK" | "LINKEDIN", string> = { INSTAGRAM: "", FACEBOOK: "", LINKEDIN: "" };
  const posts: Record<"INSTAGRAM" | "FACEBOOK" | "LINKEDIN", string> = { INSTAGRAM: "", FACEBOOK: "", LINKEDIN: "" };
  const at = new Date(Date.now() + 60 * 60 * 1000);

  const version = (provider: keyof typeof posts, caption: string, extra: Record<string, unknown> = {}) =>
    socialPostSchema.parse({
      contentItemId: itemId,
      provider,
      type: provider === "LINKEDIN" ? "TEXT" : "SINGLE_IMAGE",
      caption,
      accountId: accounts[provider],
      scheduledFor: at,
      mediaIds: provider === "LINKEDIN" ? [] : [mediaId],
      ...extra,
    });

  beforeAll(async () => {
    [ig, fb, li] = await Promise.all([startInstagramDouble(), startFacebookDouble(), startLinkedInDouble()]);
    instagram = new InstagramProvider({
      clientId: "ig-app",
      clientSecret: "ig-secret",
      authorizeBase: ig.url,
      authBase: ig.url,
      graphBase: ig.url,
      pollIntervalMs: 10,
      timeoutMs: 2_000,
    });
    facebook = new FacebookProvider({
      clientId: "fb-app",
      clientSecret: "fb-secret",
      dialogBase: fb.url,
      graphBase: fb.url,
      videoBase: fb.url,
      ruploadBase: fb.url,
      timeoutMs: 2_000,
    });
    linkedin = new LinkedInProvider({
      clientId: "li-app",
      clientSecret: "li-secret",
      authBase: `${li.url}/oauth/v2`,
      apiBase: `${li.url}/v2`,
      restBase: `${li.url}/rest`,
    });
    resolve = async (which) =>
      which === "INSTAGRAM" ? instagram : which === "FACEBOOK" ? facebook : which === "LINKEDIN" ? linkedin : new UnconfiguredSocialProvider(which);

    const users = await db.user.findMany({ where: { type: "STAFF" }, take: 2, select: { id: true } });
    manager = staff(users[0]!.id, "Account Manager", [
      "social.view",
      "social.create",
      "social.edit",
      "social.approve",
      "social.publish",
      "social.accounts.manage",
      "social.analytics.view",
      "social.reports.view",
      "social.reports.manage",
    ]);
    reviewer = staff(users[1]?.id ?? users[0]!.id, "Reviewer", ["social.view", "social.review"]);
  });

  afterAll(async () => {
    if (clientId) {
      await db.socialReport.deleteMany({ where: { clientId } });
      await db.approval.deleteMany({ where: { clientId } });
      await db.socialMetricSnapshot.deleteMany({ where: { clientId } });
      await db.socialPublication.deleteMany({ where: { clientId } });
      await db.socialPostMedia.deleteMany({ where: { post: { clientId } } });
      await db.socialPost.deleteMany({ where: { clientId } });
      await db.socialInternalReview.deleteMany({ where: { clientId } });
      await db.contentCalendarItem.deleteMany({ where: { clientId } });
      await db.socialAccount.deleteMany({ where: { clientId } });
      await db.socialPendingConnection.deleteMany({ where: { clientId } });
      await db.campaign.deleteMany({ where: { clientId } });
      await db.project.deleteMany({ where: { clientId } });
      await db.client.deleteMany({ where: { id: clientId } });
    }
    if (mediaId) await db.media.deleteMany({ where: { id: mediaId } });
    await Promise.all([ig?.close(), fb?.close(), li?.close()]);
  });

  it("runs the whole scenario", async () => {
    // --- Create client, project, campaign --------------------------------
    clientId = (await db.client.create({ data: { name: `ABC Technologies ${TAG}`, slug: `abc-${TAG}` }, select: { id: true } })).id;
    projectId = (
      await db.project.create({
        data: { code: `ABC-${TAG}`.slice(0, 20), name: "Social retainer", clientId, managerId: manager.userId, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    client = {
      userId: manager.userId,
      type: "CLIENT",
      name: "ABC marketing lead",
      email: "lead@abc.example",
      roleName: "CLIENT_USER",
      roleId: null,
      clientId,
      permissions: new Set<string>(),
      ip: null,
      userAgent: "vitest",
    };

    // --- Connect Instagram, Facebook, LinkedIn -----------------------------
    const igCredentials = { accessToken: "ig-long-token", refreshToken: null, expiresAt: null };
    accounts.INSTAGRAM = (
      await connectAccount(manager, { clientId, provider: "INSTAGRAM", account: await instagram.getAccount(igCredentials), credentials: igCredentials })
    ).id;
    const fbCredentials = { accessToken: "fb-long-user", refreshToken: null, expiresAt: null };
    const pending = await startPendingConnection(manager, {
      clientId,
      provider: "FACEBOOK",
      credentials: fbCredentials,
      accounts: await facebook.listAccounts(fbCredentials),
      returnTo: `/admin/clients/${clientId}/social/accounts`,
    });
    accounts.FACEBOOK = (await completePendingConnection(manager, pending, "1001", resolve)).account.id;
    const liCredentials = { accessToken: "li-access-token", refreshToken: null, expiresAt: null };
    accounts.LINKEDIN = (
      await connectAccount(manager, { clientId, provider: "LINKEDIN", account: await linkedin.getAccount(liCredentials), credentials: liCredentials })
    ).id;
    expect(await db.socialAccount.count({ where: { clientId, status: "CONNECTED" } })).toBe(3);

    campaignId = (
      await db.campaign.create({ data: { name: "Diwali 2026", clientId, platform: "META_ADS", ownerId: manager.userId, startsAt: new Date(), status: "ACTIVE" }, select: { id: true } })
    ).id;

    // --- Create content: one idea, a different post per platform -----------
    itemId = (
      await createSocialContent(manager, {
        clientId,
        projectId,
        title: "Diwali 2026 — light up your business",
        brief: "Festive offer for ABC's cloud platform.",
        campaignId,
        ownerId: manager.userId,
        scheduledFor: at,
      })
    ).id;

    // The creative, as the media library stores it after an upload.
    mediaId = (
      await db.media.create({
        data: { key: `${TAG}/diwali.jpg`, url: "https://cdn.example.com/diwali.jpg", filename: "diwali.jpg", mimeType: "image/jpeg", size: 240_000, type: "IMAGE", uploadedById: manager.userId },
        select: { id: true },
      })
    ).id;

    posts.INSTAGRAM = (await savePost(manager, null, version("INSTAGRAM", "Light up your Diwali with ABC Cloud ✨ #Diwali2026"))).id;
    posts.FACEBOOK = (await savePost(manager, null, version("FACEBOOK", "This Diwali, ABC Cloud keeps your business running while you celebrate."))).id;
    posts.LINKEDIN = (
      await savePost(manager, null, version("LINKEDIN", "As India celebrates Diwali, we are proud to share how ABC Technologies helped 200 teams modernise their infrastructure this year. Here is what we learned along the way, and what comes next for our customers."))
    ).id;
    const captions = await db.socialPost.findMany({ where: { contentItemId: itemId }, select: { caption: true } });
    expect(new Set(captions.map((c) => c.caption)).size).toBe(3);

    // --- Internal review, then to the client -------------------------------
    await submitForInternalReview(manager, { contentItemId: itemId, note: "Ready for Diwali." });
    await decideInternalReview(reviewer, { contentItemId: itemId, decision: "APPROVED", feedback: null });
    approvalId = (await requestSocialApproval(manager, { contentItemId: itemId, note: "Three posts for Diwali." })).approvalId;

    // --- The client logs in and sees three posts pending -------------------
    const pendingForClient = (await listApprovals(client)).filter((a) => a.status === "PENDING");
    expect(pendingForClient.map((a) => a.id)).toEqual([approvalId]);
    const shown = await getApproval(client, approvalId);
    expect(shown.versions[0]!.snapshot?.posts.map((p) => p.provider).sort()).toEqual(["FACEBOOK", "INSTAGRAM", "LINKEDIN"]);

    // --- Change requested on LinkedIn; a new version goes back -------------
    await decideApproval(client, approvalId, "CHANGES_REQUESTED", "LinkedIn: please make it shorter and mention the Diwali offer.");
    await savePost(manager, posts.LINKEDIN, version("LINKEDIN", "Diwali offer: 20% off ABC Cloud for new teams until 15 November. Happy Diwali from ABC Technologies."));
    await submitForInternalReview(manager, { contentItemId: itemId, note: "LinkedIn shortened." });
    await decideInternalReview(reviewer, { contentItemId: itemId, decision: "APPROVED", feedback: null });
    const second = await requestSocialApproval(manager, { contentItemId: itemId, note: "LinkedIn updated." });
    expect(second).toEqual({ approvalId, version: 2 });

    const history = await getApproval(client, approvalId);
    expect(history.versions.map((v) => [v.version, v.status])).toEqual([
      [2, "PENDING"],
      [1, "CHANGES_REQUESTED"],
    ]);
    // Never overwritten: version 1 still says what the client first saw.
    expect(history.versions[1]!.feedback).toContain("LinkedIn");
    expect(history.versions[1]!.snapshot?.posts.find((p) => p.provider === "LINKEDIN")?.caption).toContain("200 teams");
    expect(history.versions[0]!.snapshot?.posts.find((p) => p.provider === "LINKEDIN")?.caption).toContain("20% off");

    // --- The client approves the final version -----------------------------
    await decideApproval(client, approvalId, "APPROVED", null);
    expect((await db.contentCalendarItem.findUniqueOrThrow({ where: { id: itemId } })).stage).toBe("APPROVED");

    // --- Scheduled, then published by the scheduler ------------------------
    for (const id of Object.values(posts)) await setPostStatus(manager, id, "SCHEDULED");
    const run = await publishDuePosts(new Date(at.getTime() + 60_000), resolve);
    // The scheduler runs over every due post in the database; this scenario
    // asserts on its own three.
    const ours = Object.values(posts);
    expect(run.failed.filter((f) => ours.includes(f.postId)).map((f) => f.reason)).toEqual([]);

    const published = await db.socialPost.findMany({ where: { contentItemId: itemId }, select: { provider: true, status: true, externalPostId: true } });
    for (const post of published) {
      expect(post.status).toBe("PUBLISHED");
      expect(post.externalPostId).toBeTruthy();
    }
    expect((await db.contentCalendarItem.findUniqueOrThrow({ where: { id: itemId } })).stage).toBe("PUBLISHED");

    // --- Analytics sync; the figures reach the dashboard --------------------
    const sync = await collectMetrics(new Date(), resolve);
    expect(sync.failed.filter((f) => Object.values(posts).includes(f.postId))).toEqual([]);
    const snapshots = await db.socialMetricSnapshot.count({ where: { clientId } });
    expect(snapshots).toBeGreaterThan(0);

    const dashboard = await socialReport(manager, { clientId, from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 3 * 86_400_000) });
    expect(dashboard.posts).toBe(3);
    expect(dashboard.measured).toBe(snapshots);
    expect(Object.values(dashboard.totals).some((t) => t.value !== null)).toBe(true);

    // --- The monthly report includes the posts -----------------------------
    const publishedAt = (await db.socialPost.findFirstOrThrow({ where: { id: posts.INSTAGRAM }, select: { publishedAt: true } })).publishedAt!;
    const day = zonedDay(publishedAt, CALENDAR_TIME_ZONE);
    const month = `${day.year}-${String(day.month).padStart(2, "0")}`;
    // As if run on the 2nd of the following month, when this month is complete.
    const later = new Date(Date.UTC(day.month === 12 ? day.year + 1 : day.year, day.month % 12, 2, 6));
    const { id: reportId } = await generateReport(manager, { clientId, month }, later);
    const report = await getReport(manager, reportId);
    expect(report.data.clientName).toBe(`ABC Technologies ${TAG}`);
    expect(report.data.current.posts).toBe(3);
    expect(report.data.content.campaigns).toEqual([expect.objectContaining({ name: "Diwali 2026", posts: 3 })]);

    // --- The audit trail ----------------------------------------------------
    const trail = await db.auditLog.findMany({
      where: {
        OR: [
          { entityType: "ContentCalendarItem", entityId: { in: [itemId, "Diwali 2026 — light up your business"] } },
          { entityType: "SocialPost", entityId: { in: [...Object.values(posts), itemId] } },
          { entityType: "Approval", entityId: approvalId },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { action: true, entityType: true, after: true },
    });
    const has = (predicate: (row: (typeof trail)[number]) => boolean) => trail.some(predicate);
    const after = (row: (typeof trail)[number]) => (row.after ?? {}) as Record<string, unknown>;

    expect(has((r) => r.action === "CREATE" && r.entityType === "ContentCalendarItem")).toBe(true); // created
    expect(has((r) => r.action === "STATUS_CHANGE" && after(r)["internalReview"] === "APPROVED")).toBe(true); // reviewed
    expect(has((r) => r.entityType === "Approval" && after(r)["status"] === "APPROVED" && after(r)["by"] === "client")).toBe(true); // approved
    expect(trail.filter((r) => r.entityType === "SocialPost" && r.action === "STATUS_CHANGE" && after(r)["status"] === "SCHEDULED")).toHaveLength(3); // scheduled
    expect(trail.filter((r) => r.action === "PUBLISH")).toHaveLength(3); // published
    expect(trail.filter((r) => r.action === "SYNC")).toHaveLength(snapshots); // synced

    // A second sync the same day refreshes the figures without repeating itself.
    await collectMetrics(new Date(), resolve);
    expect(await db.auditLog.count({ where: { action: "SYNC", entityId: { in: Object.values(posts) } } })).toBe(snapshots);
  });
});
