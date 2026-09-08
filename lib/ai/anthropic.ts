import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AIError, reasonForStatus } from "@/lib/ai/errors";
import { AI_DEFAULTS } from "@/lib/ai/catalog";
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
} from "@/lib/ai/types";

/**
 * Claude, through the official Anthropic SDK.
 *
 * The model, the endpoint and the key all come from the saved configuration
 * rather than from this file — the whole point of the settings screen is that
 * changing a model is not a deploy. The key is read server-side per request and
 * never leaves this process (CLAUDE.md 2 rule 6).
 *
 * Adaptive thinking is on by default on the Opus models, and `budget_tokens` is
 * rejected there — the depth lever is `effort`, set per task below.
 */

/**
 * Drafting reads and rewrites; it does not need deep reasoning, and lower
 * effort keeps a per-lead summary cheap. The analysis task raises it.
 */
const EFFORT: Record<string, "low" | "medium" | "high"> = {
  summarizeLead: "low",
  scoreLead: "medium",
  generateProposal: "medium",
  generateContent: "medium",
  generateSEOContent: "medium",
  analyzeCRM: "high",
};

export type AnthropicOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs?: number;
};

export class AnthropicProvider implements AIProvider {
  readonly configured = true;

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxOutputTokens: number;

  constructor(options: AnthropicOptions) {
    const { apiKey, baseUrl, timeoutMs } = options;
    // The base URL is overridable so verification can point at a local double
    // and exercise this exact code rather than a stub.
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      timeout: timeoutMs ?? AI_DEFAULTS.timeoutMs,
      // Retries are the caller's business: an assist button that silently takes
      // three times as long to fail is worse than one that fails.
      maxRetries: 0,
    });
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens;
  }

  get describe(): string {
    return `Anthropic ${this.model}`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await this.send({
      system: request.system,
      prompt: request.prompt,
      maxTokens: request.maxTokens ?? this.maxOutputTokens,
      task: request.task,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) throw new AIError("AI_INVALID_RESPONSE");

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  async completeStructured<T>(
    request: StructuredRequest<T>,
  ): Promise<CompletionResult & { data: T }> {
    const response = await this.send({
      system: request.system,
      prompt: request.prompt,
      maxTokens: request.maxTokens ?? this.maxOutputTokens,
      task: request.task,
      // Constrains the reply to the schema, so nothing here has to pick JSON
      // out of a sentence.
      format: { type: "json_schema", schema: request.schema },
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AIError("AI_INVALID_RESPONSE");
    }

    return {
      // The caller's own parser has the final say, so a schema the provider
      // honoured loosely still cannot reach the product as the wrong shape.
      data: request.parse(parsed),
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  private async send(input: {
    system: string;
    prompt: string;
    maxTokens: number;
    task: string;
    format?: { type: "json_schema"; schema: Record<string, unknown> };
  }) {
    try {
      return await this.request(input);
    } catch (cause) {
      throw asAIError(cause);
    }
  }

  private async request(input: {
    system: string;
    prompt: string;
    maxTokens: number;
    task: string;
    format?: { type: "json_schema"; schema: Record<string, unknown> };
  }) {
    return this.client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens,
      // The instruction is stable per task and sits first, so it caches across
      // every call for that feature.
      system: [
        { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
      ],
      output_config: {
        effort: EFFORT[input.task] ?? "medium",
        ...(input.format ? { format: input.format } : {}),
      },
      messages: [{ role: "user", content: input.prompt }],
    });
  }
}

/**
 * The SDK's errors, mapped onto the shared reasons.
 *
 * A caller should not have to know which vendor answered to know whether the
 * key was rejected or the account is rate limited.
 */
function asAIError(cause: unknown): AIError {
  if (cause instanceof Anthropic.APIError && typeof cause.status === "number") {
    return new AIError(reasonForStatus(cause.status));
  }
  if (cause instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIError("AI_REQUEST_TIMEOUT");
  }
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
    return new AIError("AI_REQUEST_TIMEOUT");
  }
  return new AIError("AI_PROVIDER_ERROR");
}

/**
 * No AI configured.
 *
 * Every call throws a typed error. The admin screens read `aiStatus()` and hide
 * the assist buttons, so nobody is offered a feature that cannot run — and
 * nothing invents an answer to stand in for one (CLAUDE.md 2 rule 5).
 */
export class UnconfiguredAI implements AIProvider {
  readonly configured = false;
  readonly describe = "No AI provider configured";

  constructor(private readonly reason: "AI_DISABLED" | "AI_NOT_CONFIGURED" = "AI_NOT_CONFIGURED") {}

  private fail(): never {
    throw new AIError(this.reason);
  }

  async complete(): Promise<CompletionResult> {
    this.fail();
  }

  async completeStructured<T>(): Promise<CompletionResult & { data: T }> {
    this.fail();
  }
}
