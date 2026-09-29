import "server-only";
import { db } from "@/lib/db";
import { notify } from "@/lib/services/notification.service";
import { sendTemplate } from "@/lib/services/email.service";
import { absoluteUrl } from "@/lib/seo/urls";
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
export async function announcePublished(postId: string) {
  try {
    const audience = await audienceFor(postId);
    await runAutomations("SOCIAL_POST_PUBLISHED", {
      socialPostId: postId,
      clientId: audience.clientId,
      contentItemId: audience.itemId,
    });
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
          // The social item, where the approval panel and the versions are —
          // not the delivery calendar's page for the same row, which shows
          // neither.
          href: `/admin/clients/${item.clientId}/social/content/${contentItemId}`,
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

// ---------------------------------------------------------------------------
// Workflow steps added with internal review and monthly reports
// ---------------------------------------------------------------------------

/** An idea's title, client, owner, project manager and first version — what these messages need. */
async function itemContext(contentItemId: string) {
  return db.contentCalendarItem.findUniqueOrThrow({
    where: { id: contentItemId },
    select: {
      id: true,
      title: true,
      clientId: true,
      ownerId: true,
      client: { select: { name: true } },
      project: { select: { managerId: true } },
      socialPosts: { orderBy: { order: "asc" }, select: { id: true } },
    },
  });
}

/** The client's active portal users — the people who can act on a portal link. */
async function portalRecipients(clientId: string) {
  return db.user.findMany({
    where: { clientId, type: "CLIENT", status: "ACTIVE" },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Work was submitted for internal review ("Approval pending", brief §34):
 * the idea's owner and the project's manager hear about it, never the person
 * who submitted it.
 */
export async function announceReviewSubmitted(contentItemId: string, submittedById: string) {
  try {
    const item = await itemContext(contentItemId);
    const userIds = [...new Set([item.ownerId, item.project?.managerId ?? null])].filter(
      (id): id is string => Boolean(id) && id !== submittedById,
    );
    await Promise.all(
      userIds.map((userId) =>
        notify({
          userId,
          title: `Review pending: ${item.client.name}`,
          body: `"${item.title}" is waiting for internal review.`,
          href: `/admin/clients/${item.clientId}/social/content/${item.id}`,
          entity: { type: "ContentCalendarItem", id: item.id },
        }),
      ),
    );
    await runAutomations("SOCIAL_REVIEW_SUBMITTED", {
      clientId: item.clientId,
      contentItemId: item.id,
      socialPostId: item.socialPosts[0]?.id ?? null,
      actorUserId: submittedById,
    });
  } catch (error) {
    notifyLog.error({ err: error, contentItemId }, "announcing a review submission failed");
  }
}

/** The reviewer decided: the person who submitted it hears, with the feedback. */
export async function announceReviewDecided(
  contentItemId: string,
  submittedById: string,
  reviewerId: string,
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED",
  feedback: string | null,
) {
  if (submittedById === reviewerId) return;
  try {
    const item = await itemContext(contentItemId);
    await notify({
      userId: submittedById,
      title:
        decision === "APPROVED"
          ? `Approved internally: "${item.title}"`
          : decision === "REJECTED"
            ? `Rejected in review: "${item.title}"`
            : `Changes requested: "${item.title}"`,
      body: decision === "APPROVED" ? "It can go to the client now." : feedback,
      href: `/admin/clients/${item.clientId}/social/content/${item.id}`,
      entity: { type: "ContentCalendarItem", id: item.id },
    });
  } catch (error) {
    notifyLog.error({ err: error, contentItemId }, "announcing a review decision failed");
  }
}

/**
 * Work is with the client ("3 new posts waiting for approval", brief §34).
 * Emailed to the client's portal users — the portal has no inbox of its own,
 * and email is how a client finds out. A missing mail setup is logged by the
 * email service, never faked as sent.
 */
export async function announceSentToClient(contentItemId: string, approvalId: string, version: number) {
  try {
    const item = await itemContext(contentItemId);
    const posts = item.socialPosts.length;
    const recipients = await portalRecipients(item.clientId);
    for (const user of recipients) {
      await sendTemplate("CLIENT_NOTIFICATION", {
        to: user.email,
        variables: {
          clientName: item.client.name,
          subject: `${posts} ${posts === 1 ? "post is" : "posts are"} waiting for your approval`,
          body:
            version > 1
              ? `We have updated "${item.title}" after your feedback. ${posts} ${posts === 1 ? "post is" : "posts are"} ready for another look.`
              : `"${item.title}" is ready for your review: ${posts} ${posts === 1 ? "post" : "posts"}, one per platform.`,
          actionLabel: "Review in the portal",
          actionUrl: absoluteUrl(`/portal/approvals/${approvalId}`),
        },
        entity: { type: "Approval", id: approvalId },
      });
    }
    await runAutomations(
      "SOCIAL_SENT_FOR_APPROVAL",
      { clientId: item.clientId, contentItemId: item.id, socialPostId: item.socialPosts[0]?.id ?? null },
      { "social.approvalVersion": version },
    );
  } catch (error) {
    notifyLog.error({ err: error, contentItemId }, "announcing a client approval request failed");
  }
}

/** A post was scheduled — a trigger only; nobody needs interrupting for it. */
export async function announceScheduled(postId: string, actorUserId: string | null) {
  try {
    const audience = await audienceFor(postId);
    await runAutomations("SOCIAL_POST_SCHEDULED", {
      socialPostId: postId,
      clientId: audience.clientId,
      contentItemId: audience.itemId,
      actorUserId,
    });
  } catch (error) {
    notifyLog.error({ err: error, postId }, "announcing a schedule failed");
  }
}

/** A post's figures arrived for the day — a trigger only. */
export async function announceMetricsSynced(postId: string) {
  try {
    const audience = await audienceFor(postId);
    await runAutomations("SOCIAL_METRICS_SYNCED", {
      socialPostId: postId,
      clientId: audience.clientId,
      contentItemId: audience.itemId,
    });
  } catch (error) {
    notifyLog.error({ err: error, postId }, "announcing a metrics sync failed");
  }
}

/** A monthly report was published: the client's portal users are emailed a link. */
export async function announceReportPublished(reportId: string) {
  try {
    const report = await db.socialReport.findUniqueOrThrow({
      where: { id: reportId },
      select: { id: true, clientId: true, month: true, status: true, client: { select: { name: true } } },
    });
    if (report.status !== "PUBLISHED") return;
    const [year, month] = report.month.split("-").map(Number) as [number, number];
    const label = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    for (const user of await portalRecipients(report.clientId)) {
      await sendTemplate("CLIENT_NOTIFICATION", {
        to: user.email,
        variables: {
          clientName: report.client.name,
          subject: `Your ${label} social media report`,
          body: `Your social media report for ${label} is ready, with the month's figures, highlights and next month's plan.`,
          actionLabel: "Open the report",
          actionUrl: absoluteUrl(`/portal/social/reports/${report.id}`),
        },
        entity: { type: "SocialReport", id: report.id },
      });
    }
  } catch (error) {
    notifyLog.error({ err: error, reportId }, "announcing a report failed");
  }
}
