import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import { credentialsFor } from "@/lib/services/social-account.service";
import { socialProvider } from "@/lib/social";
import { AmbiguousPublishError } from "@/lib/social/errors";
import { MAX_ATTEMPTS, publicationKey } from "@/lib/social/idempotency";
import { tagLink } from "@/lib/social/utm";
import { log } from "@/lib/logger";
import { systemActor, type Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { PublishInput, SocialProviderAdapter } from "@/lib/social/types";

/**
 * Putting a post on a platform, exactly once.
 *
 * ## Exactly once, concretely
 *
 * The guarantee does not come from being careful. It comes from one row and
 * one conditional update:
 *
 * ```sql
 * UPDATE "SocialPost" SET status = 'PUBLISHING'
 *  WHERE id = $1 AND status = 'SCHEDULED'
 * ```
 *
 * Postgres serialises that. Exactly one caller sees a row affected, and only
 * that caller goes on to call the provider. Two overlapping cron runs, a cron
 * overlapping a human pressing Publish now, two humans pressing it at once —
 * they all contend for that single row and all but one lose. No lock table, no
 * queue, no advisory lock, no "check then act" window to lose a race in.
 *
 * `SocialPublication.idempotencyKey` is the second belt: derived from the post
 * and the attempt number, so a replayed attempt collides on a unique index
 * rather than recording a second publication that never happened.
 *
 * ## Why failure handling is fussy
 *
 * A failed publish is safe to retry. An **ambiguous** one is not — the post may
 * be on the client's feed already, and a retry would put a second copy there.
 * `AmbiguousPublishError` is terminal: no automatic retry, and the message
 * tells a person to go and look. A human checking one feed is cheap.
 */

const publishLog = log("social");

/**
 * Who the scheduler publishes as.
 *
 * A real actor rather than a null, for the same reason `schedulerActor` exists
 * for pages: the audit row then records that automation did this, with the
 * exact permissions the job needs and no bypass. `record` already writes a null
 * `actorId` for a SYSTEM actor, so the trail reads correctly without a special
 * case anywhere.
 */
/**
 * How an adapter is found.
 *
 * Injectable for the same reason `LinkedInProvider` takes its hosts: so the
 * engine can be exercised against a local double running the real adapter
 * code. Production never passes it.
 */
export type ResolveAdapter = (provider: SocialProvider) => Promise<SocialProviderAdapter>;

export function socialSchedulerActor(): Actor {
  return {
    ...systemActor(),
    name: "Scheduler",
    permissions: new Set(["social.view", "social.publish"]),
  };
}

/** Everything the engine needs to decide and to publish. */
const publishSelect = {
  id: true,
  clientId: true,
  provider: true,
  type: true,
  status: true,
  caption: true,
  headline: true,
  hashtags: true,
  mentions: true,
  callToAction: true,
  firstComment: true,
  linkUrl: true,
  utmCampaign: true,
  utmContent: true,
  scheduledFor: true,
  attemptCount: true,
  accountId: true,
  account: {
    select: { id: true, externalId: true, name: true, status: true, provider: true },
  },
  media: {
    orderBy: { order: "asc" },
    select: { media: { select: { url: true, mimeType: true, type: true } } },
  },
  contentItem: {
    select: {
      id: true,
      stage: true,
      title: true,
      campaign: { select: { name: true } },
    },
  },
} satisfies Prisma.SocialPostSelect;

type PublishablePost = Prisma.SocialPostGetPayload<{ select: typeof publishSelect }>;

/** Stages from which a version may legitimately go out. */
const PUBLISHABLE_STAGES = ["APPROVED", "SCHEDULED", "PUBLISHED"] as const;

/**
 * Everything that must be true before we call a platform.
 *
 * Checked before the claim, so a post that cannot go out is not left sitting in
 * `PUBLISHING` — and checked again by nothing afterwards, because between the
 * claim and the call the post is ours alone.
 */
function blockingReason(post: PublishablePost): string | null {
  if (!post.account) return "No account is connected for this version.";
  if (post.account.status !== "CONNECTED") {
    return `The ${post.account.name} account needs reconnecting before anything can be posted to it.`;
  }
  if (post.account.provider !== post.provider) {
    return "The connected account is for a different platform.";
  }
  // Defence in depth. Phase 3 will not let a post be scheduled unless its idea
  // is approved, and Phase 5 pulls an item back out of APPROVED the moment its
  // copy is edited — so an item that has drifted from what the client signed
  // off cannot reach here. Re-checked anyway, because this is the last gate
  // before something becomes public and irreversible.
  if (!(PUBLISHABLE_STAGES as readonly string[]).includes(post.contentItem.stage)) {
    return `"${post.contentItem.title}" is at ${post.contentItem.stage
      .toLowerCase()
      .replace(/_/g, " ")} and has not been approved for publication.`;
  }
  return null;
}

/** Turn a stored post into what an adapter takes, links tagged on the way. */
function toPublishInput(post: PublishablePost): PublishInput {
  return {
    type: post.type,
    caption: post.caption,
    headline: post.headline,
    hashtags: post.hashtags,
    mentions: post.mentions,
    callToAction: post.callToAction,
    firstComment: post.firstComment,
    // Tagged here so every adapter receives a finished link and none of them
    // has to know what a UTM is.
    linkUrl: tagLink(post.linkUrl, {
      provider: post.provider,
      campaign: post.utmCampaign ?? post.contentItem.campaign?.name ?? null,
      content: post.utmContent,
    }),
    media: post.media
      .filter((row) => row.media.type === "IMAGE" || row.media.type === "VIDEO")
      .map((row) => ({
        url: row.media.url,
        mimeType: row.media.mimeType ?? "application/octet-stream",
        thumbnailUrl: null,
      })),
  };
}

export type PublishSuccess = { postId: string; ok: true; externalUrl: string | null };
export type PublishFailure = {
  postId: string;
  ok: false;
  reason: string;
  /** Whether the next scheduler run will pick it up again by itself. */
  willRetry: boolean;
};
export type PublishOutcome = PublishSuccess | PublishFailure;

/**
 * Publish one post.
 *
 * `actor` is the scheduler's SYSTEM actor for an automatic run, or the person's
 * own when they publish early or retry a failure. Either way it is recorded.
 */
async function runPublication(
  post: PublishablePost,
  actor: Actor,
  resolve: ResolveAdapter,
): Promise<PublishOutcome> {
  const blocked = blockingReason(post);
  if (blocked) {
    return { postId: post.id, ok: false, reason: blocked, willRetry: false };
  }

  const adapter = await resolve(post.provider);
  if (!adapter.configured) {
    return {
      postId: post.id,
      ok: false,
      reason: `${adapter.label} is not configured in this deployment.`,
      willRetry: false,
    };
  }

  // ---- The claim. Everything above is a read; this is the mutex. ----------
  const claimed = await db.socialPost.updateMany({
    where: { id: post.id, status: { in: ["SCHEDULED", "FAILED"] } },
    // `lastAttemptAt` is stamped here, at the *start*, not only on completion.
    // It is what tells the queue whether a post sitting in PUBLISHING is
    // genuinely in flight or was stranded by a process that died mid-publish.
    // Left to the completion write, a retry would carry the previous attempt's
    // timestamp and be called stranded the moment it began.
    data: { status: "PUBLISHING", lastAttemptAt: new Date() },
  });
  if (claimed.count === 0) {
    // Somebody else has it, or it already went out. Either way, not ours.
    return {
      postId: post.id,
      ok: false,
      reason: "Already being published, or already published.",
      willRetry: false,
    };
  }

  const attempt = post.attemptCount + 1;
  const account = post.account!;

  // The publication row is written before the call, so an attempt that dies
  // mid-flight still leaves a trace of having been made.
  let publicationId: string;
  try {
    const publication = await db.socialPublication.create({
      data: {
        postId: post.id,
        clientId: post.clientId,
        provider: post.provider,
        status: "PUBLISHING",
        idempotencyKey: publicationKey(post.id, attempt),
        attempt,
        // A SYSTEM actor has no User row to point at.
        triggeredById: actor.type === "SYSTEM" ? null : actor.userId,
      },
      select: { id: true },
    });
    publicationId = publication.id;
  } catch {
    // The unique index refused it: this exact attempt is already recorded, so
    // another worker is mid-flight. Release nothing and do not publish.
    publishLog.warn({ postId: post.id, attempt }, "duplicate publication attempt refused");
    return {
      postId: post.id,
      ok: false,
      reason: "That attempt is already in flight.",
      willRetry: false,
    };
  }

  const credentials = await credentialsFor(account.id);
  if (!credentials) {
    return finishFailure(
      post,
      publicationId,
      attempt,
      "The stored credentials could not be read. Reconnect the account.",
      false,
      actor,
    );
  }

  try {
    const result = await adapter.publish(
      credentials,
      { externalId: account.externalId },
      toPublishInput(post),
    );

    const publishedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.socialPost.update({
        where: { id: post.id },
        data: {
          status: "PUBLISHED",
          publishedAt,
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl,
          lastError: null,
          lastAttemptAt: publishedAt,
          attemptCount: attempt,
        },
      });

      await tx.socialPublication.update({
        where: { id: publicationId },
        data: {
          status: "PUBLISHED",
          completedAt: publishedAt,
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl,
        },
      });

      // The idea is published once every one of its versions is out. Doing it
      // here rather than per-post keeps the calendar honest for an idea whose
      // LinkedIn version goes out a day after its Instagram one.
      const outstanding = await tx.socialPost.count({
        where: {
          contentItemId: post.contentItem.id,
          status: { notIn: ["PUBLISHED", "CANCELLED"] },
        },
      });
      if (outstanding === 0) {
        await tx.contentCalendarItem.update({
          where: { id: post.contentItem.id },
          data: { stage: "PUBLISHED", publishedAt },
        });
      }
    });

    await record({
      actor,
      action: "PUBLISH",
      entityType: "SocialPost",
      entityId: post.id,
      after: {
        provider: post.provider,
        externalPostId: result.externalPostId,
        attempt,
        by: actor.type === "SYSTEM" ? "scheduler" : "staff",
      },
    });

    return { postId: post.id, ok: true, externalUrl: result.externalUrl };
  } catch (error) {
    // Ambiguous means the post may be live. Never retry it automatically.
    const ambiguous = error instanceof AmbiguousPublishError;
    const message =
      error instanceof Error ? error.message : "The platform rejected the post.";

    publishLog.error(
      { err: error, postId: post.id, provider: post.provider, attempt, ambiguous },
      "publishing failed",
    );

    return finishFailure(
      post,
      publicationId,
      attempt,
      message,
      !ambiguous && attempt < MAX_ATTEMPTS,
      actor,
    );
  }
}

