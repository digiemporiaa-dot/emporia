"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as templates from "@/lib/services/template.service";
import { templateSchema } from "@/lib/validation/template";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("templates");

export type TemplateActionState = ActionResult<{ id: string }> | null;

function refresh() {
  revalidatePath("/admin/website/templates");
}

/**
 * Read the form.
 *
 * Sections and allowed blocks arrive as repeated fields rather than JSON, so
 * the form works before hydration: a list React writes after mount is a list
 * that is empty if the form is submitted early.
 */
function parse(formData: FormData) {
  return templateSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    sections: formData.getAll("section").map((type) => ({ type })),
    allowedBlocks: formData.getAll("allowedBlock"),
    defaultSchemaType: formData.get("defaultSchemaType") || "NONE",
    defaultRobotsIndex: formData.get("defaultRobotsIndex") === "on",
    isActive: formData.get("isActive") === "on",
    order: formData.get("order") || 0,
  });
}

export async function saveTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
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

    const id = formData.get("id");
    const saved =
      typeof id === "string" && id
        ? await templates.updateTemplate(actor, id, parsed.data)
        : await templates.createTemplate(actor, parsed.data);

    refresh();
    return { ok: true, data: { id: saved.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "save template refused");
    return toActionFailure(error);
  }
}

export async function deleteTemplateAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await templates.deleteTemplate(actor, id);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}
