"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { requirePortalActor } from "@/lib/auth/rbac";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import * as portal from "@/lib/services/portal.service";
import {
  portalApprovalDecisionSchema,
  portalMessageSchema,
  portalPasswordSchema,
  portalProfileSchema,
} from "@/lib/validation/portal";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("portal");

export type PortalActionState = ActionResult<{ id: string }> | null;

/**
 * Portal server actions.
 *
 * Each one re-derives the actor from the session and narrows it with
 * `requirePortalActor`, so nothing here can be driven by a client id, a user id
 * or an account type supplied in the form (CLAUDE.md 2 rules 2 and 3).
 */
async function actor() {
  return requirePortalActor(await currentActor());
}

export async function decideApprovalAction(
  _prev: PortalActionState,
  formData: FormData,
): Promise<PortalActionState> {
  try {
    const me = await actor();
    const parsed = portalApprovalDecisionSchema.safeParse({
      approvalId: formData.get("approvalId"),
      decision: formData.get("decision"),
      feedback: formData.get("feedback") || null,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    await portal.decideApproval(
      me,
      parsed.data.approvalId,
      parsed.data.decision,
      parsed.data.feedback ?? null,
    );

    revalidatePath("/portal");
    revalidatePath("/portal/approvals");
    revalidatePath(`/portal/approvals/${parsed.data.approvalId}`);
    return { ok: true, data: { id: parsed.data.approvalId } };
  } catch (error) {
    actionLog.warn({ err: error }, "portal approval decision refused");
    return toActionFailure(error);
  }
}

export async function sendMessageAction(
  _prev: PortalActionState,
  formData: FormData,
): Promise<PortalActionState> {
  try {
    const me = await actor();
    const parsed = portalMessageSchema.safeParse({
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

    const message = await portal.sendMessage(me, parsed.data);

    revalidatePath("/portal/messages");
    return { ok: true, data: { id: message.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateProfileAction(
  _prev: PortalActionState,
  formData: FormData,
): Promise<PortalActionState> {
  try {
    const me = await actor();
    const parsed = portalProfileSchema.safeParse({
      name: formData.get("name"),
      phone: formData.get("phone") || null,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const updated = await portal.updateProfile(me, parsed.data);

    revalidatePath("/portal/profile");
    return { ok: true, data: { id: updated.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function changePasswordAction(
  _prev: PortalActionState,
  formData: FormData,
): Promise<PortalActionState> {
  try {
    const me = await actor();

    // A change-password endpoint that takes the current password is an online
    // guessing oracle, so it is rate limited like the login itself
    // (CLAUDE.md 11).
    const limit = checkRateLimit(`portal:password:${me.userId}`, {
      limit: 5,
      windowMs: 15 * 60_000,
    });
    if (!limit.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many attempts. Try again in a few minutes.",
      };
    }

    const parsed = portalPasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const result = await portal.changePassword(
      me,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    return { ok: true, data: { id: result.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "portal password change refused");
    return toActionFailure(error);
  }
}

/** Sign out from the portal, landing on the login page rather than admin. */
export async function portalSignOutAction(): Promise<void> {
  const { signOut } = await import("@/lib/auth");
  await signOut({ redirect: false });
  redirect("/auth/login");
}
