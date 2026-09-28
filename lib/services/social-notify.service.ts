import "server-only";
import { db } from "@/lib/db";
import { notify } from "@/lib/services/notification.service";
import { runAutomations } from "@/lib/automation/engine";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { log } from "@/lib/logger";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * Telling people when social work needs them.
 *
 * Two mechanisms, deliberately separate, because they answer different
 * questions.
 *
 * **Notifications** are for facts that always need a person regardless of how
 * an agency has configured anything: a post failed, the client answered. These
 * are not optional and are not rules — an agency that had to build a rule to
 * find out its client had rejected a post would find out too late.
 *
 * **Automation triggers** are for what an agency wants to *decide*: email the
 * account manager, tag the client, create a task. Those belong in the rules
 * engine that already exists, and now has social triggers in its vocabulary.
 *
 * None of these takes an actor or checks a permission, deliberately. They are
 * consequences of work that was already authorised — a publication that
 * happened, a decision a client already made — and are called from inside those
 * services, never from a route handler. They only ever write notifications to
 * the people already attached to the work.
 *
 * Everything here is best-effort and swallows its own errors. A notification
 * that fails must never roll back a publication that succeeded — the post is
 * already on the platform, and failing the transaction would make the database
 * disagree with the world.
 */

const notifyLog = log("social");

/** Who should hear about this post: its idea's owner, and whoever asked. */
async function audienceFor(postId: string): Promise<{
  userIds: string[];
  clientId: string;
  itemId: string;
  title: string;
  provider: SocialProvider;
}> {
  const post = await db.socialPost.findUniqueOrThrow({
    where: { id: postId },
    select: {
      clientId: true,
      provider: true,
      contentItem: {
        select: {
          id: true,
          title: true,
          ownerId: true,
          project: { select: { managerId: true } },
          approvals: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { requestedById: true },
          },
        },
      },
    },
  });

  const candidates = [
    post.contentItem.ownerId,
    post.contentItem.project?.managerId ?? null,
    post.contentItem.approvals[0]?.requestedById ?? null,
  ].filter((id): id is string => Boolean(id));

  return {
    // Deduplicated: the owner is often also the manager, and two identical
    // notifications read as a bug.
    userIds: [...new Set(candidates)],
    clientId: post.clientId,
    itemId: post.contentItem.id,
    title: post.contentItem.title,
    provider: post.provider,
  };
}

/** A post went out. Quiet by design — this is good news, not an interruption. */
export async function announcePublished(postId: string, externalUrl: string | null) {
  try {
    const audience = await audienceFor(postId);
    await runAutomations("SOCIAL_POST_PUBLISHED", {
      socialPostId: postId,
      clientId: audience.clientId,
      contentItemId: audience.itemId,
    });
    void externalUrl;
  } catch (error) {
    notifyLog.error({ err: error, postId }, "announcing a publication failed");
  }
}

/**
 * A post failed.
 *
 * Notified, not just triggered: somebody has to know, and they should not have
 * had to write a rule first.
 */
export async function announceFailure(postId: string, reason: string, willRetry: boolean) {
  try {
    const audience = await audienceFor(postId);

    await Promise.all(
      audience.userIds.map((userId) =>
        notify({
          userId,
          title: `${PROVIDER_LABEL[audience.provider]} post failed`,
          body: willRetry
            ? `${audience.title} — ${reason} It will be tried again automatically.`
            : `${audience.title} — ${reason}`,
          href: `/admin/social/queue`,
          entity: { type: "SocialPost", id: postId },
        }),
      ),
    );

    await runAutomations("SOCIAL_POST_FAILED", {
      socialPostId: postId,
      clientId: audience.clientId,
      contentItemId: audience.itemId,
    });
  } catch (error) {
    notifyLog.error({ err: error, postId }, "announcing a failure failed");
  }
}

/**
 * The client has answered.
 *
 * Goes to whoever asked them. An approval sitting answered and unnoticed is the
 * most expensive kind of silence in this whole workflow — it is the one thing
 * blocking everything downstream.
 */
export async function announceClientDecision(
  contentItemId: string,
  decision: "APPROVED" | "CHANGES_REQUESTED",
  feedback: string | null,
) {
  try {
    const item = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: contentItemId },
      select: {
        title: true,
        clientId: true,
        ownerId: true,
        client: { select: { name: true } },
        approvals: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { requestedById: true },
        },
        socialPosts: { take: 1, select: { id: true } },
      },
    });

    const userIds = [...new Set(
      [item.ownerId, item.approvals[0]?.requestedById ?? null].filter(
        (id): id is string => Boolean(id),
      ),
    )];

    const approved = decision === "APPROVED";
    await Promise.all(
      userIds.map((userId) =>
        notify({
          userId,
          title: approved
            ? `${item.client.name} approved "${item.title}"`
            : `${item.client.name} asked for changes to "${item.title}"`,
          body: feedback,
          href: `/admin/content/${contentItemId}`,
          entity: { type: "ContentCalendarItem", id: contentItemId },
        }),
      ),
    );

    await runAutomations(
      "SOCIAL_APPROVAL_DECIDED",
      {
        clientId: item.clientId,
        contentItemId,
        socialPostId: item.socialPosts[0]?.id ?? null,
      },
      { "social.decision": decision },
    );
  } catch (error) {
    notifyLog.error({ err: error, contentItemId }, "announcing a client decision failed");
  }
}
