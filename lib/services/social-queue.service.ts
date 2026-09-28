import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope, resolveScopeFilter } from "@/lib/social/scope";
import { publishNow, type PublishFailure } from "@/lib/services/social-publish.service";
import { MAX_ATTEMPTS } from "@/lib/social/idempotency";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * The publishing queue, as an operator sees it.
 *
 * Phase 6 made publishing correct. This is the screen that makes it
 * *operable*: what is going out, what broke, what is waiting on a person. It
 * spans clients, because "is anything broken right now" is not a question you
 * answer one client at a time.
 *
 * ## The stranded post
 *
 * Building this surfaced a real gap in Phase 6. The claim flips a post to
 * `PUBLISHING` before calling the platform; if the process dies in between — a
 * deploy, a container restart, an OOM, all of which happen — the post stays
 * `PUBLISHING` forever. `publishDuePosts` selects only `SCHEDULED` and
 * `FAILED`, so nothing picks it up again, and `publishNow` refuses it because
 * it looks like it is in flight. It is invisible and stuck.
 *
 * The tempting fix is to time it out and retry. That is wrong: we genuinely do
 * not know whether the platform received the post, and retrying could put a
 * second copy on a client's feed — the same ambiguity `AmbiguousPublishError`
 * exists for. So a stranded post is **surfaced, never auto-resolved**. A person
 * looks at the platform, sees what actually happened, and says which it was.
 * Guessing on their behalf is the one thing that cannot be undone.
 */

/**
 * How long a post may sit in `PUBLISHING` before it is presumed stranded.
 *
 * Generous on purpose. An image upload to a slow platform can legitimately take
 * a while, and calling a live publication stranded while it is still running
 * would invite exactly the double-post this is trying to prevent.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

const queueSelect = {
  id: true,
  clientId: true,
  provider: true,
  type: true,
  status: true,
  caption: true,
  scheduledFor: true,
  publishedAt: true,
  externalUrl: true,
  lastError: true,
  lastAttemptAt: true,
  attemptCount: true,
  client: { select: { id: true, name: true } },
  account: { select: { id: true, name: true, status: true } },
  contentItem: {
    select: { id: true, title: true, stage: true, campaign: { select: { name: true } } },
  },
} satisfies Prisma.SocialPostSelect;

export type QueueRow = Prisma.SocialPostGetPayload<{ select: typeof queueSelect }>;

export type QueueFilters = {
  clientId: string | null;
  provider?: SocialProvider | null;
};

/** How many rows any one band shows before it says there are more. */
const BAND_LIMIT = 50;

export type SocialQueue = {
  /** In `PUBLISHING` beyond the timeout. A person must say what happened. */
  stranded: QueueRow[];
  /** Failed, and out of automatic attempts. */
  needsRetry: QueueRow[];
  /** Failed but the scheduler will try again by itself. */
  retrying: QueueRow[];
  /** Genuinely in flight right now. */
  inFlight: QueueRow[];
  /** Scheduled and due, waiting only for the next scheduler run. */
  due: QueueRow[];
  /** Scheduled for later. */
  upcoming: QueueRow[];
  /** Went out in the last week. */
  recent: QueueRow[];
};

export async function socialQueue(
  actor: Actor,
  filters: QueueFilters,
  now = new Date(),
): Promise<SocialQueue> {
  requirePermission(actor, "social.view");
  const scope = await resolveScopeFilter(actor, filters.clientId);
  const where = {
    ...scope,
    ...(filters.provider ? { provider: filters.provider } : {}),
  };

  const strandedBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const band = (extra: Prisma.SocialPostWhereInput, order: Prisma.SocialPostOrderByWithRelationInput) =>
    db.socialPost.findMany({
      where: { ...where, ...extra },
      orderBy: order,
      take: BAND_LIMIT,
      select: queueSelect,
    });

  const [stranded, inFlight, failed, due, upcoming, recent] = await Promise.all([
    band(
      {
        status: "PUBLISHING",
        OR: [{ lastAttemptAt: { lt: strandedBefore } }, { lastAttemptAt: null }],
      },
      { scheduledFor: "asc" },
    ),
    band(
      { status: "PUBLISHING", lastAttemptAt: { gte: strandedBefore } },
      { lastAttemptAt: "desc" },
    ),
    band({ status: "FAILED" }, { lastAttemptAt: "desc" }),
    band({ status: "SCHEDULED", scheduledFor: { lte: now } }, { scheduledFor: "asc" }),
    band({ status: "SCHEDULED", scheduledFor: { gt: now } }, { scheduledFor: "asc" }),
    band({ status: "PUBLISHED", publishedAt: { gte: weekAgo } }, { publishedAt: "desc" }),
  ]);

  return {
    stranded,
    // Split by whether anything will happen without a person. A screen that
    // lumps these together makes an operator check rows that are already
    // handling themselves.
    needsRetry: failed.filter((post) => post.attemptCount >= MAX_ATTEMPTS),
    retrying: failed.filter((post) => post.attemptCount < MAX_ATTEMPTS),
    inFlight,
    due,
    upcoming,
    recent,
  };
}

