"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import {
  clearProviderSettings,
  saveProviderSettings,
} from "@/lib/services/social-settings.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("social");

const PROVIDERS = [
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "X",
  "GOOGLE_BUSINESS_PROFILE",
] as const;

/**
 * A blank secret means "keep the stored one".
 *
 * The form shows a mask, never the value, so submitting it unchanged must not
 * wipe the credential. Removing one is the separate Clear action.
 */
const saveSchema = z.object({
  provider: z.enum(PROVIDERS),
  clientId: z.string().trim().min(1, "Enter the app's client id.").max(200),
  clientSecret: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
  isEnabled: z.coerce.boolean().default(false),
});

export async function saveSocialProviderAction(
  _prev: ActionResult<{ provider: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ provider: string }>> {
  try {
    const actor = await requireActor();
    const parsed = saveSchema.safeParse({
      provider: formData.get("provider"),
      clientId: formData.get("clientId"),
      clientSecret: formData.get("clientSecret") ?? "",
      isEnabled: formData.get("isEnabled") === "on",
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check those details.",
      };
    }

    await saveProviderSettings(actor, parsed.data);
    revalidatePath("/admin/settings/social");
    return { ok: true, data: { provider: parsed.data.provider } };
  } catch (error) {
    actionLog.error({ err: error }, "saving social provider credentials failed");
    return toActionFailure(error);
  }
}

export async function clearSocialProviderAction(
  input: unknown,
): Promise<ActionResult<{ provider: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ provider: z.enum(PROVIDERS) }).safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "There is no such provider." };
    }

    await clearProviderSettings(actor, parsed.data.provider);
    revalidatePath("/admin/settings/social");
    return { ok: true, data: { provider: parsed.data.provider } };
  } catch (error) {
    actionLog.error({ err: error }, "clearing social provider credentials failed");
    return toActionFailure(error);
  }
}
