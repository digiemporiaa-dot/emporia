"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { navigationSettingsSchema } from "@/lib/validation/navigation";
import { updateNavigationSettings } from "@/lib/services/navigation.service";
import { toActionFailure, type ActionFailure } from "@/lib/errors";
import { log } from "@/lib/logger";
import type { ZodError } from "zod";

/**
 * Navigation settings actions.
 *
 * Authenticate, validate with zod, hand off to the service — which performs the
 * permission check and writes the audit row (CLAUDE.md 4).
 */

const actionLog = log("navigation-settings");

/**
 * Errors keyed by the full path zod reported, e.g. `headerLinks.2.href`.
 *
 * `flatten()` would collapse every row of a list onto one key, which is no use
 * to a form where eight links are edited at once: the editor has to be told
 * which row is wrong, not that something in the list is.
 */
export type FieldErrors = Record<string, string>;

export type NavigationActionState =
  | { ok: true }
  | (ActionFailure & { fieldErrors: FieldErrors })
  | null;

function byPath(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    // First issue per field wins; a second message on the same input would
    // only replace the one the editor is already reading.
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

/** A list arrives as JSON in a hidden field. Anything unparseable fails validation. */
function jsonList(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const checked = (value: FormDataEntryValue | null) => value === "on" || value === "true";

export async function saveNavigationAction(
  _prev: NavigationActionState,
  formData: FormData,
): Promise<NavigationActionState> {
  try {
    const actor = await requireActor();

    const parsed = navigationSettingsSchema.safeParse({
      brandName: formData.get("brandName"),
      tagline: formData.get("tagline"),
      contactEmail: formData.get("contactEmail"),
      contactPhone: formData.get("contactPhone"),
      contactAddress: formData.get("contactAddress"),
      headerLinks: jsonList(formData.get("headerLinks")),
      // An unchecked checkbox is absent from the payload entirely, so the
      // toggle has to be resolved explicitly or "off" would parse as undefined.
      ctaEnabled: checked(formData.get("ctaEnabled")),
      // `?? ""` rather than the raw value: a field the browser leaves out of the
      // payload is "not set", which for these two is a blank, not a type error.
      ctaLabel: formData.get("ctaLabel") ?? "",
      ctaHref: formData.get("ctaHref") ?? "",
      footerCompanyLinks: jsonList(formData.get("footerCompanyLinks")),
      footerLegalLinks: jsonList(formData.get("footerLegalLinks")),
      socialLinks: jsonList(formData.get("socialLinks")),
      copyrightName: formData.get("copyrightName"),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        fieldErrors: byPath(parsed.error),
      };
    }

    await updateNavigationSettings(actor, parsed.data);

    revalidatePath("/admin/settings/navigation");
    return { ok: true };
  } catch (error) {
    actionLog.error({ err: error }, "saveNavigation failed");
    return { ...toActionFailure(error), fieldErrors: {} };
  }
}