/**
 * Record a failure and decide where the post rests.
 *
 * `FAILED` either way. A retryable failure is picked up again by the next
 * scheduler run — which selects failed posts under the attempt ceiling — rather
 * than being put back to `SCHEDULED`, because a post sitting at `SCHEDULED`
 * with three failures behind it reads as fine on every screen.
 */
async function finishFailure(
  post: PublishablePost,
  publicationId: string,
  attempt: number,
  reason: string,
  willRetry: boolean,
  actor: Actor,
): Promise<PublishFailure> {
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.socialPost.update({
      where: { id: post.id },
      data: {
        status: "FAILED",
        lastError: reason,
        lastAttemptAt: now,
        attemptCount: attempt,
      },
    });
    await tx.socialPublication.update({
      where: { id: publicationId },
      data: { status: "FAILED", completedAt: now, error: reason },
    });
  });

  await record({
    actor,
    action: "STATUS_CHANGE",
    entityType: "SocialPost",
    entityId: post.id,
    after: {
      status: "FAILED",
      attempt,
      willRetry,
      by: actor.type === "SYSTEM" ? "scheduler" : "staff",
    },
  });

  return { postId: post.id, ok: false, reason, willRetry };
}

/**
 * Publish everything that is due.
 *
 * Called by the cron endpoint. Picks up posts whose time has come, plus failed
 * posts still under the attempt ceiling, and works them one at a time — one
 * client's broken account must not stop another client's launch.
 */
