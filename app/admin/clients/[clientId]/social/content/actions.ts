"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { createSocialContent, setContentPillar } from "@/lib/services/social-content.service";
import { deletePost, savePost, setPostStatus } from "@/lib/services/social-post.service";
import {
  requestSocialApproval,
  withdrawSocialApproval,
} from "@/lib/services/social-approval.service";
import { publishNow } from "@/lib/services/social-publish.service";
import {
  assistSocialCopy,
  draftSocialPost,
  generateContentIdeas,
  repurposeContent,
  type ContentIdeaDraft,
  type RepurposeDraft,
  type SocialAssistDraft,
} from "@/lib/services/ai.service";
import { createRepurposedContent } from "@/lib/services/social-repurpose.service";
import {
  decideInternalReview,
  submitForInternalReview,
  withdrawInternalReview,
} from "@/lib/services/social-review.service";
import { BULK_MAX, runBulkAction, type BulkResult } from "@/lib/services/social-bulk.service";
import { isoDay } from "@/lib/validation/social-occasion";
import { socialPostSchema } from "@/lib/validation/social";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Writing social content.
 *
 * Every one of these validates, then hands off to a service that performs the
 * permission check and the client scoping. None of them decides who may do
 * what — that lives one layer down, where it is testable without a form.
 */

const actionLog = log("social");

const blank = (value: FormDataEntryValue | null): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
};

const createSchema = z.object({
  clientId: z.string().min(1).max(40),
  projectId: z.string().min(1, "Choose a project."),
  title: z.string().trim().min(2, "Give the idea a title.").max(200),
  brief: z.string().trim().max(5000).nullable().default(null),
  campaignId: z.string().trim().max(40).nullable().default(null),
  pillarId: z.string().trim().max(40).nullable().default(null),
  ownerId: z.string().trim().max(40).nullable().default(null),
  scheduledFor: z.coerce.date().nullable().default(null),
});

export async function createContentAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = createSchema.safeParse({
      clientId: formData.get("clientId"),
      projectId: formData.get("projectId"),
      title: formData.get("title"),
      brief: blank(formData.get("brief")),
      campaignId: blank(formData.get("campaignId")),
      pillarId: blank(formData.get("pillarId")),
      ownerId: blank(formData.get("ownerId")),
      scheduledFor: blank(formData.get("scheduledFor")),
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check those details.",
      };
    }

    const item = await createSocialContent(actor, parsed.data);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    return { ok: true, data: item };
  } catch (error) {
    actionLog.error({ err: error }, "creating social content failed");
    return toActionFailure(error);
  }
}

const savePostInput = z.object({
  clientId: z.string().min(1).max(40),
  postId: z.string().trim().max(40).nullable().default(null),
  post: z.unknown(),
});

export async function savePostAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const outer = savePostInput.safeParse(input);
    if (!outer.success) {
      return { ok: false, code: "VALIDATION", message: "That post could not be identified." };
    }

    // The post itself is validated against its provider's capabilities — a
    // caption too long for X, a carousel on a platform without one, a link
    // field a platform does not have.
    const parsed = socialPostSchema.safeParse(outer.data.post);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        code: "VALIDATION",
        message: issue?.message ?? "Check the post.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const post = await savePost(actor, outer.data.postId, parsed.data);
    revalidatePath(`/admin/clients/${outer.data.clientId}/social/content`);
    return { ok: true, data: { id: post.id } };
  } catch (error) {
    actionLog.error({ err: error }, "saving a social post failed");
    return toActionFailure(error);
  }
}

const postRef = z.object({
  clientId: z.string().min(1).max(40),
  postId: z.string().min(1).max(40),
});

export async function deletePostAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = postRef.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That post could not be identified." };
    }

    await deletePost(actor, parsed.data.postId);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    return { ok: true, data: { id: parsed.data.postId } };
  } catch (error) {
    actionLog.error({ err: error }, "deleting a social post failed");
    return toActionFailure(error);
  }
}

export async function setPostStatusAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = postRef
      .extend({ status: z.enum(["DRAFT", "SCHEDULED", "CANCELLED"]) })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a state a post can be put in." };
    }

    const post = await setPostStatus(actor, parsed.data.postId, parsed.data.status);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    return { ok: true, data: { id: post.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "changing a social post status was refused");
    return toActionFailure(error);
  }
}

