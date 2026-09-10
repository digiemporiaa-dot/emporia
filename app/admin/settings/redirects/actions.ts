"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import {
  createRedirect,
  deleteRedirect,
  updateRedirect,
} from "@/lib/services/redirect.service";
import { redirectSchema } from "@/lib/validation/redirect";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("redirects");

export type RedirectActionState = ActionResult<{ id: string }> | null;

function refresh() {
  revalidatePath("/admin/settings/redirects");
}

/** Read the form, remembering that an unchecked box is absent, not false. */
function parse(formData: FormData) {
  return redirectSchema.safeParse({
    fromPath: formData.get("fromPath"),
    toPath: formData.get("toPath"),
    permanent: formData.get("permanent") === "on",
    isActive: formData.get("isActive") === "on",
  });
}

export async function saveRedirectAction(
  _prev: RedirectActionState,
  formData: FormData,
): Promise<RedirectActionState> {
  try {
    const actor = await requireActor();
    const parsed = parse(formData);

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const input = {
      fromPath: parsed.data.fromPath,
      toPath: parsed.data.toPath,
      // Stored as 301/302 — the intent an admin chose. What is actually served
      // is 308/307, which the service documents and the screen states.
      type: parsed.data.permanent ? ("PERMANENT_301" as const) : ("FOUND_302" as const),
      isActive: parsed.data.isActive,
    };

    const id = formData.get("id");
    const saved =
      typeof id === "string" && id
        ? await updateRedirect(actor, id, input)
        : await createRedirect(actor, input);

    refresh();
    return { ok: true, data: { id: saved.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "save redirect refused");
    return toActionFailure(error);
  }
}

export async function deleteRedirectAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await deleteRedirect(actor, id);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}
