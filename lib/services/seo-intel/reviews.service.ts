import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { AppError, ForbiddenError, NotFoundError, RateLimitedError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { log } from "@/lib/logger";
import { record } from "@/lib/services/audit.service";
import { usableCredentials } from "@/lib/services/social-account.service";
import { socialProvider } from "@/lib/social";
import { GoogleBusinessProvider } from "@/lib/social/google-business";
import { monthlyReviews, reviewStats } from "@/lib/seo-intel/engine/reviews";
import { thresholdsFor } from "@/lib/services/seo-intel/thresholds.service";
import type { Actor } from "@/lib/actor/types";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { SocialProviderAdapter } from "@/lib/social/types";

/**
 * Google reviews for local SEO (Phase 8): a daily read of each connected
 * Business Profile location's reviews and listing details, for clients that
 * have a website in SEO Intelligence. Read only — nothing is posted back.
 */

const rLog = log("seo-reviews");

/** Reviews are read once a day; a failed read waits as long before the next try. */
export const REVIEW_SYNC_INTERVAL_MS = 20 * 3_600_000;
/** Most reviews one sync reads per location. */
export const MAX_REVIEWS = 2_000;

export type ResolveAdapter = (provider: SocialProvider) => Promise<SocialProviderAdapter>;

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

const message = (error: unknown) =>
  error instanceof AppError ? error.message.slice(0, 500) : "Google could not be read. The next daily sync will try again.";

/**
 * Claim the location for this run: set the attempt time only if no other run
 * set it within the interval, so overlapping cron runs read each once.
 */
async function claim(socialAccountId: string, now: Date, force: boolean): Promise<boolean> {
  await db.gbpListing.upsert({ where: { socialAccountId }, create: { socialAccountId }, update: {} });
  const cutoff = new Date(now.getTime() - (force ? 60_000 : REVIEW_SYNC_INTERVAL_MS));
  const claimed = await db.gbpListing.updateMany({
    where: { socialAccountId, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }] },
    data: { lastAttemptAt: now },
  });
  return claimed.count === 1;
}

/** Read one location's listing and reviews, and store them. Never throws. */
export async function syncLocation(
  socialAccountId: string,
  options: { now?: Date; resolve?: ResolveAdapter; force?: boolean } = {},
): Promise<{ ok: boolean; reviews: number; error?: string }> {
  const now = options.now ?? new Date();
  if (!(await claim(socialAccountId, now, options.force === true))) return { ok: false, reviews: 0, error: "Synced moments ago." };

  const account = await db.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { id: true, externalId: true, externalParentId: true, status: true },
  });
  const fail = async (error: string) => {
    await db.gbpListing.update({ where: { socialAccountId }, data: { lastError: error } });
    return { ok: false, reviews: 0, error };
  };
  if (!account || account.status !== "CONNECTED") return fail("The location is not connected. Reconnect it under Social → Accounts.");

  try {
    const adapter = await (options.resolve ?? socialProvider)("GOOGLE_BUSINESS_PROFILE");
    if (!(adapter instanceof GoogleBusinessProvider)) return fail("Google Business Profile is not set up in Settings → Social.");
    const credentials = await usableCredentials(account.id, adapter, now);
    if (!credentials) return fail("The location's Google sign-in no longer works. Reconnect it under Social → Accounts.");

    const ref = { externalId: account.externalId, externalParentId: account.externalParentId };
    const listing = await adapter.getListing(credentials, ref);
    const page = await adapter.listReviews(credentials, ref, MAX_REVIEWS);
    const ids = page.reviews.map((review) => review.externalId);

    await db.$transaction([
      // A complete read is the whole truth: reviews Google no longer lists are gone.
      page.complete
        ? db.gbpReview.deleteMany({ where: { socialAccountId } })
        : db.gbpReview.deleteMany({ where: { socialAccountId, externalId: { in: ids } } }),
      db.gbpReview.createMany({ data: page.reviews.map((review) => ({ socialAccountId, ...review })), skipDuplicates: true }),
      db.gbpListing.update({
        where: { socialAccountId },
        data: {
          title: listing.title,
          address: listing.address ?? Prisma.JsonNull,
          phone: listing.phone,
          website: listing.website,
          averageRating: page.averageRating,
          totalReviewCount: page.totalReviewCount,
          complete: page.complete,
          lastSyncedAt: now,
          lastError: null,
        },
      }),
    ]);
    return { ok: true, reviews: page.reviews.length };
  } catch (error) {
    rLog.error({ err: error, socialAccountId }, "review sync failed");
    return fail(message(error));
  }
}

