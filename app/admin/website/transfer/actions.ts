"use server";

import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { commitImport, planImport } from "@/lib/services/transfer.service";
import { TRANSFER_TYPES } from "@/lib/transfer/columns";
import type { ImportOutcome, ImportPlan } from "@/lib/transfer/types";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Preview and apply a CSV import.
 *
 * Two actions, and the second does not take the first's answer. `commitImport`
 * re-reads the file and re-plans it server-side: a preview the server trusted
 * would be a write path with its validation moved to the browser.
 */

const actionLog = log("transfer");

const importSchema = z.object({
  type: z.enum(TRANSFER_TYPES),
  // Bounded here as well as in the service: the action is reachable without
  // the screen, and a megabyte cap belongs on both sides of that boundary.
  csv: z.string().min(1, "Choose a file first.").max(2_200_000, "That file is too big."),
});

export async function planImportAction(input: unknown): Promise<ActionResult<ImportPlan>> {
  try {
    const actor = await requireActor();
    const parsed = importSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the file.",
      };
    }

    return { ok: true, data: await planImport(actor, parsed.data.type, parsed.data.csv) };
  } catch (error) {
    actionLog.warn({ err: error }, "import preview refused");
    return toActionFailure(error);
  }
}

export async function commitImportAction(input: unknown): Promise<ActionResult<ImportOutcome>> {
  try {
    const actor = await requireActor();
    const parsed = importSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the file.",
      };
    }

    return { ok: true, data: await commitImport(actor, parsed.data.type, parsed.data.csv) };
  } catch (error) {
    actionLog.error({ err: error }, "import failed");
    return toActionFailure(error);
  }
}
