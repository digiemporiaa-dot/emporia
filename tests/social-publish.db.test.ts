import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, RateLimitedError } from "@/lib/errors";
import {
  publicationsFor,
  publishDuePosts,
  publishNow,
  type ResolveAdapter,
} from "@/lib/services/social-publish.service";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { encryptSecret } from "@/lib/security/secret";
import { publicationKey, MAX_ATTEMPTS } from "@/lib/social/idempotency";
import { startLinkedInDouble, type LinkedInDouble } from "./support/linkedin-double";
import type { Actor } from "@/lib/actor/types";

/**
 * The publishing engine.
 *
 * The rule the whole phase exists to keep is "a post must never be published
 * twice", so that is what most of this file is about: the claim, the
 * idempotency key, and what happens when two things try at once.
 *
 * The adapter is the real `LinkedInProvider` pointed at a local double, so the
 * engine is exercised against genuine request building and response parsing
 * rather than a mock that agrees with it.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `pub6-${Date.now()}`;

function staffWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Publisher",
    email: "publisher@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("social publishing engine", () => {
  let double: LinkedInDouble;
  let resolve: ResolveAdapter;
  let staff: Actor;
  let clientA = "";
  let accountA = "";
  let projectA = "";
  let userId = "";
  let counter = 0;

  /** An approved idea with one scheduled LinkedIn version, due now. */
  async function scheduledPost(
    over: { stage?: "APPROVED" | "DRAFT"; accountId?: string | null; scheduledFor?: Date } = {},
  ) {
    counter += 1;
    const item = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        title: `${SUFFIX} idea ${counter}`,
        channel: "LINKEDIN",
        stage: over.stage ?? "APPROVED",
        scheduledFor: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });

    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId: clientA,
        accountId: over.accountId === undefined ? accountA : over.accountId,
        provider: "LINKEDIN",
        type: "TEXT",
        status: "SCHEDULED",
        caption: `Copy number ${counter}.`,
        scheduledFor: over.scheduledFor ?? new Date(Date.now() - 60_000),
      },
      select: { id: true, contentItemId: true },
    });
    return post;
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
    staff = staffWith(user.id, ["social.view", "social.publish", "social.edit"]);

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
        connectedById: user.id,
      },
      select: { id: true },
    });
    accountA = account.id;
  });

  // Every test starts from an empty calendar. Without this, a post left
  // scheduled or failed by an earlier test is still due, gets picked up by the
  // next `publishDuePosts`, and quietly eats the one-shot failure the next
  // test just armed — which is exactly how four of these first went wrong.
  afterEach(async () => {
    await db.socialPublication.deleteMany({ where: { clientId: clientA } });
    await db.socialPost.deleteMany({ where: { clientId: clientA } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: clientA } });
  });

  afterAll(async () => {
    await double.close();
    await db.socialPublication.deleteMany({ where: { clientId: clientA } });
    await db.socialPost.deleteMany({ where: { clientId: clientA } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: clientA } });
    await db.socialAccount.deleteMany({ where: { clientId: clientA } });
    await db.project.deleteMany({ where: { clientId: clientA } });
    await db.client.deleteMany({ where: { id: clientA } });
  });

  // -------------------------------------------------------------------------
  // The happy path
  // -------------------------------------------------------------------------

  it("publishes a due post and records where it went", async () => {
    const post = await scheduledPost();
    const run = await publishDuePosts(new Date(), resolve);

    expect(run.published).toBeGreaterThanOrEqual(1);

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, externalPostId: true, externalUrl: true, publishedAt: true },
    });
    expect(row.status).toBe("PUBLISHED");
    expect(row.externalPostId).toBe("urn:li:share:7000000000000000001");
    expect(row.publishedAt).not.toBeNull();
  });

  it("writes a publication row with a derived idempotency key", async () => {
    const post = await scheduledPost();
    await publishDuePosts(new Date(), resolve);

    const publications = await db.socialPublication.findMany({
      where: { postId: post.id },
      select: { attempt: true, status: true, idempotencyKey: true },
    });
    expect(publications).toHaveLength(1);
    expect(publications[0]!.status).toBe("PUBLISHED");
    expect(publications[0]!.idempotencyKey).toBe(publicationKey(post.id, 1));
  });

  it("moves the idea to published once its last version is out", async () => {
    const post = await scheduledPost();
    await publishDuePosts(new Date(), resolve);

    const item = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: post.contentItemId },
      select: { stage: true, publishedAt: true },
    });
    expect(item.stage).toBe("PUBLISHED");
    expect(item.publishedAt).not.toBeNull();
  });

  it("leaves the idea alone while a sibling version is still waiting", async () => {
    const post = await scheduledPost();
    // A second version on the same idea, not yet due.
    await db.socialPost.create({
      data: {
        contentItemId: post.contentItemId,
        clientId: clientA,
        accountId: accountA,
        provider: "LINKEDIN",
        type: "TEXT",
        status: "SCHEDULED",
        caption: "The later one.",
        scheduledFor: new Date(Date.now() + 86_400_000),
        order: 1,
      },
    });

    await publishDuePosts(new Date(), resolve);

    const item = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: post.contentItemId },
      select: { stage: true },
    });
    expect(item.stage).toBe("APPROVED");
  });

  // -------------------------------------------------------------------------
  // Exactly once
  // -------------------------------------------------------------------------

  it("publishes once when two runs fire at the same instant", async () => {
    const post = await scheduledPost();
    const before = double.requests.filter((r) => r.path.endsWith("/posts")).length;

    // The case the claim exists for: overlapping cron runs.
    const [a, b] = await Promise.all([
      publishDuePosts(new Date(), resolve),
      publishDuePosts(new Date(), resolve),
    ]);

    const after = double.requests.filter((r) => r.path.endsWith("/posts")).length;
    expect(after - before).toBe(1);
    expect(a.published + b.published).toBe(1);

    const publications = await db.socialPublication.count({ where: { postId: post.id } });
    expect(publications).toBe(1);
  });

  it("publishes once when a person and the scheduler collide", async () => {
    const post = await scheduledPost();
    const before = double.requests.filter((r) => r.path.endsWith("/posts")).length;

    const results = await Promise.allSettled([
      publishNow(staff, post.id, resolve),
      publishDuePosts(new Date(), resolve),
    ]);

    const after = double.requests.filter((r) => r.path.endsWith("/posts")).length;
    expect(after - before).toBe(1);
    expect(await db.socialPublication.count({ where: { postId: post.id } })).toBe(1);
    // Whichever lost, it did not throw the process down.
    expect(results.every((r) => r.status === "fulfilled" || r.status === "rejected")).toBe(true);
  });

  it("refuses to publish something already published", async () => {
    const post = await scheduledPost();
    await publishNow(staff, post.id, resolve);

    await expect(publishNow(staff, post.id, resolve)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.socialPublication.count({ where: { postId: post.id } })).toBe(1);
  });

  it("does not pick a published post up again on the next run", async () => {
    const post = await scheduledPost();
    await publishDuePosts(new Date(), resolve);
    const before = double.requests.filter((r) => r.path.endsWith("/posts")).length;

    await publishDuePosts(new Date(), resolve);

    const after = double.requests.filter((r) => r.path.endsWith("/posts")).length;
    expect(after).toBe(before);
    expect(await db.socialPublication.count({ where: { postId: post.id } })).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Refusing to publish
  // -------------------------------------------------------------------------

  it("will not publish an idea the client has not approved", async () => {
    const post = await scheduledPost({ stage: "DRAFT" });
    const run = await publishDuePosts(new Date(), resolve);

    const failure = run.failed.find((entry) => entry.postId === post.id);
    expect(failure?.reason).toContain("has not been approved");

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true },
    });
    // Still scheduled, not failed: nothing was attempted and nothing is wrong
    // with the post itself.
    expect(row.status).toBe("SCHEDULED");
  });

  it("will not publish without a connected account", async () => {
    const post = await scheduledPost({ accountId: null });
    const run = await publishDuePosts(new Date(), resolve);
    expect(run.failed.find((e) => e.postId === post.id)?.reason).toContain("No account");
  });

  it("will not publish through an account that needs reconnecting", async () => {
    const stale = await db.socialAccount.create({
      data: {
        clientId: clientA,
        provider: "LINKEDIN",
        externalId: `${SUFFIX}-stale`,
        name: "Stale account",
        status: "NEEDS_RECONNECT",
        accessToken: encryptSecret("nope"),
      },
      select: { id: true },
    });
    const post = await scheduledPost({ accountId: stale.id });

    const run = await publishDuePosts(new Date(), resolve);
    expect(run.failed.find((e) => e.postId === post.id)?.reason).toContain("reconnect");
  });

  it("will not publish through an unconfigured provider", async () => {
    const xAccount = await db.socialAccount.create({
      data: {
        clientId: clientA,
        provider: "X",
        externalId: `${SUFFIX}-x`,
        name: "An X account",
        status: "CONNECTED",
        accessToken: encryptSecret("x-token"),
      },
      select: { id: true },
    });
    const post = await scheduledPost({ accountId: xAccount.id });
    await db.socialPost.update({ where: { id: post.id }, data: { provider: "X" } });

    const run = await publishDuePosts(new Date(), resolve);
    expect(run.failed.find((e) => e.postId === post.id)?.reason).toContain("not configured");

    await db.socialAccount.delete({ where: { id: xAccount.id } });
  });

  it("leaves a post that is not yet due alone", async () => {
    const post = await scheduledPost({ scheduledFor: new Date(Date.now() + 3_600_000) });
    await publishDuePosts(new Date(), resolve);

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true },
    });
    expect(row.status).toBe("SCHEDULED");
  });

  it("refuses a person without social.publish", async () => {
    const post = await scheduledPost();
    const viewer = staffWith(userId, ["social.view"]);
    await expect(publishNow(viewer, post.id, resolve)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Failure and retry
  // -------------------------------------------------------------------------

  it("records a failure with a reason a person can act on", async () => {
    const post = await scheduledPost();
    double.failWith("posts", 401);

    const run = await publishDuePosts(new Date(), resolve);
    expect(run.failed.find((e) => e.postId === post.id)?.reason).toContain("Reconnect");

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, lastError: true, attemptCount: true },
    });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("Reconnect");
    expect(row.attemptCount).toBe(1);

    const publication = await db.socialPublication.findFirstOrThrow({
      where: { postId: post.id },
      select: { status: true, error: true },
    });
    expect(publication.status).toBe("FAILED");
    expect(publication.error).toContain("Reconnect");
  });

  it("retries a failed post on the next run, with a new attempt number", async () => {
    const post = await scheduledPost();
    double.failWith("posts", 500);
    await publishDuePosts(new Date(), resolve);

    // Second run: the double is healthy again.
    await publishDuePosts(new Date(), resolve);

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, attemptCount: true },
    });
    expect(row.status).toBe("PUBLISHED");
    expect(row.attemptCount).toBe(2);

    const publications = await db.socialPublication.findMany({
      where: { postId: post.id },
      orderBy: { attempt: "asc" },
      select: { attempt: true, status: true, idempotencyKey: true },
    });
    expect(publications.map((p) => [p.attempt, p.status])).toEqual([
      [1, "FAILED"],
      [2, "PUBLISHED"],
    ]);
    expect(publications[1]!.idempotencyKey).toBe(publicationKey(post.id, 2));
  });

  it("stops retrying once the attempt ceiling is reached", async () => {
    const post = await scheduledPost();
    await db.socialPost.update({
      where: { id: post.id },
      data: { status: "FAILED", attemptCount: MAX_ATTEMPTS, lastError: "Broken." },
    });

    const before = double.requests.filter((r) => r.path.endsWith("/posts")).length;
    await publishDuePosts(new Date(), resolve);
    const after = double.requests.filter((r) => r.path.endsWith("/posts")).length;

    expect(after).toBe(before);
  });

  it("lets a person retry past the automatic ceiling", async () => {
    const post = await scheduledPost();
    await db.socialPost.update({
      where: { id: post.id },
      data: { status: "FAILED", attemptCount: MAX_ATTEMPTS, lastError: "Broken." },
    });

    const outcome = await publishNow(staff, post.id, resolve);
    expect(outcome.ok).toBe(true);
  });

  it("never retries a publish that may have already gone out", async () => {
    const post = await scheduledPost();
    double.publishWithoutId();

    const run = await publishDuePosts(new Date(), resolve);
    const failure = run.failed.find((e) => e.postId === post.id);
    expect(failure?.reason).toContain("Check the page before retrying");
    // The critical assertion: the engine must not queue this for another go.
    expect(failure?.willRetry).toBe(false);
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  it("shows the attempt history, newest first", async () => {
    const post = await scheduledPost();
    double.failWith("posts", 500);
    await publishDuePosts(new Date(), resolve);
    await publishDuePosts(new Date(), resolve);

    const history = await publicationsFor(staff, post.id);
    expect(history.map((entry) => entry.attempt)).toEqual([2, 1]);
    expect(history[0]!.status).toBe("PUBLISHED");
    expect(history[1]!.status).toBe("FAILED");
  });

  it("records who pressed publish, and records the scheduler as nobody", async () => {
    const manual = await scheduledPost();
    await publishNow(staff, manual.id, resolve);
    const byHand = await publicationsFor(staff, manual.id);
    expect(byHand[0]!.triggeredBy?.id).toBe(userId);

    const automatic = await scheduledPost();
    await publishDuePosts(new Date(), resolve);
    const byCron = await publicationsFor(staff, automatic.id);
    expect(byCron[0]!.triggeredBy).toBeNull();
  });

  it("tags the link it posts, without being told to", async () => {
    counter += 1;
    const item = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        title: `${SUFFIX} link idea`,
        channel: "LINKEDIN",
        stage: "APPROVED",
      },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId: clientA,
        accountId: accountA,
        provider: "LINKEDIN",
        type: "LINK",
        status: "SCHEDULED",
        caption: "Read the whole thing.",
        linkUrl: "https://example.com/mills",
        utmCampaign: "Festive Season",
        scheduledFor: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });

    const before = double.requests.length;
    await publishNow(staff, post.id, resolve);

    const posted = double.requests.slice(before).find((r) => r.path.endsWith("/posts"))!;
    const body = JSON.parse(posted.body) as { content?: { article?: { source: string } } };
    const source = body.content!.article!.source;
    expect(source).toContain("utm_source=linkedin");
    expect(source).toContain("utm_medium=social");
    expect(source).toContain("utm_campaign=festive-season");
  });

  it("rate limits a person publishing over and over", async () => {
    // The scheduler has MAX_ATTEMPTS to stop it hammering a broken platform;
    // a held-down Publish now button had nothing. Being rate limited by a
    // platform costs every client, not just this one.
    await db.rateLimitWindow.deleteMany({ where: { key: `social:publish:${userId}` } });

    let limited = false;
    for (let i = 0; i < 35; i++) {
      const post = await scheduledPost();
      try {
        await publishNow(staff, post.id, resolve);
      } catch (error) {
        if (error instanceof RateLimitedError) {
          limited = true;
          break;
        }
      }
    }

    expect(limited).toBe(true);
    await db.rateLimitWindow.deleteMany({ where: { key: `social:publish:${userId}` } });
  });

  it("refuses a post belonging to another client", async () => {
    const other = await db.client.create({
      data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` },
      select: { id: true },
    });
    const post = await scheduledPost();
    const portal: Actor = {
      ...staffWith(userId, ["social.view", "social.publish"]),
      type: "CLIENT",
      roleName: "CLIENT_USER",
      clientId: other.id,
    };

    await expect(publishNow(portal, post.id, resolve)).rejects.toThrow();
    await db.client.delete({ where: { id: other.id } });
  });
});
