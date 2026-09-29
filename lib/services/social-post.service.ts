import "server-only";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { resolveClientScope } from "@/lib/social/scope";
import { supersedePendingReview } from "@/lib/services/social-review.service";
import type { Prisma } from "@/generated/prisma/client";
import type { SocialPostStatus, SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";
import type { SocialPostInput, SocialPostListParams } from "@/lib/validation/social";

/**
 * Platform versions of a content item.
 *
 * One idea, several posts: the Instagram version, the LinkedIn version, the
 * Google Business Profile version. They hang off the `ContentCalendarItem` the
 * delivery calendar and the approval workflow already use, so a social post is
 * not a second kind of content — it is the platform-shaped half of the content
 * that already existed.
 *
 * Two rules this service exists to hold:
 *
 * 1. **`clientId` is copied from the content item, never accepted.** The item
 *    already copies it from its project. A caller can name a content item; it
 *    cannot name whose it is.
 * 2. **A post that has gone out is not editable.** Once a post is PUBLISHING or
 *    PUBLISHED its copy is a record of what was published. Editing it would
 *    make the archive a description of something that never happened, and the
 *    provider would not change the live post anyway.
 */

const postSelect = {
  id: true,
  clientId: true,
  contentItemId: true,
  accountId: true,
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
  publishedAt: true,
  externalPostId: true,
  externalUrl: true,
  lastError: true,
  ambiguous: true,
  lastAttemptAt: true,
  attemptCount: true,
  aiDraftedAt: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, name: true, username: true, status: true } },
  contentItem: {
    select: {
      id: true,
      title: true,
      stage: true,
      campaign: { select: { id: true, name: true } },
    },
  },
  media: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      media: { select: { id: true, url: true, type: true, alt: true, mimeType: true } },
      thumbnail: { select: { id: true, url: true } },
    },
  },
} satisfies Prisma.SocialPostSelect;

export type SocialPostRow = Prisma.SocialPostGetPayload<{ select: typeof postSelect }>;

/** Statuses whose copy is a historical record rather than a draft. */
const LOCKED: readonly SocialPostStatus[] = ["PUBLISHING", "PUBLISHED"];

export async function listPosts(actor: Actor, params: SocialPostListParams) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, params.clientId);

  return db.socialPost.findMany({
    where: {
      clientId: scope,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.campaignId ? { contentItem: { campaignId: params.campaignId } } : {}),
      ...(params.from || params.to
        ? {
            scheduledFor: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ scheduledFor: "asc" }, { order: "asc" }],
    select: postSelect,
  });
}

export async function getPost(actor: Actor, id: string): Promise<SocialPostRow> {
  requirePermission(actor, "social.view");

  const post = await db.socialPost.findUnique({ where: { id }, select: postSelect });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);
  return post;
}

