import { AppError } from "@/lib/errors";

/**
 * Normalised AI failures.
 *
 * Every provider fails differently — Anthropic returns a typed SDK error,
 * Gemini returns an HTTP status and a JSON body, a network timeout returns
 * neither. Callers should not have to know which vendor is configured to know
 * what went wrong, so each provider maps its own failures onto this list.
 *
 * The message on each is what an admin sees. None of them ever carries a key,
 * a header or a raw provider body: a 401 says the key was rejected, not what
 * the key was.
 */

export type AIErrorCode =
  | "AI_DISABLED"
  | "AI_NOT_CONFIGURED"
  | "AI_INVALID_API_KEY"
  | "AI_RATE_LIMITED"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_REQUEST_TIMEOUT"
  | "AI_CONTENT_BLOCKED"
  | "AI_INVALID_RESPONSE"
  | "AI_PROVIDER_ERROR";

const MESSAGES: Record<AIErrorCode, string> = {
  AI_DISABLED: "AI is switched off. Turn it on in Settings → AI and LLM.",
  AI_NOT_CONFIGURED: "AI is not configured yet. Add a provider and an API key in Settings → AI and LLM.",
  AI_INVALID_API_KEY: "The provider rejected the API key. Check it in Settings → AI and LLM.",
  AI_RATE_LIMITED: "The provider is rate limiting this account. Try again shortly.",
  AI_MODEL_UNAVAILABLE: "That model is not available to this account. Check the model name.",
  AI_REQUEST_TIMEOUT: "The provider took too long to answer.",
  AI_CONTENT_BLOCKED: "The provider refused to answer that prompt.",
  AI_INVALID_RESPONSE: "The provider's answer could not be read.",
  AI_PROVIDER_ERROR: "The provider could not be reached.",
};

/**
 * An AI failure, carrying a code the UI can branch on.
 *
 * Extends the app's own error type so the existing `toActionFailure` and route
 * handlers treat it like everything else — a status, a public message, and no
 * stack trace reaching a user (CLAUDE.md 11).
 */
export class AIError extends AppError {
  readonly reason: AIErrorCode;

  constructor(reason: AIErrorCode, detail?: string) {
    // Not configured and disabled are the operator's to fix, so they read as
    // an integration problem rather than a server fault.
    const status =
      reason === "AI_DISABLED" || reason === "AI_NOT_CONFIGURED"
        ? 503
        : reason === "AI_RATE_LIMITED"
          ? 429
          : reason === "AI_INVALID_API_KEY"
            ? 502
            : 502;

    super(
      reason === "AI_DISABLED" || reason === "AI_NOT_CONFIGURED"
        ? "INTEGRATION_NOT_CONFIGURED"
        : reason === "AI_RATE_LIMITED"
          ? "RATE_LIMITED"
          : "INTEGRATION_NOT_CONFIGURED",
      status,
      detail ? `${MESSAGES[reason]} ${detail}` : MESSAGES[reason],
      { internalMessage: `AI failure: ${reason}` },
    );
    this.reason = reason;
  }
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

/**
 * Map an HTTP status from any provider onto a reason.
 *
 * The bodies differ; the statuses do not. A provider with a more specific
 * signal (Gemini's `promptFeedback.blockReason`) checks that first and only
 * falls back to here.
 */
export function reasonForStatus(status: number): AIErrorCode {
  if (status === 401 || status === 403) return "AI_INVALID_API_KEY";
  if (status === 404) return "AI_MODEL_UNAVAILABLE";
  if (status === 429) return "AI_RATE_LIMITED";
  if (status === 408 || status === 504) return "AI_REQUEST_TIMEOUT";
  return "AI_PROVIDER_ERROR";
}
