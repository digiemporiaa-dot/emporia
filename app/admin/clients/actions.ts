"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as access from "@/lib/services/portal-access.service";
import * as messages from "@/lib/services/client-messages.service";
import { invitePortalUserSchema } from "@/lib/validation/portal";
import { z } from "zod";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("portal-access");

export type InviteActionState = ActionResult<{ inviteUrl: string; expiresAt: string }> | null;
export type ReplyActionState = ActionResult<{ id: string }> | null;

/**
 * Invite one of a client's people to the portal.
 *
 * The link is returned to the staff member rather than emailed: there is no
 * mail service until phase 12, and pretending an email went out would be a fake
 * (CLAUDE.md 2 rule 5).
 */
export async function invitePortalUserAction(
  _prev: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  try {
    const actor = await requireActor();
    const parsed = invitePortalUserSchema.safeParse({
      clientId: formData.get("clientId"),
      email: formData.get("email"),
      name: formData.get("name"),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const result = await access.invitePortalUser(actor, parsed.data);

    revalidatePath(`/admin/clients/${parsed.data.clientId}`);
    return {
      ok: true,
      data: { inviteUrl: result.inviteUrl, expiresAt: result.expiresAt.toISOString() },
    };
  } catch (error) {
    actionLog.warn({ err: error }, "portal invite refused");
    return toActionFailure(error);
  }
}

export async function revokePortalUserAction(
  userId: string,
  clientId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await access.revokePortalUser(actor, userId);
    revalidatePath(`/admin/clients/${clientId}`);
    return { ok: true, data: { id: userId } };
  } catch (error) {
    return toActionFailure(error);
  }
}

const replySchema = z.object({
  clientId: z.string().min(1).max(40),
  body: z.string().trim().min(1, "Write something first.").max(5000),
  projectId: z.string().trim().max(40).nullable().optional(),
});

export async function replyToClientAction(
  _prev: ReplyActionState,
  formData: FormData,
): Promise<ReplyActionState> {
  try {
    const actor = await requireActor();
    const parsed = replySchema.safeParse({
      clientId: formData.get("clientId"),
      body: formData.get("body"),
      projectId: formData.get("projectId") || null,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    const message = await messages.replyToClient(
      actor,
      parsed.data.clientId,
      parsed.data.body,
      parsed.data.projectId ?? null,
    );

    revalidatePath(`/admin/clients/${parsed.data.clientId}`);
    return { ok: true, data: { id: message.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}