/**
 * Retry every failed post a person can see.
 *
 * Sequential rather than parallel: these all hit third-party APIs, and firing
 * fifty at once is how an agency gets itself rate limited across every client
 * at the same moment.
 */
export async function retryAllFailed(
  actor: Actor,
  filters: QueueFilters,
): Promise<{ attempted: number; published: number; failed: PublishFailure[] }> {
  requirePermission(actor, "social.publish");
  const scope = await resolveScopeFilter(actor, filters.clientId);

  const posts = await db.socialPost.findMany({
    where: {
      ...scope,
      ...(filters.provider ? { provider: filters.provider } : {}),
      status: "FAILED",
    },
    orderBy: { scheduledFor: "asc" },
    take: BAND_LIMIT,
    select: { id: true },
  });

  const failed: PublishFailure[] = [];
  let published = 0;

  for (const post of posts) {
    try {
      await publishNow(actor, post.id);
      published += 1;
    } catch (error) {
      failed.push({
        postId: post.id,
        ok: false,
        reason: error instanceof Error ? error.message : "That did not work.",
        willRetry: false,
      });
    }
  }

  return { attempted: posts.length, published, failed };
}

export type StrandedResolution =
  | { outcome: "published"; externalUrl: string | null }
  | { outcome: "not-published" };

/**
 * Say what actually happened to a stranded post.
 *
 * The operator has looked at the platform. Either the post is there — in which
 * case it is recorded as published and never attempted again — or it is not,
 * and it goes back in the queue.
 *
 * This is the one place a human asserts a fact the system could not observe,
 * so it is audited with who said it. It is not fabricated data: somebody
 * looked.
 */
export async function resolveStrandedPost(
  actor: Actor,
  postId: string,
  resolution: StrandedResolution,
  now = new Date(),
): Promise<{ id: string; status: string }> {
  requirePermission(actor, "social.publish");

  const post = await db.socialPost.findUnique({
    where: { id: postId },
    select: { id: true, clientId: true, status: true, lastAttemptAt: true, attemptCount: true },
  });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);

  if (post.status !== "PUBLISHING") {
    throw new ConflictError("That post is not stuck. Nothing needs deciding.");
  }

  // Refuse while it could still legitimately be in flight. Resolving a live
  // publication is how the duplicate this whole design avoids gets created.
  const attemptedAt = post.lastAttemptAt?.getTime() ?? 0;
  if (attemptedAt > now.getTime() - STUCK_AFTER_MS) {
    throw new ConflictError(
      "That post is still publishing. Give it a few minutes before deciding it is stuck.",
    );
  }

  if (resolution.outcome === "published" && resolution.externalUrl) {
    try {
      const url = new URL(resolution.externalUrl);
      if (url.protocol !== "https:") throw new Error("not https");
    } catch {
      throw new ValidationError("That does not look like a link to the published post.");
    }
  }

  const published = resolution.outcome === "published";

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "SocialPost",
      entityId: post.id,
      before: { status: post.status },
      after: {
        status: published ? "PUBLISHED" : "FAILED",
        // Recorded explicitly: this state did not come from the platform, it
        // came from a person looking at the platform.
        resolvedByHand: true,
      },
    },
    async (tx) => {
      const updated = await tx.socialPost.update({
        where: { id: post.id },
        data: published
          ? {
              status: "PUBLISHED",
              publishedAt: now,
              externalUrl: resolution.externalUrl,
              lastError: null,
            }
          : {
              status: "FAILED",
              lastError:
                "A publication attempt was interrupted and the post was not found on the platform.",
            },
        select: { id: true, status: true },
      });

      // Close the open publication row so the history does not show an attempt
      // that never ended.
      await tx.socialPublication.updateMany({
        where: { postId: post.id, status: "PUBLISHING" },
        data: {
          status: published ? "PUBLISHED" : "FAILED",
          completedAt: now,
          externalUrl: published ? resolution.externalUrl : null,
          error: published ? null : "Interrupted; resolved by hand.",
        },
      });

      return updated;
    },
  );
}

/** Counts for the header, cheap enough to run on every load. */
export async function queueCounts(actor: Actor, filters: QueueFilters, now = new Date()) {
  requirePermission(actor, "social.view");
  const scope = await resolveScopeFilter(actor, filters.clientId);
  const strandedBefore = new Date(now.getTime() - STUCK_AFTER_MS);

  const [stranded, failed, due, upcoming] = await Promise.all([
    db.socialPost.count({
      where: {
        ...scope,
        status: "PUBLISHING",
        OR: [{ lastAttemptAt: { lt: strandedBefore } }, { lastAttemptAt: null }],
      },
    }),
    db.socialPost.count({ where: { ...scope, status: "FAILED" } }),
    db.socialPost.count({
      where: { ...scope, status: "SCHEDULED", scheduledFor: { lte: now } },
    }),
    db.socialPost.count({
      where: { ...scope, status: "SCHEDULED", scheduledFor: { gt: now } },
    }),
  ]);

  return { stranded, failed, due, upcoming };
}
