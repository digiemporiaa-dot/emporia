import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, RateLimitedError } from "@/lib/errors";
import { encryptSecret } from "@/lib/security/secret";
import { GoogleBusinessProvider } from "@/lib/social/google-business";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { reviewsOverview, syncDueReviews, syncLocation, syncReviewsNow, type ResolveAdapter } from "@/lib/services/seo-intel/reviews.service";
import { computeNap } from "@/lib/services/seo-intel/nap.service";
import { detectOpportunities } from "@/lib/services/seo-intel/opportunity.service";
import { startGoogleBusinessDouble, type GoogleBusinessDouble } from "./support/google-business-double";
import type { Actor } from "@/lib/actor/types";

/**
 * Google reviews against the database and a double for Google: the daily
 * read, its claim (overlapping runs read once), replacing what Google no
 * longer lists, failures kept visible, the screen's figures, and the
 * detector's reviews source — which runs only when every location is fresh.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `rv${Date.now().toString(36)}`;

describeDb("SEO reviews", () => {
  let double: GoogleBusinessDouble;
  let resolve: ResolveAdapter;
  let staffId = "";
  let clientId = "";
  let noSeoClientId = "";
  let propertyId = "";
  let accountId = "";
  let noSeoAccountId = "";
  const now = new Date("2026-10-04T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  const actor = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions), ...overrides }) as Actor;

  const account = (client: string, externalId: string) =>
    db.socialAccount
      .create({
        data: {
          clientId: client,
          provider: "GOOGLE_BUSINESS_PROFILE",
          externalId,
          externalParentId: "accounts/111",
          name: `Northwind ${externalId}`,
          accessToken: encryptSecret("gbp-access"),
          refreshToken: encryptSecret("gbp-refresh"),
          tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
        select: { id: true },
      })
      .then((row) => row.id);

  beforeAll(async () => {
    double = await startGoogleBusinessDouble();
    const adapter = new GoogleBusinessProvider({ clientId: "c", clientSecret: "s", tokenUrl: `${double.url}/token`, accountsBase: double.url, infoBase: double.url, postsBase: double.url, timeoutMs: 2_000 });
    resolve = async (which) => (which === "GOOGLE_BUSINESS_PROFILE" ? adapter : new UnconfiguredSocialProvider(which));
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    clientId = (await db.client.create({ data: { name: `Reviews ${TAG}`, slug: `reviews-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    noSeoClientId = (await db.client.create({ data: { name: `No SEO ${TAG}`, slug: `noseo-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (await db.seoProperty.create({ data: { clientId, domain: `${TAG}.example.com`, displayName: "Reviews site", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    // Location ids unique to this run: the provider + externalId pair is unique across clients.
    const n = Date.now() % 1_000_000;
    accountId = await account(clientId, `locations/${n}1`);
    double.addLocation(`locations/${n}1`);
    double.addLocation(`locations/${n}2`);
    noSeoAccountId = await account(noSeoClientId, `locations/${n}2`);
    double.setReviews(
      `locations/${n}1`,
      [
        { reviewId: "a", reviewer: { displayName: "Asha" }, starRating: "TWO", comment: "Slow to respond", createTime: daysAgo(3), updateTime: daysAgo(3) },
        { reviewId: "b", reviewer: { displayName: "Ben" }, starRating: "FIVE", createTime: daysAgo(10), updateTime: daysAgo(9), reviewReply: { comment: "Thanks Ben", updateTime: daysAgo(9) } },
        { reviewId: "c", reviewer: { isAnonymous: true }, starRating: "FOUR", createTime: daysAgo(100), updateTime: daysAgo(100) },
      ],
      { averageRating: 3.7, totalReviewCount: 3 },
    );
  });

  afterAll(async () => {
    await double?.close();
    if (!clientId) return;
    await db.seoOpportunity.deleteMany({ where: { propertyId } });
    await db.socialAccount.deleteMany({ where: { id: { in: [accountId, noSeoAccountId] } } });
    await db.seoProperty.deleteMany({ where: { id: propertyId } });
    await db.clientBusinessProfile.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: { in: [clientId, noSeoClientId] } } });
  });

  it("reads only locations of clients with an SEO website, and stores reviews and listing", async () => {
    expect(await syncDueReviews({ now, resolve, limit: 50 })).toBeGreaterThanOrEqual(1);
    expect(await db.gbpListing.findUnique({ where: { socialAccountId: noSeoAccountId } })).toBeNull();
    const listing = await db.gbpListing.findUniqueOrThrow({ where: { socialAccountId: accountId } });
    expect(listing).toMatchObject({ title: "Northwind Studio", phone: "022 4000 1001", averageRating: 3.7, totalReviewCount: 3, complete: true, lastError: null, lastSyncedAt: now });
    expect(listing.address).toEqual({ lines: ["14 Hill Road"], locality: "Bandra", region: "Maharashtra", postalCode: "400050", country: "IN" });
    const reviews = await db.gbpReview.findMany({ where: { socialAccountId: accountId }, orderBy: { externalId: "asc" } });
    expect(reviews.map((r) => [r.externalId, r.rating, r.reviewerName, r.replyComment])).toEqual([
      ["a", 2, "Asha", null],
      ["b", 5, "Ben", "Thanks Ben"],
      ["c", 4, null, null],
    ]);
  });

  it("a second run within the day does not read again", async () => {
    const calls = double.requests.length;
    expect(await syncDueReviews({ now: new Date(now.getTime() + 3_600_000), resolve, limit: 50 })).toBe(0);
    expect(await syncLocation(accountId, { now: new Date(now.getTime() + 3_600_000), resolve })).toMatchObject({ ok: false, error: "Synced moments ago." });
    expect(double.requests.length).toBe(calls);
  });

  it("a complete read replaces reviews Google no longer lists; a failure is kept and shown", async () => {
    const n = (await db.socialAccount.findUniqueOrThrow({ where: { id: accountId } })).externalId;
    double.setReviews(n, [{ reviewId: "a", starRating: "TWO", comment: "Slow to respond", createTime: daysAgo(3), reviewReply: { comment: "Sorry, Asha", updateTime: daysAgo(1) } }]);
    const later = new Date(now.getTime() + 21 * 3_600_000);
    expect(await syncLocation(accountId, { now: later, resolve })).toEqual({ ok: true, reviews: 1 });
    expect(await db.gbpReview.findMany({ where: { socialAccountId: accountId }, select: { externalId: true, replyComment: true } })).toEqual([{ externalId: "a", replyComment: "Sorry, Asha" }]);

    double.failWith("reviews", 403, { error: { status: "PERMISSION_DENIED" } });
    const result = await syncLocation(accountId, { now: new Date(later.getTime() + 21 * 3_600_000), resolve });
    expect(result.ok).toBe(false);
    const listing = await db.gbpListing.findUniqueOrThrow({ where: { socialAccountId: accountId } });
    expect(listing.lastError).toMatch(/Google refused to list the location's reviews/);
    expect(listing.lastSyncedAt).toEqual(later);
    // Nothing was thrown away on failure.
    expect(await db.gbpReview.count({ where: { socialAccountId: accountId } })).toBe(1);
  });

  it("says so when Business Profile is not set up or the location is not connected", async () => {
    const unconfigured: ResolveAdapter = async (which) => new UnconfiguredSocialProvider(which);
    expect(await syncLocation(accountId, { resolve: unconfigured, force: true, now: new Date(now.getTime() + 100 * 3_600_000) })).toMatchObject({ ok: false, error: expect.stringContaining("not set up") });
    await db.socialAccount.update({ where: { id: accountId }, data: { status: "NEEDS_RECONNECT" } });
    expect(await syncLocation(accountId, { resolve, force: true, now: new Date(now.getTime() + 101 * 3_600_000) })).toMatchObject({ ok: false, error: expect.stringContaining("not connected") });
    await db.socialAccount.update({ where: { id: accountId }, data: { status: "CONNECTED" } });
  });

  it("manual read: manage only, staff only, rate limited", async () => {
    await expect(syncReviewsNow(actor(["seo.intelligence.view"]), propertyId, { resolve })).rejects.toThrow(ForbiddenError);
    await expect(syncReviewsNow(actor(["seo.intelligence.manage"], { type: "CLIENT", clientId }), propertyId, { resolve })).rejects.toThrow(ForbiddenError);
    const manager = actor(["seo.intelligence.manage"]);
    const first = await syncReviewsNow(manager, propertyId, { resolve, now: new Date(now.getTime() + 200 * 3_600_000) });
    expect(first).toEqual({ locations: 1, synced: 1, errors: [] });
    await syncReviewsNow(manager, propertyId, { resolve, now: new Date(now.getTime() + 201 * 3_600_000) });
    await syncReviewsNow(manager, propertyId, { resolve, now: new Date(now.getTime() + 202 * 3_600_000) });
    await expect(syncReviewsNow(manager, propertyId, { resolve })).rejects.toThrow(RateLimitedError);
  });

  it("the screen's figures and the reviews findings", async () => {
    const n = (await db.socialAccount.findUniqueOrThrow({ where: { id: accountId } })).externalId;
    double.setReviews(n, [
      { reviewId: "a", reviewer: { displayName: "Asha" }, starRating: "TWO", comment: "Slow", createTime: daysAgo(3) },
      { reviewId: "b", reviewer: { displayName: "Ben" }, starRating: "FIVE", createTime: daysAgo(10), reviewReply: { comment: "Thanks", updateTime: daysAgo(9) } },
    ]);
    // Back to the start of the day: the earlier manual reads ran "later".
    await db.gbpListing.update({ where: { socialAccountId: accountId }, data: { lastAttemptAt: null } });
    await syncLocation(accountId, { resolve, now });
    const overview = await reviewsOverview(actor(["seo.intelligence.view"]), propertyId, now);
    expect(overview.locations).toHaveLength(1);
    expect(overview.locations[0]!.stats).toMatchObject({ total: 2, last30: 2, unanswered: 1, unansweredLow: 1, medianReplyHours: 24, daysSinceLast: 3 });
    expect(overview.locations[0]!.unanswered.map((r) => r.comment)).toEqual(["Slow"]);

    const result = await detectOpportunities(propertyId, now);
    expect(result.sources).toContain("REVIEWS");
    const finding = await db.seoOpportunity.findFirstOrThrow({ where: { propertyId, fingerprint: `reviews:unanswered:${accountId}` } });
    expect(finding).toMatchObject({ source: "REVIEWS", impact: 1, impactUnit: "reviews", severity: "HIGH", status: "OPEN" });

    // A stale read: the source does not run, so the finding is not resolved even though nothing is unanswered any more.
    await db.gbpReview.updateMany({ where: { socialAccountId: accountId }, data: { replyComment: "Replied on Google" } });
    const stale = await detectOpportunities(propertyId, new Date(now.getTime() + 3 * 86_400_000));
    expect(stale.sources).not.toContain("REVIEWS");
    expect((await db.seoOpportunity.findFirstOrThrow({ where: { id: finding.id } })).status).toBe("OPEN");
    // Fresh again: resolved.
    const fresh = await detectOpportunities(propertyId, new Date(now.getTime() + 3_600_000));
    expect(fresh.sources).toContain("REVIEWS");
    expect((await db.seoOpportunity.findFirstOrThrow({ where: { id: finding.id } })).status).toBe("RESOLVED");
  });

  it("the synced listing is compared with the business profile", async () => {
    await db.clientBusinessProfile.create({ data: { clientId, legalName: "Northwind Studio Pvt Ltd", addressLine1: "14 Hill Road", city: "Bandra", postalCode: "400050", publicPhone: "+91 22 4000 1002" } });
    const nap = await computeNap(propertyId);
    expect(nap.listings).toHaveLength(1);
    expect(nap.report?.listing[0]?.mismatches).toEqual([{ field: "phone", expected: "+91 22 4000 1002", found: "022 4000 1001" }]);
    await detectOpportunities(propertyId, new Date(now.getTime() + 3_600_000));
    expect(await db.seoOpportunity.findFirst({ where: { propertyId, fingerprint: `nap:listing:${accountId}:phone` }, select: { severity: true, source: true } })).toEqual({ severity: "HIGH", source: "NAP" });
  });

  it("disconnecting the location deletes its reviews", async () => {
    await db.socialAccount.delete({ where: { id: noSeoAccountId } });
    const id = accountId;
    await db.socialAccount.delete({ where: { id } });
    expect(await db.gbpReview.count({ where: { socialAccountId: id } })).toBe(0);
    expect(await db.gbpListing.count({ where: { socialAccountId: id } })).toBe(0);
  });
});
