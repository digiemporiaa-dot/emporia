import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
} from "@/lib/ai/types";

/**
 * Claude, through the official Anthropic SDK.
 *
 * The API key is read server-side from lib/config/env and never leaves this
 * process — no AI call is ever made from a browser (CLAUDE.md 2 rule 6).
 */

/**
 * Opus 5. Adaptive thinking is on by default on this model, and `budget_tokens`
 * is rejected — the depth lever is `effort`, set per task below.
 */
const MODEL = "claude-opus-5";

const DEFAULT_MAX_TOKENS = 4_000;

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

export class AnthropicProvider implements AIProvider {
  readonly configured = true;

  private readonly client: Anthropic;

  constructor(apiKey: string, baseUrl?: string | null) {
    // The base URL is overridable so verification can point at a local double
    // and exercise this exact code rather than a stub.
    this.client = new Anthropic(baseUrl ? { apiKey, baseURL: baseUrl } : { apiKey });
  }

  get describe(): string {
    return `Anthropic ${MODEL}`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await this.send({
      system: request.system,
      prompt: request.prompt,
      maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      task: request.task,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new ValidationError("The assistant returned nothing to show.");
    }

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
      maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
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
      throw new ValidationError("The assistant's answer could not be read.");
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
    return this.client.messages.create({
      model: MODEL,
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
 * No AI configured.
 *
 * Every call throws a typed error. The admin screens read `isAIConfigured()`
 * and hide the assist buttons, so nobody is offered a feature that cannot run —
 * and nothing invents an answer to stand in for one (CLAUDE.md 2 rule 5).
 */
export class UnconfiguredAI implements AIProvider {
  readonly configured = false;
  readonly describe = "No AI provider configured";

  private fail(): never {
    throw new IntegrationNotConfiguredError(
      "AI is not configured. Set AI_PROVIDER and AI_API_KEY.",
    );
  }

  async complete(): Promise<CompletionResult> {
    this.fail();
  }

  async completeStructured<T>(): Promise<CompletionResult & { data: T }> {
    this.fail();
  }
}
