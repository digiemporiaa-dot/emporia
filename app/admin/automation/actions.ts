"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as automations from "@/lib/services/automation.service";
import { previewAutomation } from "@/lib/automation/engine";
import { automationSchema } from "@/lib/validation/automation";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("automation");

export type AutomationActionState = ActionResult<{ id: string }> | null;

function refresh(id?: string) {
  revalidatePath("/admin/automation");
  if (id) revalidatePath(`/admin/automation/${id}`);
}

/**
 * The whole rule travels as one JSON payload.
 *
 * Conditions and actions are ordered lists of heterogeneous shapes; flattening
 * them into form fields would mean re-deriving the order and the discriminant
 * on the server, which is exactly where a mismatch would hide.
 */
export async function saveAutomationAction(
  _prev: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  try {
    const actor = await requireActor();

    const raw = formData.get("rule");
    if (typeof raw !== "string") {
      return { ok: false, code: "VALIDATION", message: "Nothing to save." };
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ok: false, code: "VALIDATION", message: "That rule could not be read." };
    }

    const parsed = automationSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        code: "VALIDATION",
        message: issue
          ? `${issue.path.join(".") || "rule"}: ${issue.message}`
          : "Check the rule.",
      };
    }

    const id = formData.get("id");
    const automation =
      typeof id === "string" && id
        ? await automations.updateAutomation(actor, id, parsed.data)
        : await automations.createAutomation(actor, parsed.data);

    refresh(automation.id);
    return { ok: true, data: { id: automation.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveAutomation refused");
    return toActionFailure(error);
  }
}

export async function setAutomationActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await automations.setAutomationActive(actor, id, isActive);
    refresh(id);
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteAutomationAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await automations.deleteAutomation(actor, id);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Try a rule against a real record. Reports what would happen; runs nothing.
 */
export async function previewAutomationAction(
  id: string,
  subjectId: string,
): Promise<ActionResult<{ matched: boolean; actions: string[]; facts: [string, string][] }>> {
  try {
    const actor = await requireActor();
    // Reading a rule is the permission being exercised; the preview itself
    // writes nothing.
    await automations.getAutomation(actor, id);

    const trimmed = subjectId.trim();
    if (!trimmed) {
      return { ok: false, code: "VALIDATION", message: "Paste the id of a record to try it on." };
    }

    const result = await previewAutomation(id, { leadId: trimmed });
    if (!result) {
      return { ok: false, code: "NOT_FOUND", message: "That rule has no trigger yet." };
    }

    return {
      ok: true,
      data: {
        matched: result.matched,
        actions: result.actions,
        facts: Object.entries(result.facts)
          .filter(([, value]) => value !== null && value !== undefined)
          .map(([key, value]) => [key, String(value)] as [string, string]),
      },
    };
  } catch (error) {
    return toActionFailure(error);
  }
}