/** Locations of clients with an active SEO website, due a daily read. */
export async function syncDueReviews(options: { now?: Date; limit?: number; resolve?: ResolveAdapter } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - REVIEW_SYNC_INTERVAL_MS);
  const due = await db.socialAccount.findMany({
    where: {
      provider: "GOOGLE_BUSINESS_PROFILE",
      status: "CONNECTED",
      client: { deletedAt: null, seoProperties: { some: { isActive: true } } },
      OR: [{ gbpListing: null }, { gbpListing: { lastAttemptAt: null } }, { gbpListing: { lastAttemptAt: { lt: cutoff } } }],
    },
    orderBy: { gbpListing: { lastAttemptAt: { sort: "asc", nulls: "first" } } },
    take: options.limit ?? 5,
    select: { id: true },
  });
  let synced = 0;
  for (const account of due) {
    const result = await syncLocation(account.id, { now, resolve: options.resolve });
    if (result.ok) synced += 1;
  }
  return synced;
}

async function propertyClient(propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true, clientId: true } });
  if (!property) throw new NotFoundError("That website was not found.");
  return property;
}

/** "Sync reviews now" for every location of the website's client. */
export async function syncReviewsNow(actor: Actor, propertyId: string, options: { resolve?: ResolveAdapter; now?: Date } = {}) {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  const property = await propertyClient(propertyId);
  const limit = await checkRateLimit(`seo-reviews:${property.clientId}`, { limit: 3, windowMs: 10 * 60_000 });
  if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds, "Reviews were just synced for this client. Try again in a few minutes.");
  const accounts = await db.socialAccount.findMany({
    where: { clientId: property.clientId, provider: "GOOGLE_BUSINESS_PROFILE", status: "CONNECTED" },
    select: { id: true },
  });
  const results = [];
  for (const account of accounts) results.push(await syncLocation(account.id, { ...options, force: true }));
  await record({ actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, after: { reviewsSynced: results.filter((r) => r.ok).length, locations: accounts.length } });
  return { locations: accounts.length, synced: results.filter((r) => r.ok).length, errors: results.filter((r) => !r.ok).map((r) => r.error as string) };
}

/** Reviews per location for the Local SEO screen. */
export async function reviewsOverview(actor: Actor, propertyId: string, now = new Date()) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const property = await propertyClient(propertyId);
  const t = await thresholdsFor(propertyId);
  const accounts = await db.socialAccount.findMany({
    where: { clientId: property.clientId, provider: "GOOGLE_BUSINESS_PROFILE", status: { not: "DISCONNECTED" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      profileUrl: true,
      gbpListing: {
        select: { title: true, phone: true, address: true, website: true, averageRating: true, totalReviewCount: true, lastAttemptAt: true, lastSyncedAt: true, lastError: true, complete: true },
      },
    },
  });

  const locations = [];
  for (const account of accounts) {
    const reviews = await db.gbpReview.findMany({
      where: { socialAccountId: account.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, rating: true, comment: true, reviewerName: true, createdAt: true, replyComment: true, repliedAt: true },
    });
    const since = now.getTime() - t["reviews.unansweredDays"] * 86_400_000;
    locations.push({
      id: account.id,
      name: account.name,
      status: account.status,
      profileUrl: account.profileUrl,
      listing: account.gbpListing,
      stats: reviewStats(reviews, now, { unansweredDays: t["reviews.unansweredDays"], lowRating: t["reviews.lowRating"] }),
      monthly: monthlyReviews(reviews, now),
      unanswered: reviews.filter((review) => !review.replyComment && review.createdAt.getTime() >= since).slice(0, 20),
    });
  }
  return { locations, thresholds: { unansweredDays: t["reviews.unansweredDays"], lowRating: t["reviews.lowRating"], quietDays: t["reviews.quietDays"] } };
}
