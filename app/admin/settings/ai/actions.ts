"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireActor } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { clientIpFrom } from "@/lib/auth";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { aiApiKeySchema, aiSettingsSchema, aiTestSchema } from "@/lib/validation/ai-settings";
import * as settings from "@/lib/services/ai-settings.service";
import { providerFor } from "@/lib/ai";
import { AIError, isAIError } from "@/lib/ai/errors";
import { providerLabel } from "@/lib/ai/catalog";
import { toActionFailure, type ActionFailure } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * AI settings actions.
 *
 * Authenticate, check the permission, validate with zod, then hand off to the
 * service (CLAUDE.md 4).
 *
 * Nothing in this file logs a form value. The settings form is harmless; the
 * API key field is not, and one `actionLog.info({ raw })` added later to the
 * wrong function is how a credential ends up in a log file — so neither logs.
 */

const actionLog = log("ai-settings");

export type AIActionState =
  | { ok: true; data: { saved: true } }
  | (ActionFailure & { values: Record<string, string> })
  | null;

export type TestState =
  | { ok: true; provider: string; model: string; sample: string }
  | { ok: false; message: string; reason?: string }
  | null;

const checked = (value: FormDataEntryValue | null) => value === "on" || value === "true";

/** Every text field, for redisplay after a rejected save. Never the key. */
function submittedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name === "apiKey") continue;
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

function fields(formData: FormData) {
  return {
    enabled: checked(formData.get("enabled")),
    provider: formData.get("provider"),
    model: formData.get("model"),
    baseUrl: formData.get("baseUrl"),
    temperature: formData.get("temperature"),
    maxOutputTokens: formData.get("maxOutputTokens"),
  };
}

export async function saveAISettingsAction(
  _prev: AIActionState,
  formData: FormData,
): Promise<AIActionState> {
  try {
    const actor = await requireActor();
    const parsed = aiSettingsSchema.safeParse(fields(formData));

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
        values: submittedValues(formData),
      };
    }

    await settings.updateAISettings(actor, parsed.data);

    revalidatePath("/admin/settings/ai");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    actionLog.error({ err: error }, "saveAISettings failed");
    return { ...toActionFailure(error), values: submittedValues(formData) };
  }
}

export async function saveAIApiKeyAction(
  _prev: AIActionState,
  formData: FormData,
): Promise<AIActionState> {
  try {
    const actor = await requireActor();
    const parsed = aiApiKeySchema.safeParse({ apiKey: formData.get("apiKey") });

    if (!parsed.success) {
      // No `values` here, deliberately: echoing the field back would put the
      // key in the response and then in the HTML.
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the key.",
        details: parsed.error.flatten().fieldErrors,
        values: {},
      };
    }

    await settings.saveAIApiKey(actor, parsed.data.apiKey);

    revalidatePath("/admin/settings/ai");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    actionLog.error({ err: error }, "saveAIApiKey failed");
    return { ...toActionFailure(error), values: {} };
  }
}

export async function clearAIApiKeyAction(
  _prev: AIActionState,
  _formData: FormData,
): Promise<AIActionState> {
  try {
    const actor = await requireActor();
    await settings.clearAIApiKey(actor);

    revalidatePath("/admin/settings/ai");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    actionLog.error({ err: error }, "clearAIApiKey failed");
    return { ...toActionFailure(error), values: {} };
  }
}

/**
 * Test Connection.
 *
 * A real request to the real provider, through the same provider class every
 * assist feature uses — a test that took a different code path could pass while
 * the thing it claims to test is broken.
 *
 * The key may be one the admin has typed but not saved. It arrives over the
 * same authenticated HTTPS channel as the rest of the form, is used in memory
 * for this one request, and is never written, cached or logged. Left blank, the
 * stored key is used instead.
 *
 * Rate limited per user: a provider call costs money, and a button costs a
 * click.
 */
export async function testAIConnectionAction(
  _prev: TestState,
  formData: FormData,
): Promise<TestState> {
  let actorId = "unknown";
  try {
    const actor = await requireActor();
    actorId = actor.userId;
    // The permission is checked here as well as in the service: this action
    // makes a paid provider request before it reaches one.
    requirePermission(actor, "settings.edit");

    const head = await headers();
    const limit = await checkRateLimit(
      `ai:test:${actor.userId}:${clientIpFrom(head) ?? "unknown"}`,
      { limit: 6, windowMs: 60_000 },
    );
    if (!limit.allowed) {
      return {
        ok: false,
        message: `Too many tests. Try again in ${limit.retryAfterSeconds} seconds.`,
        reason: "AI_RATE_LIMITED",
      };
    }

    const parsed = aiTestSchema.safeParse({
      ...fields(formData),
      apiKey: formData.get("apiKey"),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    // A blank key means "test what is stored". Reading it here is the only
    // place the saved key is decrypted for a test.
    const stored = parsed.data.apiKey ? null : await settings.activeAIConfig();
    const apiKey = parsed.data.apiKey ?? stored?.apiKey;
    if (!apiKey) {
      return {
        ok: false,
        message: "Enter an API key, or save one first.",
        reason: "AI_NOT_CONFIGURED",
      };
    }

    const provider = providerFor({
      provider: parsed.data.provider,
      apiKey,
      model: parsed.data.model,
      baseUrl: parsed.data.baseUrl,
      temperature: parsed.data.temperature,
      maxOutputTokens: parsed.data.maxOutputTokens,
      source: "database",
    });

    const result = await provider.complete({
      task: "generateContent",
      system: "You are checking a connection. Answer with exactly what is asked and nothing else.",
      prompt: "Reply with exactly: OK",
      // A connection test needs one word, and the admin's configured ceiling
      // could be large enough to be worth money.
      maxTokens: 32,
    });

    await settings.recordAITest(actor, {
      provider: parsed.data.provider,
      model: parsed.data.model,
      ok: true,
    });

    return {
      ok: true,
      provider: providerLabel(parsed.data.provider),
      model: result.model || parsed.data.model,
      sample: result.text.slice(0, 120),
    };
  } catch (error) {
    // The error is logged; the key is not — it is a local in the try block and
    // is never attached to anything that leaves this function.
    actionLog.warn(
      { err: error instanceof AIError ? error.reason : error, actorId },
      "AI connection test failed",
    );

    if (isAIError(error)) {
      return { ok: false, message: error.publicMessage, reason: error.reason };
    }
    const failure = toActionFailure(error);
    return { ok: false, message: failure.message };
  }
}
