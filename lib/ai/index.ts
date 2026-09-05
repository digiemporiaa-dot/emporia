import "server-only";
import { aiConfig } from "@/lib/config/env";
import { AnthropicProvider, UnconfiguredAI } from "@/lib/ai/anthropic";
import type { AIProvider } from "@/lib/ai/types";

export type {
  AIProvider,
  AITask,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
} from "@/lib/ai/types";

/**
 * The AI provider for this deployment.
 *
 * Lazy and cached, so `next build` needs no key and a deployment without one
 * still boots — the assist features simply are not offered.
 *
 * `AI_PROVIDER` names the vendor. Only `anthropic` is implemented; anything
 * else is treated as unconfigured rather than guessed at, so a typo disables
 * the feature loudly instead of silently picking a default.
 */
let cached: AIProvider | null = null;

export function ai(): AIProvider {
  if (!cached) {
    const config = aiConfig();
    cached =
      config && config.provider.trim().toLowerCase() === "anthropic"
        ? new AnthropicProvider(config.apiKey, config.baseUrl)
        : new UnconfiguredAI();
  }
  return cached;
}

export function isAIConfigured(): boolean {
  return ai().configured;
}

/** Test seam: drop the memoised provider so a changed environment is re-read. */
export function resetAI(): void {
  cached = null;
}
