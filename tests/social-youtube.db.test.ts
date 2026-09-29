import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { publishDuePosts, type ResolveAdapter } from "@/lib/services/social-publish.service";
import { collectMetrics } from "@/lib/services/social-metrics.service";
import {
  accountHealth,
  listAccounts,
  renewIdleCredentials,
} from "@/lib/services/social-account.service";
import { YouTubeProvider } from "@/lib/social/youtube";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { startYouTubeDouble, type YouTubeDouble } from "./support/youtube-double";
import type { Actor } from "@/lib/actor/types";
import type { ProviderCredentials } from "@/lib/social/types";

/**
 * YouTube inside the application, and two things it exposed.
 *
 * Google's access tokens last an hour, which is routine for an account with a
 * refresh token — so the accounts screen must not call it "expiring", and the
 * engine must renew it before every upload. And the question "who renews a
 * token nobody is using?" had no answer for Instagram, whose token renews
 * only by being presented: the cron's keep-alive is that answer.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `yt-${Date.now()}`;

describeDb("YouTube through the engine, and keeping accounts alive", () => {
  let double: YouTubeDouble;
  let adapter: YouTubeProvider;
  let resolve: ResolveAdapter;
  let clientId = "";
  let projectId = "";
  let accountId = "";
  let videoId = "";
  let staff: Actor;

  async function scheduledUpload() {
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${SUFFIX} shoot`, channel: "YOUTUBE", stage: "APPROVED" },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        accountId,
        provider: "YOUTUBE",
        type: "YOUTUBE_VIDEO",
        status: "SCHEDULED",
        headline: "Planning a festive shoot",
        caption: "Start to finish.",
        scheduledFor: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });
    await db.socialPostMedia.create({ data: { postId: post.id, mediaId: videoId, order: 0 } });
    return post;
  }

  beforeAll(async () => {
    double = await startYouTubeDouble();
    adapter = new YouTubeProvider({
      clientId: "yt-client",
      clientSecret: "yt-secret",
      tokenUrl: `${double.url}/token`,
      apiBase: double.url,
      timeoutMs: 2_000,
      uploadTimeoutMs: 3_000,
    });
    resolve = async (which) => (which === "YOUTUBE" ? adapter : new UnconfiguredSocialProvider(which));

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    staff = {
      userId: user.id,
      name: "Social",
      email: "social@emporia.test",
      type: "STAFF",
      roleName: "MARKETING_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set(["social.view"]),
      ip: null,
      userAgent: "vitest",
    };

    const client = await db.client.create({ data: { name: `${SUFFIX} Northwind`, slug: `${SUFFIX}-a` }, select: { id: true } });
    clientId = client.id;
    const project = await db.project.create({
      data: { code: `Y-${SUFFIX}`.slice(0, 20), name: "Retainer", clientId, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
      select: { id: true },
    });
    projectId = project.id;

    const video = await db.media.create({
      data: {
        key: `${SUFFIX}/clip.mp4`,
        url: `${double.url}/media/clip.mp4`,
        filename: "clip.mp4",
        mimeType: "video/mp4",
        size: double.videoSize,
        type: "VIDEO",
        uploadedById: user.id,
      },
      select: { id: true },
    });
    videoId = video.id;
  });

  async function youtubeAccount(refreshToken = "yt-refresh") {
    const account = await db.socialAccount.create({
      data: {
        clientId,
        provider: "YOUTUBE",
        externalId: `${SUFFIX}-UC123`,
        name: "Northwind Studio",
        status: "CONNECTED",
        accessToken: encryptSecret("yt-access"),
        refreshToken: encryptSecret(refreshToken),
        // An hour-long token with most of its hour gone.
        tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      select: { id: true },
    });
    accountId = account.id;
    return account.id;
  }

  afterEach(async () => {
    await db.socialMetricSnapshot.deleteMany({ where: { clientId } });
    await db.socialPublication.deleteMany({ where: { clientId } });
    await db.socialPostMedia.deleteMany({ where: { post: { clientId } } });
    await db.socialPost.deleteMany({ where: { clientId } });
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
    await db.socialAccount.deleteMany({ where: { clientId } });
  });

  afterAll(async () => {
    await double.close();
    await db.media.deleteMany({ where: { id: videoId } });
    await db.project.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: clientId } });
  });

  it("renews the hour-long token, uploads, and records the video", async () => {
    await youtubeAccount();
    const post = await scheduledUpload();
    const from = double.requests.length;

    const run = await publishDuePosts(new Date(), resolve);
    expect(run.published).toBe(1);

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, externalPostId: true, externalUrl: true },
    });
    expect(row).toEqual({ status: "PUBLISHED", externalPostId: "vid-1", externalUrl: "https://www.youtube.com/watch?v=vid-1" });

    // The upload went out on the renewed token, and the renewed token was kept.
    const session = double.requests.slice(from).find((r) => r.path === "/upload/youtube/v3/videos")!;
    expect(session.headers.authorization).toBe("Bearer yt-access-2");
    const stored = await db.socialAccount.findUniqueOrThrow({ where: { id: accountId }, select: { accessToken: true, refreshToken: true } });
    expect(decryptSecret(stored.accessToken!)).toBe("yt-access-2");
    expect(decryptSecret(stored.refreshToken!)).toBe("yt-refresh");

    const metrics = await collectMetrics(new Date(), resolve);
    expect(metrics.captured).toBe(1);
    const snapshot = await db.socialMetricSnapshot.findFirstOrThrow({
      where: { clientId },
      select: { videoViews: true, likes: true, comments: true, watchTimeSeconds: true },
    });
    expect(snapshot).toEqual({ videoViews: 1520, likes: 48, comments: 7, watchTimeSeconds: null });
  });

  it("marks the channel for reconnection when Google revokes the refresh token", async () => {
    await youtubeAccount("revoked");
    const post = await scheduledUpload();
    await publishDuePosts(new Date(), resolve);

    const account = await db.socialAccount.findUniqueOrThrow({ where: { id: accountId }, select: { status: true } });
    expect(account.status).toBe("NEEDS_RECONNECT");
    // Nothing was uploaded on a dead connection.
    const row = await db.socialPost.findUniqueOrThrow({ where: { id: post.id }, select: { status: true, externalPostId: true } });
    expect(row.externalPostId).toBeNull();
  });

  it("does not call an account with a refresh token 'expiring', and says which accounts renew", async () => {
    await youtubeAccount();
    const [row] = await listAccounts(staff, clientId);
    expect(row!.renewsItself).toBe(true);
    expect(accountHealth(row!)).toBe("HEALTHY");
    // No token, not even a yes/no derived one, beyond the flag.
    expect(JSON.stringify(row)).not.toContain("yt-refresh");
    expect(row).not.toHaveProperty("refreshToken");

    // The same expiry without a refresh token is a real warning.
    expect(accountHealth({ ...row!, renewsItself: false })).toBe("EXPIRING");
  });

  describe("the keep-alive", () => {
    const renewing = (outcome: "ok" | "fail") => {
      const calls: ProviderCredentials[] = [];
      const fake = {
        configured: true,
        refreshesWithAccessToken: true,
        refresh: async (credentials: ProviderCredentials) => {
          calls.push(credentials);
          if (outcome === "fail") throw new Error("Instagram refused the renewal.");
          return {
            accessToken: "ig-renewed",
            refreshToken: null,
            expiresAt: new Date(Date.now() + 60 * 86_400_000),
          };
        },
      };
      return { calls, resolve: async () => fake };
    };

    async function instagramAccount(daysLeft: number) {
      return db.socialAccount.create({
        data: {
          clientId,
          provider: "INSTAGRAM",
          externalId: `${SUFFIX}-ig-${daysLeft}`,
          name: `IG ${daysLeft}`,
          status: "CONNECTED",
          accessToken: encryptSecret("ig-old"),
          tokenExpiresAt: new Date(Date.now() + daysLeft * 86_400_000),
        },
        select: { id: true },
      });
    }

    it("renews an idle token in its last week, and leaves others alone", async () => {
      const dying = await instagramAccount(3);
      const healthy = await instagramAccount(40);
      await youtubeAccount();
      const { calls, resolve: fake } = renewing("ok");

      const result = await renewIdleCredentials(fake);

      // Scoped to this file's rows: the job is global by design, and another
      // file's leftovers are not this test's business.
      expect(calls.filter((c) => c.accessToken === "ig-old")).toHaveLength(1);
      expect(result.renewed).toBeGreaterThanOrEqual(1);
      const renewed = await db.socialAccount.findUniqueOrThrow({ where: { id: dying.id }, select: { accessToken: true, tokenExpiresAt: true } });
      expect(decryptSecret(renewed.accessToken!)).toBe("ig-renewed");
      const untouched = await db.socialAccount.findUniqueOrThrow({ where: { id: healthy.id }, select: { accessToken: true } });
      expect(decryptSecret(untouched.accessToken!)).toBe("ig-old");
      // The YouTube account renews on use; the keep-alive does not churn it.
      const yt = await db.socialAccount.findUniqueOrThrow({ where: { id: accountId }, select: { accessToken: true } });
      expect(decryptSecret(yt.accessToken!)).toBe("yt-access");
    });

    it("marks an account whose renewal is refused, so the screen says so", async () => {
      const dying = await instagramAccount(2);
      const { resolve: fake } = renewing("fail");

      const result = await renewIdleCredentials(fake);
      expect(result.failed).toBeGreaterThanOrEqual(1);
      const row = await db.socialAccount.findUniqueOrThrow({ where: { id: dying.id }, select: { status: true } });
      expect(row.status).toBe("NEEDS_RECONNECT");
    });
  });
});
