"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { capiTokenSchema, trackingSettingsSchema } from "@/lib/validation/tracking";
import * as tracking from "@/lib/services/tracking.service";
import { toActionFailure, type ActionFailure } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Tracking server actions.
 *
 * Authenticate, validate with zod, hand off to the service — which performs the
 * permission check and writes the audit row (CLAUDE.md 4).
 *
 * Nothing in this file logs a form value. The settings form is harmless, but
 * the token form is not, and one `actionLog.info({ raw })` added later to the
 * wrong function is how a secret ends up in a log file — so neither logs.
 */

const actionLog = log("tracking");

/**
 * A failure carries the values that were submitted.
 *
 * React resets an uncontrolled form once its action resolves, so without this
 * a single typo in one ID would clear all twelve fields and the consent
 * wording with them. The form re-renders what was sent rather than what is
 * stored, so the correction is a correction and not a re-entry.
 *
 * The Conversions API token is not among these values — it has its own form.
 */
export type TrackingActionState =
  | { ok: true; data: { saved: true } }
  | (ActionFailure & { values: Record<string, string> })
  | null;

const checked = (value: FormDataEntryValue | null) => value === "on" || value === "true";

/** Every text and toggle field, as strings, for the failure path above. */
function submittedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

export async function saveTrackingSettingsAction(
  _prev: TrackingActionState,
  formData: FormData,
): Promise<TrackingActionState> {
  try {
    const actor = await requireActor();

    // Read field by field rather than spreading the FormData: an unchecked
    // checkbox is absent from the payload entirely, so every toggle has to be
    // resolved explicitly or "off" would parse as undefined.
    const parsed = trackingSettingsSchema.safeParse({
      gtmEnabled: checked(formData.get("gtmEnabled")),
      gtmId: formData.get("gtmId"),

      ga4Enabled: checked(formData.get("ga4Enabled")),
      ga4Id: formData.get("ga4Id"),

      googleAdsEnabled: checked(formData.get("googleAdsEnabled")),
      googleAdsId: formData.get("googleAdsId"),
      googleAdsLabelEnabled: checked(formData.get("googleAdsLabelEnabled")),
      googleAdsLabel: formData.get("googleAdsLabel"),

      googleSiteVerificationEnabled: checked(formData.get("googleSiteVerificationEnabled")),
      googleSiteVerification: formData.get("googleSiteVerification"),

      metaPixelEnabled: checked(formData.get("metaPixelEnabled")),
      metaPixelId: formData.get("metaPixelId"),

      clarityEnabled: checked(formData.get("clarityEnabled")),
      clarityId: formData.get("clarityId"),

      hotjarEnabled: checked(formData.get("hotjarEnabled")),
      hotjarId: formData.get("hotjarId"),

      pinterestEnabled: checked(formData.get("pinterestEnabled")),
      pinterestId: formData.get("pinterestId"),

      tiktokEnabled: checked(formData.get("tiktokEnabled")),
      tiktokId: formData.get("tiktokId"),

      snapchatEnabled: checked(formData.get("snapchatEnabled")),
      snapchatId: formData.get("snapchatId"),

      consentMode: formData.get("consentMode") ?? undefined,
      consentBannerText: formData.get("consentBannerText") ?? undefined,

      capiPurchasesEnabled: checked(formData.get("capiPurchasesEnabled")),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
        values: submittedValues(formData),
      };
    }

    await tracking.updateTrackingSettings(actor, parsed.data);

    revalidatePath("/admin/marketing/tracking");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    actionLog.error({ err: error }, "saveTrackingSettings failed");
    return { ...toActionFailure(error), values: submittedValues(formData) };
  }
}

export async function saveCapiTokenAction(
  _prev: TrackingActionState,
  formData: FormData,
): Promise<TrackingActionState> {
  try {
    const actor = await requireActor();

    const parsed = capiTokenSchema.safeParse({ token: formData.get("token") });
    if (!parsed.success) {
      // No `values` here, deliberately: echoing the field back would put the
      // token in the response and then in the HTML.
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the token.",
        details: parsed.error.flatten().fieldErrors,
        values: {},
      };
    }

    await tracking.saveCapiToken(actor, parsed.data.token);

    revalidatePath("/admin/marketing/tracking");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    // The error is logged, the token is not: `parsed` is out of scope in the
    // failure path of the service call and is never attached here.
    actionLog.error({ err: error }, "saveCapiToken failed");
    return { ...toActionFailure(error), values: {} };
  }
}

export async function clearCapiTokenAction(
  _prev: TrackingActionState,
  _formData: FormData,
): Promise<TrackingActionState> {
  try {
    const actor = await requireActor();
    await tracking.clearCapiToken(actor);

    revalidatePath("/admin/marketing/tracking");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    actionLog.error({ err: error }, "clearCapiToken failed");
    return { ...toActionFailure(error), values: {} };
  }
}
