import { z } from "zod";
import { AI_LIMITS, AI_PROVIDERS } from "@/lib/ai/catalog";

/**
 * AI provider configuration.
 *
 * Distinct from lib/validation/ai.ts, which validates the *inputs and outputs*
 * of the assist features. This file is about which provider answers them and
 * with what credentials.
 *
 * Shared between the admin form and the server action; the server's copy is the
 * one that counts (CLAUDE.md 2 rule 4).
 */

export const aiProviderId = z.enum(AI_PROVIDERS);

/**
 * A provider endpoint.
 *
 * http and https only, and no credentials in the URL. `javascript:`, `file:`
 * and `data:` are the obvious ones to keep out, but the check is an allow-list
 * rather than a block-list so a scheme nobody thought of is refused too
 * (CLAUDE.md 11).
 */
export const providerBaseUrl = z
  .string()
  .trim()
  .max(300)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL, including https://." });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: "custom", message: "Only http and https endpoints are allowed." });
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: "custom", message: "Put the key in the API key field, not the URL." });
    }
  });

/**
 * A model name.
 *
 * Free text within a character set, deliberately: locking this to a list would
 * mean a new model release needs a deploy, which is the thing this whole
 * feature exists to avoid.
 */
export const modelName = z
  .string()
  .trim()
  .min(1, "Enter a model name.")
  .max(120)
  .regex(/^[A-Za-z0-9._:@/-]+$/, "Model names are letters, digits and . _ : @ / -")
  // The provider encodes the name into a path segment, so traversal is already
  // impossible there. Refused here as well: a model name containing `..` is a
  // mistake or an attempt, and neither is worth storing.
  .refine((value) => !value.includes(".."), "A model name cannot contain `..`.");

export const aiSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  provider: aiProviderId,
  model: modelName,
  baseUrl: providerBaseUrl,
  temperature: z.coerce
    .number()
    .min(AI_LIMITS.temperature.min, "Temperature cannot be negative.")
    .max(AI_LIMITS.temperature.max, `Temperature tops out at ${AI_LIMITS.temperature.max}.`),
  maxOutputTokens: z.coerce
    .number()
    .int()
    .min(AI_LIMITS.maxOutputTokens.min)
    .max(AI_LIMITS.maxOutputTokens.max),
});

export type AISettingsInput = z.infer<typeof aiSettingsSchema>;

/**
 * The API key, saved on its own.
 *
 * Separate from the settings form so the secret is never a hidden field in a
 * form that is posted every time someone nudges the temperature — the same
 * shape the Conversions API token already uses.
 */
export const aiApiKeySchema = z.object({
  apiKey: z.string().trim().min(8, "That does not look like an API key.").max(400),
});

/**
 * Test Connection.
 *
 * Takes the whole form, because the point is to test what is on screen before
 * it is saved. The key is optional: left blank, the stored one is used.
 */
export const aiTestSchema = aiSettingsSchema.omit({ enabled: true }).extend({
  apiKey: z
    .string()
    .trim()
    .max(400)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type AITestInput = z.infer<typeof aiTestSchema>;
