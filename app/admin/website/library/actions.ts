"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { bulkSetState, type BulkOutcome } from "@/lib/services/cms-bulk.service";
import { bulkRequestSchema } from "@/lib/validation/cms";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("cms-library");

export async function bulkAction(input: unknown): Promise<ActionResult<BulkOutcome>> {
  try {
    const actor = await requireActor();
    const parsed = bulkRequestSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the selection.",
      };
    }

    const outcome = await bulkSetState(actor, parsed.data.targets, parsed.data.action);

    revalidatePath("/admin/website/library");
    // A partial failure is still a result, not an error: the caller shows which
    // rows refused and why. Returning `ok: false` would throw away the ones
    // that worked.
    return { ok: true, data: outcome };
  } catch (error) {
    actionLog.warn({ err: error }, "bulk action refused");
    return toActionFailure(error);
  }
}
