import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import { buildSnapshot, readSnapshot, type SnapshotSource } from "@/lib/social/approval-snapshot";
import { canTransitionContent } from "@/lib/projects/lifecycle";
import { POST_TYPE_LABEL, PROVIDER_LABEL, TYPES_REQUIRING_MEDIA } from "@/lib/social/capabilities";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Sending social work to the client, and reading back what they said.
 *
 * This does **not** introduce a second approval system. It writes the same
 * `Approval` and `ApprovalVersion` rows the delivery side already uses, which
 * the portal already lists and decides on, and which the audit trail already
 * covers. What it adds is the part those rows could not carry: a social
 * approval is several platform versions rather than one file, so the versions
 * are snapshotted onto the approval version at the moment it is sent.
 *
 * The stage and the approval move together. An item in `CLIENT_REVIEW` with a
 * pending approval is the one state where a client is genuinely waiting, and
 * the two must not be able to disagree about it.
 */

const snapshotSelect = {
  id: true,
  provider: true,
  type: true,
  caption: true,
  headline: true,
  hashtags: true,
  mentions: true,
  callToAction: true,
  firstComment: true,
  linkUrl: true,
  scheduledFor: true,
  account: { select: { name: true } },
  media: {
    orderBy: { order: "asc" },
    select: { media: { select: { url: true, type: true, alt: true } } },
  },
} satisfies Prisma.SocialPostSelect;

/**
 * Whether a set of versions is fit to put in front of a client.
 *
 * Refuses rather than guesses. Sending an empty idea, or a version with
 * nothing written on it, wastes the one piece of the client's attention the
 * agency gets to spend per round.
 */
function readinessError(posts: readonly SnapshotSource[]): string | null {
  if (posts.length === 0) {
    return "Write at least one platform version before sending this to the client.";
  }

  for (const post of posts) {
    const name = PROVIDER_LABEL[post.provider];
    const hasCopy = Boolean(post.caption?.trim() || post.headline?.trim());
    const hasMedia = post.media.length > 0;

    // Words or a creative: "look at this picture" is a legitimate post, and so
    // is a bare text update. Neither is not.
    if (!hasCopy && !hasMedia) {
      return `The ${name} version is empty.`;
    }
    if (TYPES_REQUIRING_MEDIA.has(post.type) && !hasMedia) {
      return `The ${name} ${POST_TYPE_LABEL[post.type].toLowerCase()} needs a creative.`;
    }
  }

  return null;
}

/** The stages from which work can be sent out for client sign-off. */
const SENDABLE = ["DRAFT", "INTERNAL_REVIEW"] as const;

export async function requestSocialApproval(
  actor: Actor,
  input: { contentItemId: string; note: string | null },
) {
  requirePermission(actor, "social.approve");

  const item = await db.contentCalendarItem.findUnique({
    where: { id: input.contentItemId },
    select: {
      id: true,
      clientId: true,
      projectId: true,
      title: true,
      stage: true,
      scheduledFor: true,
      socialPosts: { orderBy: { order: "asc" }, select: snapshotSelect },
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, currentVersion: true },
      },
    },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);

  const open = item.approvals[0];
  if (open && open.status === "PENDING") {
    throw new ConflictError("This is already with the client. Wait for their decision.");
  }

  if (!(SENDABLE as readonly string[]).includes(item.stage)) {
    throw new ValidationError(
      `Content at ${item.stage.toLowerCase().replace(/_/g, " ")} cannot be sent for client review.`,
    );
  }
  if (!canTransitionContent(item.stage, "CLIENT_REVIEW")) {
    throw new ValidationError("This content cannot move to client review from where it is.");
  }

  const problem = readinessError(item.socialPosts);
  if (problem) throw new ValidationError(problem);

  const snapshot = buildSnapshot(item, item.socialPosts);

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "ContentCalendarItem",
      entityId: item.id,
      before: { stage: item.stage },
      // The snapshot is on the row; repeating every caption in the audit
      // payload would bloat it without adding a fact.
      after: { stage: "CLIENT_REVIEW", versions: item.socialPosts.length },
    },
    async (tx) => {
      // A second round reuses the approval rather than opening a new one, so
      // the client sees one thread with its history instead of a new item in
      // their list every time something is re-sent.
      const reopened = open && open.status !== "APPROVED" ? open : null;
      const version = reopened ? reopened.currentVersion + 1 : 1;

      const approvalId =
        reopened?.id ??
        (
          await tx.approval.create({
            data: {
              clientId: item.clientId,
              projectId: item.projectId,
              contentItemId: item.id,
              title: item.title,
              status: "PENDING",
              currentVersion: 1,
              requestedById: actor.userId,
            },
            select: { id: true },
          })
        ).id;

      if (reopened) {
        await tx.approval.update({
          where: { id: approvalId },
          data: {
            status: "PENDING",
            currentVersion: version,
            decidedById: null,
            decidedAt: null,
          },
        });
      }

      await tx.approvalVersion.create({
        data: {
          approvalId,
          version,
          notes: input.note,
          status: "PENDING",
          snapshot,
          createdById: actor.userId,
        },
      });

      await tx.contentCalendarItem.update({
        where: { id: item.id },
        data: { stage: "CLIENT_REVIEW" },
      });

      return { approvalId, version };
    },
  );
}

