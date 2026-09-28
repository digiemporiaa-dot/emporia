"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { createSocialContent } from "@/lib/services/social-content.service";
import { deletePost, savePost, setPostStatus } from "@/lib/services/social-post.service";
import {
  requestSocialApproval,
  withdrawSocialApproval,
} from "@/lib/services/social-approval.service";
import { publishNow } from "@/lib/services/social-publish.service";
import { draftSocialPost } from "@/lib/services/ai.service";
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
  ActionResult<{ caption: string; headline: string | null; hashtags: string[]; model: string }>
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
    });

    // Returned to the browser, never written. The editor puts it in the form
    // and a person still has to save.
    return {
      ok: true,
      data: {
        caption: draft.data.caption,
        headline: draft.data.headline,
        hashtags: draft.data.hashtags,
        model: draft.model,
      },
    };
  } catch (error) {
    actionLog.warn({ err: error }, "drafting a social caption failed");
    return toActionFailure(error);
  }
}
