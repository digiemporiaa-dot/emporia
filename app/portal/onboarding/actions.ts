"use server";

import { revalidatePath } from "next/cache";
import { currentActor } from "@/lib/actor";
import { requirePortalActor } from "@/lib/auth/rbac";
import { isAppError, toActionFailure, type ActionResult } from "@/lib/errors";
import * as onboarding from "@/lib/services/onboarding.service";
import {
  analyticsStepSchema,
  brandColorsSchema,
  brandConfirmSchema,
  brandPresignSchema,
  businessStepSchema,
  companyStepSchema,
  socialStepSchema,
  WEEKDAYS,
  websiteStepSchema,
} from "@/lib/validation/onboarding";
import { gscSiteChoiceSchema } from "@/lib/validation/seo-intel";

/**
 * Portal onboarding actions. Every one starts from `requirePortalActor`, so the
 * client is the session's — nothing here reads a client id from the form.
 */

export type StepState = ActionResult<{ message: string; percent: number }> | null;

async function actor() {
  return requirePortalActor(await currentActor());
}

function done(percent: number, message = "Saved."): StepState {
  revalidatePath("/portal");
  revalidatePath("/portal/onboarding");
  return { ok: true, data: { message, percent } };
}

function invalid(error: { issues: { message: string }[]; flatten: () => { fieldErrors: unknown } }): StepState {
  return { ok: false, code: "VALIDATION", message: error.issues[0]?.message ?? "Check the form.", details: error.flatten().fieldErrors };
}

const form = (formData: FormData) => Object.fromEntries(formData.entries()) as Record<string, string>;

export async function saveCompanyAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    const parsed = companyStepSchema.safeParse(form(formData));
    if (!parsed.success) return invalid(parsed.error);
    return done((await onboarding.saveCompanyStep(await actor(), parsed.data)).percent);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveBrandColorsAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    const parsed = brandColorsSchema.safeParse(form(formData));
    if (!parsed.success) return invalid(parsed.error);
    return done((await onboarding.saveBrandColors(await actor(), parsed.data.colors)).percent);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveWebsiteAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    const raw = form(formData);
    const parsed = websiteStepSchema.safeParse({ ...raw, confirmed: raw["confirmed"] === "on" });
    if (!parsed.success) return invalid(parsed.error);
    return done((await onboarding.saveWebsiteStep(await actor(), parsed.data)).percent);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveAnalyticsAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    const raw = form(formData);
    const parsed = analyticsStepSchema.safeParse({ ...raw, confirmed: raw["confirmed"] === "on" });
    if (!parsed.success) return invalid(parsed.error);
    return done((await onboarding.saveAnalyticsStep(await actor(), parsed.data)).percent);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveSocialAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    // Rows arrive as platform-0/handle-0, platform-1/handle-1…; blank rows are dropped.
    const profiles: { platform: string; handle: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const platform = formData.get(`platform-${i}`);
      const handle = formData.get(`handle-${i}`);
      if (typeof platform === "string" && platform && typeof handle === "string" && handle.trim()) profiles.push({ platform, handle });
    }
    const parsed = socialStepSchema.safeParse({ profiles });
    if (!parsed.success) return invalid(parsed.error);
    return done((await onboarding.saveSocialProfiles(await actor(), parsed.data.profiles)).percent);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveBusinessAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    const raw = form(formData);
    // Each day is open or closed, with one opening span, from the form.
    const hours = Object.fromEntries(
      WEEKDAYS.map((day) => [day, raw[`${day}-open`] === "on" ? [{ open: raw[`${day}-from`] ?? "", close: raw[`${day}-to`] ?? "" }] : []]),
    );
    const parsed = businessStepSchema.safeParse({ ...raw, hours });
    if (!parsed.success) return invalid(parsed.error);
    return done((await onboarding.saveBusinessStep(await actor(), parsed.data)).percent);
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function chooseSiteAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    const parsed = gscSiteChoiceSchema.safeParse(form(formData));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Choose your Search Console property." };
    const progress = await onboarding.portalChooseGscSite(await actor(), parsed.data.propertyId, parsed.data.siteUrl);
    return done(progress.percent, "Search Console connected.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Upload step 1: a presigned URL for the browser to PUT the file to. */
export async function presignBrandAction(input: unknown) {
  try {
    const parsed = brandPresignSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "That file cannot be uploaded." };
    const upload = await onboarding.presignBrandAsset(await actor(), parsed.data);
    return { ok: true as const, upload };
  } catch (error) {
    // Storage not set up is the agency's configuration, not something a
    // client can act on — and its message names environment variables.
    if (isAppError(error) && error.code === "INTEGRATION_NOT_CONFIGURED") {
      return { ok: false as const, message: "Uploads are not available yet. Send your files to your account manager for now." };
    }
    return { ok: false as const, message: toActionFailure(error).message };
  }
}

/** Upload step 2: verify what landed and file it under this client. */
export async function confirmBrandAction(input: unknown) {
  try {
    const parsed = brandConfirmSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, message: "That upload is not valid." };
    await onboarding.confirmBrandAsset(await actor(), parsed.data.uploadId, parsed.data.kind);
    revalidatePath("/portal/onboarding");
    revalidatePath("/portal");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toActionFailure(error).message };
  }
}

export async function removeBrandAction(_prev: StepState, formData: FormData): Promise<StepState> {
  try {
    const id = formData.get("assetId");
    if (typeof id !== "string" || !id) return { ok: false, code: "VALIDATION", message: "Nothing to remove." };
    return done((await onboarding.removeBrandAsset(await actor(), id)).percent, "Removed.");
  } catch (error) {
    return toActionFailure(error);
  }
}