/** Every platform version of one idea, which is how the editor lists them. */
export async function listPostsForItem(actor: Actor, contentItemId: string) {
  requirePermission(actor, "social.view");

  const item = await db.contentCalendarItem.findUnique({
    where: { id: contentItemId },
    select: { clientId: true },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);

  return db.socialPost.findMany({
    where: { contentItemId },
    orderBy: { order: "asc" },
    select: postSelect,
  });
}

/**
 * Create or update one platform version.
 *
 * The account is checked against the post's own client and provider: attaching
 * a post to an account belonging to a different client, or to an Instagram
 * account when the post says LinkedIn, is refused here rather than discovered
 * at publication.
 */
export async function savePost(
  actor: Actor,
  id: string | null,
  input: SocialPostInput,
): Promise<SocialPostRow> {
  requirePermission(actor, id ? "social.edit" : "social.create");

  const item = await db.contentCalendarItem.findUnique({
    where: { id: input.contentItemId },
    select: { id: true, clientId: true, stage: true },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  const scope = await resolveClientScope(actor, item.clientId);

  // The client is reading this right now. Editing underneath them would mean
  // they approve something they never saw, and the snapshot on the approval
  // would stop matching the live post. Pull it back first.
  if (item.stage === "CLIENT_REVIEW") {
    throw new ConflictError(
      "This is with the client for review. Withdraw it before changing the copy.",
    );
  }

  let before: { status: SocialPostStatus; clientId: string } | null = null;
  // Whether this save changes what the post *says*. A new version always does;
  // an edit that only moves the date does not, and keeps its approvals (the
  // agency's rule: a reschedule is not a new piece of content).
  let contentChanged = true;
  if (id) {
    const existing = await db.socialPost.findUnique({
      where: { id },
      select: {
        status: true,
        clientId: true,
        contentItemId: true,
        provider: true,
        type: true,
        accountId: true,
        caption: true,
        headline: true,
        hashtags: true,
        mentions: true,
        callToAction: true,
        firstComment: true,
        linkUrl: true,
        media: { orderBy: { order: "asc" }, select: { mediaId: true } },
      },
    });
    if (!existing) throw new NotFoundError("That post does not exist.");
    await resolveClientScope(actor, existing.clientId);
    if (LOCKED.includes(existing.status)) {
      throw new ConflictError(
        "This post has already gone out. Its copy is the record of what was published.",
      );
    }
    before = { status: existing.status, clientId: existing.clientId };
    contentChanged = !sameContent(existing, input);
    if (existing.status === "SCHEDULED" && input.scheduledFor && input.scheduledFor.getTime() < Date.now()) {
      throw new ValidationError("A scheduled post cannot be moved into the past. Pick a time ahead, or publish it now.");
    }
  }

  if (input.accountId) {
    const account = await db.socialAccount.findUnique({
      where: { id: input.accountId },
      select: { clientId: true, provider: true, status: true },
    });
    if (!account || account.clientId !== scope) {
      throw new NotFoundError("That account does not exist.");
    }
    if (account.provider !== input.provider) {
      throw new ValidationError(
        `That account is ${PROVIDER_LABEL[account.provider]}, but the post is for ${PROVIDER_LABEL[input.provider]}.`,
      );
    }
  }

  const media = await resolveMedia(input.mediaIds, input.provider);

  const data = {
    contentItemId: item.id,
    clientId: scope,
    accountId: input.accountId,
    provider: input.provider,
    type: input.type,
    caption: input.caption,
    headline: input.headline,
    hashtags: input.hashtags,
    mentions: input.mentions,
    callToAction: input.callToAction,
    firstComment: input.firstComment,
    linkUrl: input.linkUrl,
    scheduledFor: input.scheduledFor,
    // A person saving the version is a person putting their name to it: it is
    // no longer an unreviewed AI draft, whoever wrote the first words.
    aiDraftedAt: null,
  };

  return withAudit(
    {
      actor,
      action: id ? "UPDATE" : "CREATE",
      entityType: "SocialPost",
      entityId: id ?? item.id,
      before,
      after: { provider: input.provider, type: input.type, contentItemId: item.id },
    },
    async (tx) => {
      const post = id
        ? await tx.socialPost.update({ where: { id }, data, select: { id: true } })
        : await tx.socialPost.create({
            data: { ...data, order: await nextOrder(tx, item.id) },
            select: { id: true },
          });

      // Replaced wholesale: the editor sends the complete ordered list it is
      // showing, so removing a creative has to mean removing it.
      await tx.socialPostMedia.deleteMany({ where: { postId: post.id } });
      if (media.length > 0) {
        await tx.socialPostMedia.createMany({
          data: media.map((mediaId, order) => ({ postId: post.id, mediaId, order })),
        });
      }

      // Changing the copy after the client signed off un-signs it. Otherwise
      // "approved" would survive the approval being made untrue, and the item
      // could be scheduled and published carrying words nobody agreed to. The
      // approval row keeps its own history and its snapshot; what moves is the
      // item, back to the desk it came from.
      //
      // APPROVED and SCHEDULED both mean "the client signed this off". Only
      // checking APPROVED left a scheduled idea's copy freely editable right up
      // to the moment it went out.
      // A waiting internal round no longer describes the idea once its words
      // change; it is withdrawn rather than approved unseen.
      if (contentChanged) await supersedePendingReview(tx, item.id);

      // A version left SCHEDULED with no time would be promised and never sent.
      if (!input.scheduledFor && before?.status === "SCHEDULED") {
        await tx.socialPost.update({ where: { id: post.id }, data: { status: "DRAFT" } });
      }

      if (contentChanged && (item.stage === "APPROVED" || item.stage === "SCHEDULED")) {
        await tx.contentCalendarItem.update({
          where: { id: item.id },
          data: { stage: "INTERNAL_REVIEW" },
        });
        // Its versions are no longer cleared to go out either. Left SCHEDULED,
        // the publisher would refuse them at the last gate — but the calendar
        // and the queue would go on promising they were about to be posted.
        await tx.socialPost.updateMany({
          where: { contentItemId: item.id, status: "SCHEDULED" },
          data: { status: "DRAFT" },
        });
      }

      return tx.socialPost.findUniqueOrThrow({ where: { id: post.id }, select: postSelect });
    },
  );
}

/** Everything a reviewer or client signs off, compared field by field. Times are not in it. */
function sameContent(
  existing: {
    provider: SocialProvider;
    type: string;
    accountId: string | null;
    caption: string | null;
    headline: string | null;
    hashtags: string[];
    mentions: string[];
    callToAction: string | null;
    firstComment: string | null;
    linkUrl: string | null;
    media: { mediaId: string }[];
  },
  input: SocialPostInput,
): boolean {
  const text = (value: string | null | undefined) => (value ?? "").trim();
  const list = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  return (
    existing.provider === input.provider &&
    existing.type === input.type &&
    existing.accountId === input.accountId &&
    text(existing.caption) === text(input.caption) &&
    text(existing.headline) === text(input.headline) &&
    list(existing.hashtags, input.hashtags) &&
    list(existing.mentions, input.mentions) &&
    text(existing.callToAction) === text(input.callToAction) &&
    text(existing.firstComment) === text(input.firstComment) &&
    text(existing.linkUrl) === text(input.linkUrl) &&
    list(
      existing.media.map((m) => m.mediaId),
      input.mediaIds,
    )
  );
}

async function nextOrder(tx: Prisma.TransactionClient, contentItemId: string): Promise<number> {
  const last = await tx.socialPost.findFirst({
    where: { contentItemId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return (last?.order ?? -1) + 1;
}

/** Media must exist and be usable; a dangling id would fail at publication. */
async function resolveMedia(ids: readonly string[], provider: SocialProvider): Promise<string[]> {
  if (ids.length === 0) return [];

  const rows = await db.media.findMany({
    where: { id: { in: [...ids] }, deletedAt: null },
    select: { id: true, type: true, mimeType: true, filename: true },
  });
  const found = new Set(rows.map((row) => row.id));

  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ValidationError(`${missing.length} of those files no longer exist.`);
  }

  const unusable = rows.filter((row) => row.type === "DOCUMENT");
  if (unusable.length > 0) {
    throw new ValidationError("A social post can carry images and video, not documents.");
  }

  // Refused here, where the editor shows it, rather than at publication — a
  // PNG on an Instagram post used to save, pass approval, and fail at 7:30pm.
  const accepted = CAPABILITIES[provider].acceptedMediaTypes;
  if (accepted) {
    const wrong = rows.find((row) => !accepted.includes(row.mimeType));
    if (wrong) {
      throw new ValidationError(
        `${PROVIDER_LABEL[provider]} cannot publish ${wrong.filename} (${wrong.mimeType}). ${
          wrong.mimeType.startsWith("image/") ? "Export it as a JPEG and attach that instead." : ""
        }`.trim(),
      );
    }
  }

  // The caller's order is the carousel's order, so it is preserved exactly
  // rather than taking whatever order the query returned.
  return [...ids];
}

export async function deletePost(actor: Actor, id: string) {
  requirePermission(actor, "social.delete");

  const post = await db.socialPost.findUnique({
    where: { id },
    select: { id: true, clientId: true, contentItemId: true, status: true, provider: true, externalPostId: true },
  });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);

  if (post.status === "PUBLISHED") {
    throw new ConflictError(
      "A published post cannot be deleted here — it is the record of what went out. Cancel it instead.",
    );
  }
  if (post.status === "PUBLISHING") {
    throw new ConflictError("This post is being published right now.");
  }

  await withAudit(
    {
      actor,
      action: "DELETE",
      entityType: "SocialPost",
      entityId: id,
      before: { provider: post.provider, status: post.status },
    },
    async (tx) => {
      await tx.socialPost.delete({ where: { id }, select: { id: true } });
      // One version fewer is different content from what a waiting round shows.
      await supersedePendingReview(tx, post.contentItemId);
    },
  );
}

/**
 * Move a version's slot, keeping its approvals.
 *
 * The agency's rule: a reschedule is not new content, so neither the internal
 * nor the client approval is undone (the time is not part of the approval
 * fingerprint). What stays refused: a version that has gone out or is going
 * out, and a scheduled version moved into the past — the scheduler would send
 * it at once, which is a publish, not a reschedule. The move is audited with
 * both times.
 */
export async function reschedulePost(actor: Actor, id: string, scheduledFor: Date | null) {
  requirePermission(actor, "social.edit");

  const post = await db.socialPost.findUnique({
    where: { id },
    select: { id: true, clientId: true, status: true, scheduledFor: true },
  });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);

  if (LOCKED.includes(post.status)) {
    throw new ConflictError(post.status === "PUBLISHED" ? "This post has already gone out." : "This post is being published right now.");
  }
  if (post.status === "SCHEDULED" && scheduledFor && scheduledFor.getTime() < Date.now()) {
    throw new ValidationError("A scheduled post cannot be moved into the past.");
  }
  if (post.scheduledFor?.getTime() === scheduledFor?.getTime()) {
    return db.socialPost.findUniqueOrThrow({ where: { id }, select: postSelect });
  }

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "SocialPost",
      entityId: id,
      before: { scheduledFor: post.scheduledFor?.toISOString() ?? null },
      after: { scheduledFor: scheduledFor?.toISOString() ?? null, rescheduled: true },
    },
    (tx) =>
      tx.socialPost.update({
        where: { id },
        // Unscheduled by clearing the time: a SCHEDULED version with no slot
        // would be promised and never sent.
        data: { scheduledFor, ...(scheduledFor === null && post.status === "SCHEDULED" ? { status: "DRAFT" as const } : {}) },
        select: postSelect,
      }),
  );
}

/**
 * Move a post between the states this phase owns.
 *
 * `PUBLISHING` and `PUBLISHED` are not reachable from here: only the
 * publishing engine may set those, and only by claiming the row. Letting a
 * screen mark something published would make the archive a claim rather than a
 * record.
 */
const ALLOWED_TRANSITIONS: Record<SocialPostStatus, readonly SocialPostStatus[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["DRAFT", "CANCELLED"],
  PUBLISHING: [],
  PUBLISHED: [],
  FAILED: ["DRAFT", "SCHEDULED", "CANCELLED"],
  CANCELLED: ["DRAFT"],
};

export async function setPostStatus(actor: Actor, id: string, status: SocialPostStatus) {
  requirePermission(actor, "social.edit");

  const post = await db.socialPost.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      status: true,
      scheduledFor: true,
      accountId: true,
      contentItem: { select: { stage: true } },
    },
  });
  if (!post) throw new NotFoundError("That post does not exist.");
  await resolveClientScope(actor, post.clientId);

  if (!ALLOWED_TRANSITIONS[post.status].includes(status)) {
    throw new ConflictError(`A ${post.status.toLowerCase()} post cannot become ${status.toLowerCase()}.`);
  }

  if (status === "SCHEDULED") {
    // The rule the whole product turns on: nothing reaches a client's audience
    // without the client having approved it (brief §14).
    if (post.contentItem.stage !== "APPROVED" && post.contentItem.stage !== "SCHEDULED") {
      throw new ForbiddenError("This content has not been approved yet.");
    }
    if (!post.scheduledFor) throw new ValidationError("Set a date and time before scheduling.");
    if (!post.accountId) throw new ValidationError("Choose the account to post from.");
  }

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "SocialPost",
      entityId: id,
      before: { status: post.status },
      after: { status },
    },
    (tx) => tx.socialPost.update({ where: { id }, data: { status }, select: postSelect }),
  );
}
