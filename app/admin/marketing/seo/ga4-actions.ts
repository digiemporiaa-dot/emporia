"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { toActionFailure } from "@/lib/errors";
import { ga4PropertyChoiceSchema, localPropertySchema } from "@/lib/validation/seo-intel";
import { chooseGa4Property, connectGa4WithServiceAccount, disconnectGa4 } from "@/lib/services/seo-intel/ga4-connection.service";
import { syncGa4Now } from "@/lib/services/seo-intel/ga4-sync.service";
import type { SeoActionState } from "./actions";

/** Google Analytics 4 connection actions (Phase 9). Each service re-checks permission and scope. */

function refresh(propertyId: string) {
  revalidatePath("/admin/marketing/seo");
  revalidatePath("/admin/marketing/seo/revenue");
  revalidatePath(`/admin/marketing/seo/properties/${propertyId}/analytics`);
}

const propertyOf = (formData: FormData) => localPropertySchema.safeParse({ propertyId: formData.get("propertyId") });

export async function ga4ServiceAccountAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = propertyOf(formData);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Choose a website." };
    await connectGa4WithServiceAccount(actor, parsed.data.propertyId);
    refresh(parsed.data.propertyId);
    return { ok: true, data: { message: "Now choose the GA4 property." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function chooseGa4PropertyAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = ga4PropertyChoiceSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Choose a GA4 property." };
    await chooseGa4Property(actor, parsed.data.propertyId, parsed.data.ga4Property);
    refresh(parsed.data.propertyId);
    return { ok: true, data: { message: "Google Analytics connected. The first sync runs on the next schedule, or press Sync now." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function disconnectGa4Action(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = propertyOf(formData);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Choose a website." };
    await disconnectGa4(actor, parsed.data.propertyId);
    refresh(parsed.data.propertyId);
    return { ok: true, data: { message: "Google Analytics disconnected. Data already collected is kept." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function syncGa4NowAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = propertyOf(formData);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Choose a website." };
    const outcome = await syncGa4Now(actor, parsed.data.propertyId);
    refresh(parsed.data.propertyId);
    if (outcome.status === "skipped") return { ok: false, code: "VALIDATION", message: outcome.reason };
    if (outcome.status === "FAILED") return { ok: false, code: "VALIDATION", message: outcome.error ?? "The sync failed." };
    return { ok: true, data: { message: `Synced ${outcome.daysWritten} days.${outcome.status === "PARTIAL" ? ` Stopped early: ${outcome.error}` : ""}` } };
  } catch (error) {
    return toActionFailure(error);
  }
}
