"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as experiments from "@/lib/services/experiment.service";
import { experimentSchema } from "@/lib/validation/experiment";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("experiments");

export type ExperimentActionState = ActionResult<{ id: string }> | null;

function refresh() {
  revalidatePath("/admin/website/experiments");
}

export async function createExperimentAction(
  _prev: ExperimentActionState,
  formData: FormData,
): Promise<ExperimentActionState> {
  try {
    const actor = await requireActor();
    const parsed = experimentSchema.safeParse({
      key: formData.get("key"),
      name: formData.get("name"),
      hypothesis: formData.get("hypothesis") ?? "",
      variants: [
        {
          key: "control",
          name: formData.get("controlName") || "Control",
          weight: formData.get("controlWeight") || 1,
        },
        {
          key: "variant",
          name: formData.get("variantName") || "Variant",
          weight: formData.get("variantWeight") || 1,
        },
      ],
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const created = await experiments.createExperiment(actor, parsed.data);
    refresh();
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "create experiment refused");
    return toActionFailure(error);
  }
}

export async function setExperimentStatusAction(
  id: string,
  status: "DRAFT" | "RUNNING" | "STOPPED",
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await experiments.setExperimentStatus(actor, id, status);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteExperimentAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await experiments.deleteExperiment(actor, id);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}
