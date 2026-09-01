"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { popupSchema } from "@/lib/validation/popup";
import * as popupService from "@/lib/services/popup.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("marketing");

export type PopupActionState = ActionResult<{ id: string }> | null;

/** Targeting rules arrive as JSON from the client editor. */
function parseTargets(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function savePopupAction(
  _prev: PopupActionState,
  formData: FormData,
): Promise<PopupActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = popupSchema.safeParse({
      ...raw,
      body: emptyToNull(formData.get("body")),
      ctaLabel: emptyToNull(formData.get("ctaLabel")),
      ctaHref: emptyToNull(formData.get("ctaHref")),
      triggerValue: raw["triggerValue"] === "" ? null : raw["triggerValue"],
      startsAt: raw["startsAt"] === "" ? null : raw["startsAt"],
      endsAt: raw["endsAt"] === "" ? null : raw["endsAt"],
      isActive: raw["isActive"] === "on" || raw["isActive"] === "true",
      targets: parseTargets(formData.get("targets")),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const popup = id
      ? await popupService.updatePopup(actor, id, parsed.data)
      : await popupService.createPopup(actor, parsed.data);

    revalidatePath("/admin/marketing/popups");
    return { ok: true, data: { id: popup.id } };
  } catch (error) {
    actionLog.error({ err: error }, "savePopup failed");
    return toActionFailure(error);
  }
}
