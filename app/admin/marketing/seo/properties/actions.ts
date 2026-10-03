"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as properties from "@/lib/services/seo-intel/property.service";
import { seoPropertyCreateSchema, seoPropertyUpdateSchema } from "@/lib/validation/seo-intel";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("seo-intel");

export type PropertyActionState = ActionResult<{ id: string }> | null;

/** FormData → the shape the schemas take. A checkbox is present only when ticked. */
function fromForm(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.fromEntries(formData.entries());
  return { ...raw, isActive: raw["isActive"] === "on" };
}

function invalid(issues: { message: string }[], fieldErrors: unknown): PropertyActionState {
  return { ok: false, code: "VALIDATION", message: issues[0]?.message ?? "Check the form.", details: fieldErrors };
}

export async function savePropertyAction(
  _prev: PropertyActionState,
  formData: FormData,
): Promise<PropertyActionState> {
  try {
    const actor = await requireActor();
    const raw = fromForm(formData);
    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;

    let property;
    if (id) {
      const parsed = seoPropertyUpdateSchema.safeParse(raw);
      if (!parsed.success) return invalid(parsed.error.issues, parsed.error.flatten().fieldErrors);
      property = await properties.updateProperty(actor, id, parsed.data);
    } else {
      const parsed = seoPropertyCreateSchema.safeParse(raw);
      if (!parsed.success) return invalid(parsed.error.issues, parsed.error.flatten().fieldErrors);
      property = await properties.createProperty(actor, parsed.data);
    }

    revalidatePath("/admin/marketing");
    revalidatePath("/admin/marketing/seo");
    revalidatePath("/admin/marketing/seo/properties");
    revalidatePath("/admin/clients");
    return { ok: true, data: { id: property.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveProperty refused");
    return toActionFailure(error);
  }
}
