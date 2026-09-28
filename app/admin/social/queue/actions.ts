"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { publishNow } from "@/lib/services/social-publish.service";
import { setPostStatus } from "@/lib/services/social-post.service";
import { resolveStrandedPost, retryAllFailed } from "@/lib/services/social-queue.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Operating the queue.
 *
 * Every one of these validates and then hands off; none decides who may do
 * what. `social.publish` governs all of them, because each either puts
 * something on a platform or records that something already is.
 */

const actionLog = log("social");
const postRef = z.object({ postId: z.string().min(1).max(40) });

export async function retryPostAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = postRef.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That post could not be identified." };
    }

    const outcome = await publishNow(actor, parsed.data.postId);
    revalidatePath("/admin/social/queue");
    return { ok: true, data: { id: outcome.postId } };
  } catch (error) {
    actionLog.warn({ err: error }, "retrying a social post failed");
    return toActionFailure(error);
  }
}

export async function retryAllFailedAction(
  input: unknown,
): Promise<
  ActionResult<{ attempted: number; published: number; failed: number; notAttempted: number }>
> {
  try {
    const actor = await requireActor();
    const parsed = z
      .object({
        clientId: z.string().trim().max(40).nullable().default(null),
        // The platform filter on screen. Without it, "retry all" on a queue
        // filtered to LinkedIn retried every platform's failures.
        provider: z
          .enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X", "GOOGLE_BUSINESS_PROFILE"])
          .nullable()
          .default(null),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a filter we recognise." };
    }

    const run = await retryAllFailed(actor, {
      clientId: parsed.data.clientId,
      provider: parsed.data.provider,
    });
    revalidatePath("/admin/social/queue");
    return {
      ok: true,
      data: {
        attempted: run.attempted,
        published: run.published,
        failed: run.failed.length,
        notAttempted: run.notAttempted,
      },
    };
  } catch (error) {
    actionLog.warn({ err: error }, "bulk retry failed");
    return toActionFailure(error);
  }
}

export async function resolveStrandedAction(
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    const actor = await requireActor();
    const parsed = postRef
      .extend({
        outcome: z.enum(["published", "not-published"]),
        externalUrl: z
          .string()
          .trim()
          .max(2000)
          .transform((value) => (value === "" ? null : value))
          .nullable()
          .default(null),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That decision could not be read." };
    }

    const result = await resolveStrandedPost(
      actor,
      parsed.data.postId,
      parsed.data.outcome === "published"
        ? { outcome: "published", externalUrl: parsed.data.externalUrl }
        : { outcome: "not-published" },
    );
    revalidatePath("/admin/social/queue");
    return { ok: true, data: result };
  } catch (error) {
    actionLog.warn({ err: error }, "resolving a stranded post failed");
    return toActionFailure(error);
  }
}

export async function unscheduleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = postRef.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That post could not be identified." };
    }

    const post = await setPostStatus(actor, parsed.data.postId, "DRAFT");
    revalidatePath("/admin/social/queue");
    return { ok: true, data: { id: post.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "unscheduling from the queue failed");
    return toActionFailure(error);
  }
}
