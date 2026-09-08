/**
 * What each AI provider needs, and what it defaults to.
 *
 * One table, so a model name or a base URL exists in exactly one place rather
 * than being repeated across the provider, the admin form and the seed. Adding
 * OpenAI or OpenRouter later means adding a row here and a provider class —
 * not editing five files (CLAUDE.md 16).
 *
 * Shared by the server and the admin form, so this file holds no secrets and
 * imports nothing server-only.
 */

export const AI_PROVIDERS = ["gemini", "anthropic"] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

export type ProviderDefinition = {
  id: AIProviderId;
  label: string;
  /** Where the admin gets a key, shown under the field. */
  keyHint: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Offered in the model picker. The field still accepts anything else. */
  suggestedModels: readonly string[];
};

export const PROVIDER_CATALOG: Record<AIProviderId, ProviderDefinition> = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    keyHint: "From Google AI Studio. The key is sent as an X-goog-api-key header.",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-flash-latest",
    suggestedModels: [
      "gemini-flash-latest",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    keyHint: "From console.anthropic.com. Sent as an x-api-key header by the SDK.",
    defaultBaseUrl: "https://api.anthropic.com",
    // The model this deployment has been running on. Changing it here changes
    // the default for a fresh install, never an existing saved configuration.
    defaultModel: "claude-opus-5",
    suggestedModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  },
};

export function isProviderId(value: string): value is AIProviderId {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function providerLabel(id: string): string {
  return isProviderId(id) ? PROVIDER_CATALOG[id].label : id;
}

/** Sensible starting values, and the ceiling the admin form enforces. */
export const AI_DEFAULTS = {
  temperature: 0.7,
  maxOutputTokens: 2048,
  /** Every provider request aborts at this many milliseconds. */
  timeoutMs: 45_000,
} as const;

export const AI_LIMITS = {
  temperature: { min: 0, max: 2 },
  maxOutputTokens: { min: 64, max: 32_000 },
} as const;