const approvalRef = z.object({
  clientId: z.string().min(1).max(40),
  itemId: z.string().min(1).max(40),
});

export async function requestApprovalAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = approvalRef
      .extend({ note: z.string().trim().max(2000).nullable().default(null) })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That content could not be identified." };
    }

    const result = await requestSocialApproval(actor, {
      contentItemId: parsed.data.itemId,
      note: parsed.data.note,
    });
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content/${parsed.data.itemId}`);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/calendar`);
    return { ok: true, data: { id: result.approvalId } };
  } catch (error) {
    actionLog.warn({ err: error }, "sending social content for client approval was refused");
    return toActionFailure(error);
  }
}

export async function withdrawApprovalAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = approvalRef.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That content could not be identified." };
    }

    const item = await withdrawSocialApproval(actor, parsed.data.itemId);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content/${parsed.data.itemId}`);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/calendar`);
    return { ok: true, data: { id: item.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "withdrawing social content from client review was refused");
    return toActionFailure(error);
  }
}

export async function publishNowAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = postRef.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That post could not be identified." };
    }

    const outcome = await publishNow(actor, parsed.data.postId);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/calendar`);
    return { ok: true, data: { id: outcome.postId } };
  } catch (error) {
    // Warn, not error: a platform refusing a post is an ordinary outcome that
    // the screen shows the operator, not a fault in this application.
    actionLog.warn({ err: error }, "publishing a social post failed");
    return toActionFailure(error);
  }
}

export async function draftCaptionAction(input: unknown): Promise<
  ActionResult<{
    caption: string;
    headline: string | null;
    hashtags: string[];
    forbiddenUsed: string[];
    model: string;
  }>
> {
  try {
    const actor = await requireActor();
    const parsed = z
      .object({
        itemId: z.string().min(1).max(40),
        provider: z.enum([
          "INSTAGRAM",
          "FACEBOOK",
          "LINKEDIN",
          "YOUTUBE",
          "X",
          "GOOGLE_BUSINESS_PROFILE",
        ]),
        type: z.string().min(1).max(40),
        instruction: z
          .string()
          .trim()
          .max(500)
          .transform((value) => (value === "" ? null : value))
          .nullable()
          .default(null),
        fromPostId: z.string().trim().max(40).nullable().default(null),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That draft request could not be read." };
    }

    const draft = await draftSocialPost(actor, {
      contentItemId: parsed.data.itemId,
      provider: parsed.data.provider,
      type: parsed.data.type,
      instruction: parsed.data.instruction,
      fromPostId: parsed.data.fromPostId || null,
    });

    // Returned to the browser, never written. The editor puts it in the form
    // and a person still has to save.
    return {
      ok: true,
      data: {
        caption: draft.data.caption,
        headline: draft.data.headline,
        hashtags: draft.data.hashtags,
        forbiddenUsed: draft.data.forbiddenUsed,
        model: draft.model,
      },
    };
  } catch (error) {
    actionLog.warn({ err: error }, "drafting a social caption failed");
    return toActionFailure(error);
  }
}

const pillarRef = z.object({
  clientId: z.string().min(1).max(40),
  itemId: z.string().min(1).max(40),
  pillarId: z.string().trim().max(40).nullable(),
});

export async function setContentPillarAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = pillarRef.safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That pillar could not be set." };

    const item = await setContentPillar(actor, parsed.data.itemId, parsed.data.pillarId || null);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    return { ok: true, data: { id: item.id } };
  } catch (error) {
    actionLog.error({ err: error }, "setting a content pillar failed");
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// AI assists. Each returns a draft to the browser; only the two "create"
// actions write, and they write drafts a person still has to review.
// ---------------------------------------------------------------------------

const PROVIDER_ENUM = z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X", "GOOGLE_BUSINESS_PROFILE"]);
const optionalSteer = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

export async function assistCopyAction(
  input: unknown,
): Promise<ActionResult<SocialAssistDraft & { model: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z
      .object({
        itemId: z.string().min(1).max(40),
        provider: PROVIDER_ENUM,
        mode: z.enum(["improve", "hashtags", "cta"]),
        text: z.string().max(10_000).default(""),
        instruction: optionalSteer,
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That request could not be read." };

    const draft = await assistSocialCopy(actor, {
      contentItemId: parsed.data.itemId,
      provider: parsed.data.provider,
      mode: parsed.data.mode,
      text: parsed.data.text,
      instruction: parsed.data.instruction,
    });
    return { ok: true, data: { ...draft.data, model: draft.model } };
  } catch (error) {
    actionLog.warn({ err: error }, "social copy assist failed");
    return toActionFailure(error);
  }
}

const repurposeSchema = z.object({
  clientId: z.string().min(1).max(40),
  pillarId: z.string().trim().max(40).nullable().default(null),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("blog"), blogPostId: z.string().min(1).max(40) }),
    z.object({
      kind: z.literal("text"),
      title: z.string().trim().min(2, "Give the article its title.").max(300),
      text: z.string().trim().min(1, "Paste the article.").max(40_000),
      url: z
        .string()
        .trim()
        .url("The article's link must be a full URL.")
        .max(2_000)
        .nullable()
        .or(z.literal("").transform(() => null))
        .default(null),
    }),
  ]),
  targets: z
    .array(z.object({ provider: PROVIDER_ENUM, type: z.string().min(1).max(40) }))
    .min(1, "Choose at least one platform.")
    .max(6),
  carousel: z.boolean().default(false),
  videoScript: z.boolean().default(false),
  instruction: optionalSteer,
});

export async function repurposeAction(
  input: unknown,
): Promise<ActionResult<RepurposeDraft & { model: string }>> {
  try {
    const actor = await requireActor();
    const parsed = repurposeSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check those details." };
    }
    const draft = await repurposeContent(actor, parsed.data);
    return { ok: true, data: { ...draft.data, model: draft.model } };
  } catch (error) {
    actionLog.warn({ err: error }, "repurposing content failed");
    return toActionFailure(error);
  }
}

const createRepurposedSchema = z.object({
  clientId: z.string().min(1).max(40),
  projectId: z.string().min(1, "Choose a project.").max(40),
  campaignId: z.string().trim().max(40).nullable().default(null),
  pillarId: z.string().trim().max(40).nullable().default(null),
  title: z.string().trim().min(2).max(200),
  brief: z.string().trim().max(5_000).nullable().default(null),
  sourceBlogPostId: z.string().trim().max(40).nullable().default(null),
  versions: z
    .array(
      z.object({
        provider: PROVIDER_ENUM,
        type: z.string().min(1).max(40),
        caption: z.string().max(10_000),
        headline: z.string().max(300).nullable(),
        hashtags: z.array(z.string().max(100)).max(30),
        linkUrl: z.string().max(2_000).nullable(),
      }),
    )
    .min(1)
    .max(6),
});

export async function createRepurposedAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = createRepurposedSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check those details." };
    }
    const item = await createRepurposedContent(actor, {
      ...parsed.data,
      campaignId: parsed.data.campaignId || null,
      pillarId: parsed.data.pillarId || null,
      sourceBlogPostId: parsed.data.sourceBlogPostId || null,
    });
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    return { ok: true, data: item };
  } catch (error) {
    actionLog.error({ err: error }, "creating repurposed content failed");
    return toActionFailure(error);
  }
}

export async function ideasAction(input: unknown): Promise<ActionResult<ContentIdeaDraft & { model: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z
      .object({
        clientId: z.string().min(1).max(40),
        campaignId: z.string().trim().max(40).nullable().default(null),
        pillarId: z.string().trim().max(40).nullable().default(null),
        count: z.coerce.number().int().min(3).max(10).default(5),
        instruction: optionalSteer,
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That request could not be read." };
    const draft = await generateContentIdeas(actor, {
      ...parsed.data,
      campaignId: parsed.data.campaignId || null,
      pillarId: parsed.data.pillarId || null,
    });
    return { ok: true, data: { ...draft.data, model: draft.model } };
  } catch (error) {
    actionLog.warn({ err: error }, "suggesting content ideas failed");
    return toActionFailure(error);
  }
}

/** Keep one suggested idea: it becomes an ordinary draft idea, nothing more. */
export async function addIdeaAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z
      .object({
        clientId: z.string().min(1).max(40),
        projectId: z.string().min(1, "Choose a project.").max(40),
        campaignId: z.string().trim().max(40).nullable().default(null),
        pillarId: z.string().trim().max(40).nullable().default(null),
        title: z.string().trim().min(2).max(200),
        brief: z.string().trim().max(5_000).nullable().default(null),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check those details." };
    }
    const item = await createSocialContent(actor, {
      ...parsed.data,
      campaignId: parsed.data.campaignId || null,
      pillarId: parsed.data.pillarId || null,
      ownerId: null,
      scheduledFor: null,
    });
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    return { ok: true, data: item };
  } catch (error) {
    actionLog.error({ err: error }, "adding a suggested idea failed");
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Internal review
// ---------------------------------------------------------------------------

function refreshItem(clientId: string, itemId: string) {
  revalidatePath(`/admin/clients/${clientId}/social/content/${itemId}`);
  revalidatePath(`/admin/clients/${clientId}/social/content`);
  revalidatePath(`/admin/clients/${clientId}/social/calendar`);
}

export async function submitReviewAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = approvalRef
      .extend({ note: z.string().trim().max(2000).nullable().default(null) })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That content could not be identified." };
    const review = await submitForInternalReview(actor, { contentItemId: parsed.data.itemId, note: parsed.data.note });
    refreshItem(parsed.data.clientId, parsed.data.itemId);
    return { ok: true, data: { id: review.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "submitting social content for internal review was refused");
    return toActionFailure(error);
  }
}

export async function decideReviewAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = approvalRef
      .extend({
        decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
        feedback: z.string().trim().max(5000).nullable().default(null),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That decision could not be read." };
    const result = await decideInternalReview(actor, {
      contentItemId: parsed.data.itemId,
      decision: parsed.data.decision,
      feedback: parsed.data.feedback || null,
    });
    refreshItem(parsed.data.clientId, parsed.data.itemId);
    return { ok: true, data: { id: result.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "an internal review decision was refused");
    return toActionFailure(error);
  }
}

export async function withdrawReviewAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = approvalRef.safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That content could not be identified." };
    const result = await withdrawInternalReview(actor, parsed.data.itemId);
    refreshItem(parsed.data.clientId, parsed.data.itemId);
    return { ok: true, data: { id: result.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "withdrawing an internal review was refused");
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);

const bulkSchema = z.object({
  clientId: z.string().min(1).max(40),
  itemIds: z.array(z.string().min(1).max(40)).min(1, "Select at least one idea.").max(BULK_MAX),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("approve"), feedback: optionalText(2000) }),
    z.object({ kind: z.literal("requestClientReview"), note: optionalText(2000) }),
    z.object({ kind: z.literal("schedule") }),
    z.object({ kind: z.literal("reschedule"), shiftDays: z.coerce.number().int().min(-90).max(90).refine((n) => n !== 0, "Move by at least a day.") }),
    z.object({ kind: z.literal("rescheduleTo"), toDay: isoDay }),
    z.object({ kind: z.literal("assign"), ownerId: z.string().max(40).nullable().transform((v) => v || null) }),
    z.object({ kind: z.literal("deleteDrafts") }),
  ]),
});

export async function bulkAction(input: unknown): Promise<ActionResult<{ results: BulkResult[] }>> {
  try {
    const actor = await requireActor();
    const parsed = bulkSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "That request could not be read." };
    }
    const { clientId, itemIds, action } = parsed.data;
    const results = await runBulkAction(actor, {
      clientId,
      itemIds,
      action: action.kind === "rescheduleTo" ? { kind: "reschedule", toDay: action.toDay } : action,
    });
    revalidatePath(`/admin/clients/${clientId}/social/content`);
    revalidatePath(`/admin/clients/${clientId}/social/calendar`);
    return { ok: true, data: { results } };
  } catch (error) {
    actionLog.warn({ err: error }, "a bulk social action was refused");
    return toActionFailure(error);
  }
}
