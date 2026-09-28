import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { publishDuePosts, type ResolveAdapter } from "@/lib/services/social-publish.service";
import { collectMetrics } from "@/lib/services/social-metrics.service";
import { usableCredentials } from "@/lib/services/social-account.service";
import { InstagramProvider } from "@/lib/social/instagram";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { encryptSecret, decryptSecret } from "@/lib/security/secret";
import { startInstagramDouble, type InstagramDouble } from "./support/instagram-double";

/**
 * Instagram inside the application, not beside it.
 *
 * The adapter's own test proves it speaks Instagram. This proves the engine,
 * the credential refresh and the metrics collector all drive it correctly —
 * including the one thing Instagram does differently from LinkedIn: it has no
 * refresh token, and extends a token by presenting the token itself.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `ig-${Date.now()}`;

describeDb("Instagram through the publishing engine", () => {
  let double: InstagramDouble;
  let resolve: ResolveAdapter;
  let adapter: InstagramProvider;
  let clientId = "";
  let projectId = "";
  let accountId = "";
  let imageId = "";
  let userId = "";

  async function scheduledImagePost() {
    const item = await db.contentCalendarItem.create({
      data: {
        clientId,
        projectId,
        title: `${SUFFIX} festive room`,
        channel: "INSTAGRAM",
        stage: "APPROVED",
      },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        accountId,
        provider: "INSTAGRAM",
        type: "SINGLE_IMAGE",
        status: "SCHEDULED",
        caption: "Three rooms, one afternoon.",
        hashtags: ["festive"],
        scheduledFor: new Date(Date.now() - 60_000),
      },
      select: { id: true, contentItemId: true },
    });
    await db.socialPostMedia.create({ data: { postId: post.id, mediaId: imageId, order: 0 } });
    return post;
  }

  beforeAll(async () => {
    double = await startInstagramDouble();
    adapter = new InstagramProvider({
      clientId: "ig-app-id",
      clientSecret: "ig-app-secret",
      authorizeBase: double.url,
      authBase: double.url,
      graphBase: double.url,
      pollIntervalMs: 10,
      timeoutMs: 2_000,
    });
    resolve = async (which) =>
      which === "INSTAGRAM" ? adapter : new UnconfiguredSocialProvider(which);

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;

    const client = await db.client.create({
      data: { name: `${SUFFIX} Northwind`, slug: `${SUFFIX}-a` },
      select: { id: true },
    });
    clientId = client.id;

    const project = await db.project.create({
      data: {
        code: `I-${SUFFIX}`.slice(0, 20),
        name: "Retainer",
        clientId,
        managerId: user.id,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectId = project.id;

    const account = await db.socialAccount.create({
      data: {
        clientId,
        provider: "INSTAGRAM",
        externalId: `${SUFFIX}-ig`,
        name: "Northwind Studio",
        status: "CONNECTED",
        accessToken: encryptSecret("ig-long-token"),
      },
      select: { id: true },
    });
    accountId = account.id;

    const image = await db.media.create({
      data: {
        key: `${SUFFIX}/room.jpg`,
        url: "https://cdn.example.com/room.jpg",
        filename: "room.jpg",
        mimeType: "image/jpeg",
        size: 120_000,
        type: "IMAGE",
        uploadedById: userId,
      },
      select: { id: true },
    });
    imageId = image.id;
  });

  afterEach(async () => {
    await db.socialAccount.update({
      where: { id: accountId },
      data: {
        status: "CONNECTED",
        failureCount: 0,
        accessToken: encryptSecret("ig-long-token"),
        tokenExpiresAt: null,
      },
    });
    await db.socialMetricSnapshot.deleteMany({ where: { clientId } });
    await db.socialPublication.deleteMany({ where: { clientId } });
    await db.socialPostMedia.deleteMany({ where: { post: { clientId } } });
    await db.socialPost.deleteMany({ where: { clientId } });
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
  });

  afterAll(async () => {
    await double.close();
    await db.media.deleteMany({ where: { id: imageId } });
    await db.socialAccount.deleteMany({ where: { clientId } });
    await db.project.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: clientId } });
  });

  it("publishes a scheduled Instagram post and records where it went", async () => {
    const post = await scheduledImagePost();
    const run = await publishDuePosts(new Date(), resolve);

    expect(run.published).toBe(1);
    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, externalPostId: true, externalUrl: true, ambiguous: true },
    });
    expect(row).toEqual({
      status: "PUBLISHED",
      externalPostId: "m-1",
      externalUrl: "https://www.instagram.com/p/DOUBLE123/",
      ambiguous: false,
    });

    // The creative went to Instagram by URL, which is how Instagram takes it.
    const container = double.requests.find((r) => r.path.endsWith("/me/media"))!;
    expect(JSON.parse(container.body)).toMatchObject({ image_url: "https://cdn.example.com/room.jpg" });
  });

  it("files a lost publish reply as possibly live, not as a retry", async () => {
    const impatient = new InstagramProvider({
      clientId: "ig-app-id",
      clientSecret: "ig-app-secret",
      authorizeBase: double.url,
      authBase: double.url,
      graphBase: double.url,
      pollIntervalMs: 10,
      timeoutMs: 300,
    });
    const post = await scheduledImagePost();
    double.swallowNextPublish();
    await publishDuePosts(new Date(), async (which) =>
      which === "INSTAGRAM" ? impatient : new UnconfiguredSocialProvider(which),
    );

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, ambiguous: true },
    });
    expect(row).toEqual({ status: "FAILED", ambiguous: true });
  });

  it("refreshes an expiring token with the token itself — there is no refresh token", async () => {
    await db.socialAccount.update({
      where: { id: accountId },
      data: { refreshToken: null, tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const fresh = await usableCredentials(accountId, adapter);
    expect(fresh?.accessToken).toBe("ig-refreshed-token");

    // Stored, encrypted, with a new sixty-day expiry — and still no refresh
    // token, rather than a fabricated one.
    const stored = await db.socialAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { accessToken: true, refreshToken: true, tokenExpiresAt: true, status: true },
    });
    expect(decryptSecret(stored.accessToken!)).toBe("ig-refreshed-token");
    expect(stored.refreshToken).toBeNull();
    expect(stored.status).toBe("CONNECTED");
    expect((stored.tokenExpiresAt!.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(59);
  });

  it("marks the account when Instagram rejects its token", async () => {
    await scheduledImagePost();
    double.failWith("container", 400, { error: { message: "Invalid OAuth access token", code: 190 } });
    await publishDuePosts(new Date(), resolve);

    const account = await db.socialAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { status: true },
    });
    expect(account.status).toBe("NEEDS_RECONNECT");
  });

  it("collects Instagram metrics, with impressions absent rather than zero", async () => {
    await scheduledImagePost();
    await publishDuePosts(new Date(), resolve);

    const run = await collectMetrics(new Date(), resolve);
    expect(run.captured).toBe(1);

    const snapshot = await db.socialMetricSnapshot.findFirstOrThrow({
      where: { clientId },
      select: { likes: true, comments: true, reach: true, saves: true, shares: true, impressions: true },
    });
    expect(snapshot).toEqual({
      likes: 57,
      comments: 6,
      reach: 420,
      saves: 9,
      shares: 4,
      impressions: null,
    });
  });
});