/**
 * The approval thread for one content item, for the admin side.
 *
 * Returns null when nothing has ever been sent — which is the common case and
 * not an error.
 */
export async function socialApprovalFor(actor: Actor, contentItemId: string) {
  requirePermission(actor, "social.view");

  const item = await db.contentCalendarItem.findUnique({
    where: { id: contentItemId },
    select: { clientId: true },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);

  const approval = await db.approval.findFirst({
    where: { contentItemId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      currentVersion: true,
      createdAt: true,
      decidedAt: true,
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          notes: true,
          status: true,
          feedback: true,
          snapshot: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!approval) return null;

  return {
    ...approval,
    versions: approval.versions.map((version) => ({
      ...version,
      snapshot: readSnapshot(version.snapshot),
    })),
  };
}

/**
 * Pull work back before the client has decided.
 *
 * Needed because the alternative is worse: without it, spotting a typo after
 * sending leaves the choice between editing underneath a reviewer and waiting
 * for a decision on copy you already know is wrong.
 *
 * `WITHDRAWN` rather than leaving it `PENDING`, because the portal would go on
 * asking for a decision on something no longer offered; and rather than
 * `REJECTED`, which is the client's word and not the agency's to put in their
 * mouth. The version stays on the record — withdrawing is an event, not an
 * erasure.
 */
export async function withdrawSocialApproval(actor: Actor, contentItemId: string) {
  requirePermission(actor, "social.approve");

  const item = await db.contentCalendarItem.findUnique({
    where: { id: contentItemId },
    select: {
      id: true,
      clientId: true,
      stage: true,
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, currentVersion: true },
      },
    },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);

  const approval = item.approvals[0];
  if (!approval || approval.status !== "PENDING") {
    throw new ConflictError("There is nothing with the client to withdraw.");
  }

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "Approval",
      entityId: approval.id,
      before: { status: approval.status, stage: item.stage },
      after: { status: "WITHDRAWN", stage: "INTERNAL_REVIEW" },
    },
    async (tx) => {
      await tx.approvalVersion.update({
        where: { approvalId_version: { approvalId: approval.id, version: approval.currentVersion } },
        data: { status: "WITHDRAWN" },
      });

      await tx.approval.update({
        where: { id: approval.id },
        data: { status: "WITHDRAWN", decidedById: actor.userId, decidedAt: new Date() },
      });

      // Back to internal review rather than draft: the work is still finished,
      // it simply is not in front of the client any more.
      return tx.contentCalendarItem.update({
        where: { id: item.id },
        data: { stage: "INTERNAL_REVIEW" },
        select: { id: true, stage: true },
      });
    },
  );
}
