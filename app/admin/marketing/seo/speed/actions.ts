"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { toActionFailure } from "@/lib/errors";
import { localPropertySchema } from "@/lib/validation/seo-intel";
import { checkCwvNow } from "@/lib/services/seo-intel/cwv.service";
import type { SeoActionState } from "../actions";

/** Core Web Vitals "Check now" (Phase 11). The service re-checks permission, scope and the hourly limit. */
export async function checkCwvNowAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localPropertySchema.safeParse({ propertyId: formData.get("propertyId") });
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Choose a website." };
    const outcome = await checkCwvNow(actor, parsed.data.propertyId);
    revalidatePath("/admin/marketing/seo/speed");
    const origin = outcome.origin ? "Site-wide figures updated" : "Google has too little Chrome traffic for site-wide figures";
    return { ok: true, data: { message: `${origin}; ${outcome.pagesWithData} of ${outcome.pages} top pages have their own.` } };
  } catch (error) {
    return toActionFailure(error);
  }
}