export async function publishDuePosts(
  now = new Date(),
  resolve: ResolveAdapter = socialProvider,
): Promise<{
  attempted: number;
  published: number;
  failed: PublishFailure[];
}> {
  const due = await db.socialPost.findMany({
    where: {
      scheduledFor: { lte: now },
      OR: [
        { status: "SCHEDULED" },
        // A retry, but only while there are attempts left. Without the ceiling
        // a permanently broken post is retried every five minutes forever.
        { status: "FAILED", attemptCount: { lt: MAX_ATTEMPTS } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
    select: publishSelect,
  });

  const scheduler = socialSchedulerActor();
  const failed: PublishFailure[] = [];
  let published = 0;

  for (const post of due) {
    try {
      const outcome = await runPublication(post, scheduler, resolve);
      if (outcome.ok) published++;
      else failed.push(outcome);
    } catch (error) {
      // A post that throws outside the handled paths must not take the batch
      // down with it.
      publishLog.error({ err: error, postId: post.id }, "publication crashed");
      failed.push({
        postId: post.id,
        ok: false,
        reason: "The publication crashed.",
        willRetry: false,
      });
    }
  }

  return { attempted: due.length, published, failed };
}

/**
 * Publish one post now, or retry one that failed.
 *
 * The same engine the scheduler uses — a second publish path would drift from
 * the first one the day somebody changed it.
 */
export async function publishNow(
  actor: Actor,
  postId: string,
  resolve: ResolveAdapter = socialProvider,
): Promise<PublishOutcome> {
  requirePermission(actor, "social.publish");

  const post = await db.socialPost.findUnique({ where: { id: postId }, select: publishSelect });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);

  if (post.status === "PUBLISHED") {
    throw new ConflictError("That post has already gone out.");
  }
  if (post.status === "PUBLISHING") {
    throw new ConflictError("That post is being published right now.");
  }
  if (post.status === "CANCELLED") {
    throw new ValidationError("That post was cancelled. Put it back in draft first.");
  }

  // A human may retry past the automatic ceiling — the ceiling exists to stop
  // a cron hammering a broken platform, not to stop a person who has just
  // fixed the problem.
  const outcome = await runPublication({ ...post, status: "SCHEDULED" }, actor, resolve);
  if (!outcome.ok) throw new ValidationError(outcome.reason);
  return outcome;
}

/** The attempt history for one post, for the screen. */
export async function publicationsFor(actor: Actor, postId: string) {
  requirePermission(actor, "social.view");

  const post = await db.socialPost.findUnique({
    where: { id: postId },
    select: { clientId: true },
  });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);

  return db.socialPublication.findMany({
    where: { postId },
    orderBy: { attempt: "desc" },
    select: {
      id: true,
      attempt: true,
      status: true,
      error: true,
      externalUrl: true,
      attemptedAt: true,
      completedAt: true,
      triggeredBy: { select: { id: true, name: true } },
    },
  });
}
