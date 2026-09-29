import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import { buildSnapshot, contentFingerprint, readSnapshot, type SocialSnapshot } from "@/lib/social/approval-snapshot";
import { readinessError, snapshotSelect } from "@/lib/services/social-approval.service";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";
import type { InternalReviewStatus } from "@/generated/prisma/enums";

/**
 * Internal review: the agency checks its own work before the client sees it.
 *
 * Brief §15 — designer, then caption, then an account manager reviews, then
 * the client. A round is submitted with a frozen snapshot of every platform
 * version, and decided by someone holding `social.review`: approved, sent back
 * with changes requested, or rejected, with feedback required for the last
 * two. Rounds are never overwritten, so the history of who approved what
 * stays intact.
 *
 * Internal approval is **mandatory** before anything goes to the client, and
 * it approves *content*, not an idea's id: `requestSocialApproval` sends only
 * when the latest round is approved and its snapshot says what the versions
 * say now (`contentFingerprint` — times excluded, so a reschedule keeps it).
 * Editing a version while a round is waiting withdraws that round, so a
 * reviewer never approves something that has changed underneath them.
 */

type Tx = Prisma.TransactionClient;

/** Stages from which work can be submitted. INTERNAL_REVIEW covers a resubmission. */
const SUBMITTABLE = ["IDEA", "DRAFT", "INTERNAL_REVIEW"] as const;

export type InternalDecision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

/** Internal rounds are the agency's own business: never shown to, or made by, a client. */
function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF") throw new NotFoundError("That content item does not exist.");
}

async function itemForReview(contentItemId: string) {
  const item = await db.contentCalendarItem.findUnique({
    where: { id: contentItemId },
    select: {
      id: true,
      clientId: true,
      title: true,
      stage: true,
      scheduledFor: true,
      socialPosts: { orderBy: { order: "asc" }, select: snapshotSelect },
      internalReviews: {
        orderBy: { round: "desc" },
        take: 1,
        select: { id: true, round: true, status: true, snapshot: true },
      },
    },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  return item;
}

/** Submit an idea's platform versions for internal review. */
export async function submitForInternalReview(actor: Actor, input: { contentItemId: string; note: string | null }) {
  requirePermission(actor, "social.edit");
  staffOnly(actor);
  const item = await itemForReview(input.contentItemId);
  await resolveClientScope(actor, item.clientId);

  const latest = item.internalReviews[0];
  if (latest?.status === "PENDING") throw new ConflictError("This is already waiting for internal review.");
  if (!(SUBMITTABLE as readonly string[]).includes(item.stage)) {
    throw new ValidationError(
      `Content at ${item.stage.toLowerCase().replace(/_/g, " ")} cannot be submitted for internal review.`,
    );
  }
  const problem = readinessError(item.socialPosts);
  if (problem) throw new ValidationError(problem);

  const snapshot = buildSnapshot(item, item.socialPosts);
  const round = (latest?.round ?? 0) + 1;
  const note = input.note?.trim() ? input.note.trim().slice(0, 2_000) : null;

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "ContentCalendarItem",
      entityId: item.id,
      before: { stage: item.stage },
      after: { stage: "INTERNAL_REVIEW", internalReview: "SUBMITTED", round, versions: item.socialPosts.length },
    },
    async (tx) => {
      // The unique (item, round) key turns a double submit into an error
      // instead of two rounds with the same number.
      const review = await tx.socialInternalReview.create({
        data: {
          contentItemId: item.id,
          clientId: item.clientId,
          round,
          note,
          snapshot,
          submittedById: actor.userId,
        },
        select: { id: true, round: true },
      });
      if (item.stage !== "INTERNAL_REVIEW") {
        await tx.contentCalendarItem.update({ where: { id: item.id }, data: { stage: "INTERNAL_REVIEW" } });
      }
      return review;
    },
  );
}

/** Approve, send back, or reject the round waiting on an idea. */
export async function decideInternalReview(
  actor: Actor,
  input: { contentItemId: string; decision: InternalDecision; feedback: string | null },
) {
  requirePermission(actor, "social.review");
  staffOnly(actor);
  const item = await itemForReview(input.contentItemId);
  await resolveClientScope(actor, item.clientId);

  const round = item.internalReviews[0];
  if (!round || round.status !== "PENDING") throw new ConflictError("Nothing is waiting for internal review here.");
  if (item.stage !== "INTERNAL_REVIEW") {
    throw new ConflictError("This content has moved on since it was submitted.");
  }

  const feedback = input.feedback?.trim() ? input.feedback.trim().slice(0, 5_000) : null;
  if (input.decision !== "APPROVED" && (!feedback || feedback.length < 3)) {
    throw new ValidationError(
      input.decision === "REJECTED" ? "Say why it is rejected." : "Say what needs to change.",
    );
  }

  // Belt and braces: an edit withdraws a waiting round, but if the versions no
  // longer say what was submitted, approving would put a name to words nobody
  // reviewed. Withdraw instead, and say so.
  const submitted = readSnapshot(round.snapshot);
  const current = item.socialPosts.length > 0 ? buildSnapshot(item, item.socialPosts) : null;
  if (!submitted || !current || contentFingerprint(submitted) !== contentFingerprint(current)) {
    await db.socialInternalReview.updateMany({
      where: { id: round.id, status: "PENDING" },
      data: { status: "WITHDRAWN", feedback: "The content changed after it was submitted.", decidedAt: new Date() },
    });
    throw new ConflictError("The content changed after it was submitted. It needs submitting again.");
  }

  const nextStage = input.decision === "APPROVED" ? "INTERNAL_REVIEW" : "DRAFT";
  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "ContentCalendarItem",
      entityId: item.id,
      before: { stage: item.stage, internalReview: "PENDING", round: round.round },
      after: { stage: nextStage, internalReview: input.decision, round: round.round, feedback },
    },
    async (tx) => {
      // Conditional on still being PENDING: two reviewers deciding at once
      // must not both win.
      const { count } = await tx.socialInternalReview.updateMany({
        where: { id: round.id, status: "PENDING" },
        data: { status: input.decision, feedback, reviewerId: actor.userId, decidedAt: new Date() },
      });
      if (count === 0) throw new ConflictError("Someone else decided this round a moment ago.");
      if (nextStage !== item.stage) {
        await tx.contentCalendarItem.update({ where: { id: item.id }, data: { stage: nextStage } });
      }
      return { id: round.id, round: round.round, status: input.decision };
    },
  );
}

