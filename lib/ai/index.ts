import "server-only";
import { AnthropicProvider, UnconfiguredAI } from "@/lib/ai/anthropic";
import { GeminiProvider } from "@/lib/ai/gemini";
import { AI_DEFAULTS } from "@/lib/ai/catalog";
import { activeAIConfig, type ActiveAIConfig } from "@/lib/services/ai-settings.service";
import type { AIProvider } from "@/lib/ai/types";

export type {
  AIProvider,
  AITask,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
} from "@/lib/ai/types";
export { AIError, isAIError, type AIErrorCode } from "@/lib/ai/errors";

/**
 * The AI provider for this request.
 *
 * Resolved per call from the saved configuration, and deliberately **not**
 * memoised. Memoising it was fine when the configuration came from environment
 * variables that could not change without a deploy; it is wrong now, because
 * the whole point of the settings screen is that an admin changes the provider
 * and the next request uses it — with no restart (spec §33).
 *
 * The cost of not caching is one indexed row read per AI call, against a
 * network round trip to a language model. That is not a trade worth making.
 *
 * A provider name nothing implements is treated as unconfigured rather than
 * guessed at, so a typo disables the feature loudly instead of silently
 * answering from a different account than the screen shows.
 */
export async function ai(): Promise<AIProvider> {
  const config = await activeAIConfig();
  if (!config) return new UnconfiguredAI();
  return providerFor(config);
}

/** Build a provider from an explicit configuration. Shared with Test Connection. */
export function providerFor(config: ActiveAIConfig): AIProvider {
  switch (config.provider) {
    case "gemini":
      return new GeminiProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        timeoutMs: AI_DEFAULTS.timeoutMs,
      });
    case "anthropic":
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        timeoutMs: AI_DEFAULTS.timeoutMs,
      });
  }
}

/** Whether the assist features should be offered at all. */
export async function isAIConfigured(): Promise<boolean> {
  return (await activeAIConfig()) !== null;
}

/** How to describe the active provider on an admin screen. */
export async function describeAI(): Promise<string> {
  return (await ai()).describe;
}
