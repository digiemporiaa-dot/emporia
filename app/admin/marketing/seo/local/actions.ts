"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { toActionFailure } from "@/lib/errors";
import {
  localCitiesAddSchema,
  localCityAliasesSchema,
  localCityRemoveSchema,
  localPageSchema,
  localPropertySchema,
  localServiceRemoveSchema,
  localServiceSchema,
} from "@/lib/validation/seo-intel";
import {
  addLocalCities,
  importLocalFromCms,
  removeLocalCity,
  removeLocalService,
  saveLocalService,
  setLocalCityAliases,
  setLocalPage,
} from "@/lib/services/seo-intel/local.service";
import { syncReviewsNow } from "@/lib/services/seo-intel/reviews.service";
import type { SeoActionState } from "../actions";

/** Local SEO actions (Phase 8). Each service re-checks permission and scope. */

function refresh() {
  revalidatePath("/admin/marketing/seo/local", "layout");
}

const invalid = (message: string | undefined, fallback: string): SeoActionState => ({ ok: false, code: "VALIDATION", message: message ?? fallback });

export async function saveLocalServiceAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localServiceSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message, "Check the service.");
    await saveLocalService(actor, parsed.data.propertyId, parsed.data);
    refresh();
    return { ok: true, data: { message: parsed.data.id ? "Service saved." : "Service added." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeLocalServiceAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localServiceRemoveSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return invalid(undefined, "Choose a service.");
    await removeLocalService(actor, parsed.data.propertyId, parsed.data.id);
    refresh();
    return { ok: true, data: { message: "Service removed." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function addLocalCitiesAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localCitiesAddSchema.safeParse({ propertyId: formData.get("propertyId"), cityIds: formData.getAll("cityIds") });
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message, "Choose cities.");
    const { added } = await addLocalCities(actor, parsed.data.propertyId, parsed.data.cityIds);
    refresh();
    return { ok: true, data: { message: added ? `Added ${added} ${added === 1 ? "city" : "cities"}.` : "Those cities are already on the list." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function setLocalCityAliasesAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localCityAliasesSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message, "Check the other names.");
    await setLocalCityAliases(actor, parsed.data.propertyId, parsed.data.localCityId, parsed.data.aliases);
    refresh();
    return { ok: true, data: { message: "Saved." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeLocalCityAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localCityRemoveSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return invalid(undefined, "Choose a city.");
    await removeLocalCity(actor, parsed.data.propertyId, parsed.data.localCityId);
    refresh();
    return { ok: true, data: { message: "City removed." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function setLocalPageAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localPageSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message, "Check the page address.");
    await setLocalPage(actor, parsed.data.propertyId, parsed.data);
    refresh();
    return { ok: true, data: { message: parsed.data.url ? "Page chosen." : "Back to the automatic match." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function importLocalFromCmsAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localPropertySchema.safeParse({ propertyId: formData.get("propertyId") });
    if (!parsed.success) return invalid(undefined, "Choose a website.");
    const result = await importLocalFromCms(actor, parsed.data.propertyId);
    refresh();
    const parts = [`Imported ${result.services} ${result.services === 1 ? "service" : "services"} and ${result.cities} ${result.cities === 1 ? "city" : "cities"}.`];
    if (result.skipped) parts.push(`${result.skipped} left out: the lists are full.`);
    return { ok: true, data: { message: parts.join(" ") } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function syncReviewsNowAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = localPropertySchema.safeParse({ propertyId: formData.get("propertyId") });
    if (!parsed.success) return invalid(undefined, "Choose a website.");
    const result = await syncReviewsNow(actor, parsed.data.propertyId);
    refresh();
    if (!result.locations) return { ok: false, code: "VALIDATION", message: "This client has no connected Google Business location. Connect one under Social → Accounts." };
    if (result.errors.length) return { ok: false, code: "VALIDATION", message: `${result.synced} of ${result.locations} read. ${result.errors[0]}` };
    return { ok: true, data: { message: `Read ${result.synced} ${result.synced === 1 ? "location" : "locations"}.` } };
  } catch (error) {
    return toActionFailure(error);
  }
}
