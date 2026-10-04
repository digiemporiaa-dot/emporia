"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { setAccessEmail, setStepNotApplicable } from "@/lib/services/onboarding.service";
import { accessEmailSchema, notApplicableSchema } from "@/lib/validation/onboarding";

/** Staff actions on a client's onboarding. Permissions are checked in the service. */

export type StaffOnboardingState = ActionResult<{ message: string }> | null;

export async function toggleNotApplicableAction(_prev: StaffOnboardingState, formData: FormData): Promise<StaffOnboardingState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());
    const parsed = notApplicableSchema.safeParse({ ...raw, notApplicable: raw["notApplicable"] === "true" });
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That step cannot be changed." };
    const progress = await setStepNotApplicable(actor, parsed.data);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/onboarding`);
    revalidatePath(`/admin/clients/${parsed.data.clientId}`);
    return { ok: true, data: { message: `Saved. Setup is ${progress.percent}% complete.` } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveAccessEmailAction(_prev: StaffOnboardingState, formData: FormData): Promise<StaffOnboardingState> {
  try {
    const actor = await requireActor();
    const parsed = accessEmailSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the address." };
    await setAccessEmail(actor, parsed.data.email);
    revalidatePath("/admin/clients");
    return { ok: true, data: { message: "Saved. Clients see this address in their setup." } };
  } catch (error) {
    return toActionFailure(error);
  }
}