/** Pull a waiting round back, to change something before anyone reviews it. */
export async function withdrawInternalReview(actor: Actor, contentItemId: string) {
  requirePermission(actor, "social.edit");
  staffOnly(actor);
  const item = await itemForReview(contentItemId);
  await resolveClientScope(actor, item.clientId);

  const round = item.internalReviews[0];
  if (!round || round.status !== "PENDING") throw new ConflictError("Nothing is waiting for internal review here.");

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "ContentCalendarItem",
      entityId: item.id,
      before: { stage: item.stage, internalReview: "PENDING", round: round.round },
      after: { stage: "DRAFT", internalReview: "WITHDRAWN", round: round.round },
    },
    async (tx) => {
      const { count } = await tx.socialInternalReview.updateMany({
        where: { id: round.id, status: "PENDING" },
        data: { status: "WITHDRAWN", decidedAt: new Date() },
      });
      if (count === 0) throw new ConflictError("This round was decided a moment ago.");
      if (item.stage === "INTERNAL_REVIEW") {
        await tx.contentCalendarItem.update({ where: { id: item.id }, data: { stage: "DRAFT" } });
      }
      return { id: round.id };
    },
  );
}

/**
 * Called inside an edit's transaction: a round waiting on this idea no longer
 * describes it, so it is withdrawn and the idea goes back to draft. A no-op
 * when nothing is waiting.
 */
export async function supersedePendingReview(tx: Tx, contentItemId: string): Promise<boolean> {
  const { count } = await tx.socialInternalReview.updateMany({
    where: { contentItemId, status: "PENDING" },
    data: { status: "WITHDRAWN", feedback: "Edited after it was submitted.", decidedAt: new Date() },
  });
  if (count > 0) {
    await tx.contentCalendarItem.updateMany({
      where: { id: contentItemId, stage: "INTERNAL_REVIEW" },
      data: { stage: "DRAFT" },
    });
  }
  return count > 0;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type InternalReviewRound = {
  id: string;
  round: number;
  status: InternalReviewStatus;
  note: string | null;
  feedback: string | null;
  submittedAt: Date;
  submittedBy: string | null;
  decidedAt: Date | null;
  reviewer: string | null;
  snapshot: SocialSnapshot | null;
};

/**
 * An idea's review history, newest first, and whether it may go to the client
 * as it stands: the latest round approved, and still saying what it said.
 */
export async function internalReviewsFor(actor: Actor, contentItemId: string) {
  requirePermission(actor, "social.view");
  staffOnly(actor);
  const item = await itemForReview(contentItemId);
  await resolveClientScope(actor, item.clientId);

  const rows = await db.socialInternalReview.findMany({
    where: { contentItemId },
    orderBy: { round: "desc" },
    select: {
      id: true,
      round: true,
      status: true,
      note: true,
      feedback: true,
      snapshot: true,
      submittedAt: true,
      decidedAt: true,
      submittedBy: { select: { name: true } },
      reviewer: { select: { name: true } },
    },
  });
  const rounds: InternalReviewRound[] = rows.map((row) => ({
    id: row.id,
    round: row.round,
    status: row.status,
    note: row.note,
    feedback: row.feedback,
    submittedAt: row.submittedAt,
    submittedBy: row.submittedBy.name,
    decidedAt: row.decidedAt,
    reviewer: row.reviewer?.name ?? null,
    snapshot: readSnapshot(row.snapshot),
  }));

  const latest = rounds[0];
  const current = item.socialPosts.length > 0 ? buildSnapshot(item, item.socialPosts) : null;
  const approvedAsItStands =
    latest?.status === "APPROVED" &&
    latest.snapshot !== null &&
    current !== null &&
    contentFingerprint(latest.snapshot) === contentFingerprint(current);

  return { rounds, approvedAsItStands };
}

/** Ideas waiting for internal review for one client, oldest first. */
export async function pendingInternalReviews(actor: Actor, clientId: string) {
  requirePermission(actor, "social.view");
  staffOnly(actor);
  const scope = await resolveClientScope(actor, clientId);
  return db.socialInternalReview.findMany({
    where: { clientId: scope, status: "PENDING" },
    orderBy: { submittedAt: "asc" },
    take: 100,
    select: {
      id: true,
      round: true,
      submittedAt: true,
      note: true,
      submittedBy: { select: { name: true } },
      contentItem: { select: { id: true, title: true } },
    },
  });
}

/** The latest round's status for each of a client's ideas that has one. */
export async function latestReviewStatuses(actor: Actor, clientId: string): Promise<Map<string, InternalReviewStatus>> {
  requirePermission(actor, "social.view");
  staffOnly(actor);
  const scope = await resolveClientScope(actor, clientId);
  const rows = await db.socialInternalReview.findMany({
    where: { clientId: scope },
    distinct: ["contentItemId"],
    orderBy: [{ contentItemId: "asc" }, { round: "desc" }],
    select: { contentItemId: true, status: true },
  });
  return new Map(rows.map((row) => [row.contentItemId, row.status]));
}
