import "server-only";
import { AIError, reasonForStatus } from "@/lib/ai/errors";
import { AI_DEFAULTS } from "@/lib/ai/catalog";
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
} from "@/lib/ai/types";

/**
 * Google Gemini, through its REST API.
 *
 * No SDK: the generateContent surface is one POST, and a dependency to build
 * one request body is a dependency to keep patched. `fetch` is native on the
 * server runtime this deploys to.
 *
 * The key travels in the `X-goog-api-key` header, never the query string — a
 * URL is the part that ends up in proxy logs, error messages and traces. It is
 * read from the database per request and never leaves this process
 * (CLAUDE.md 2 rule 6).
 */

type GeminiPart = { text?: string };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  /** The model that actually answered, which an alias hides. */
  modelVersion?: string;
  error?: { message?: string; status?: string };
};

export type GeminiOptions = {
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs?: number;
};

export class GeminiProvider implements AIProvider {
  readonly configured = true;

  constructor(private readonly options: GeminiOptions) {}

  get describe(): string {
    return `Google Gemini ${this.options.model}`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const body = await this.send(request);
    const text = extractText(body);
    if (!text) throw new AIError("AI_INVALID_RESPONSE");
    return this.result(text, body);
  }

  async completeStructured<T>(
    request: StructuredRequest<T>,
  ): Promise<CompletionResult & { data: T }> {
    // Gemini enforces a response schema natively, so nothing here has to pick
    // JSON out of a sentence. Its dialect is a subset of JSON Schema, and the
    // fields it rejects are stripped rather than sent.
    const body = await this.send(request, {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(request.schema),
    });

    const text = extractText(body);
    if (!text) throw new AIError("AI_INVALID_RESPONSE");

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
      ...this.result(text, body),
    };
  }

  private result(text: string, body: GeminiResponse): CompletionResult {
    return {
      text,
      usage: {
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      },
      // What Google says answered, not what was asked for. `gemini-flash-latest`
      // is an alias that resolves to a concrete version, so echoing the
      // configured name back would hide which model actually ran — and that is
      // the one an admin needs when a reply changes character overnight.
      model: body.modelVersion ?? this.options.model,
    };
  }

  private async send(
    request: CompletionRequest,
    generation?: Record<string, unknown>,
  ): Promise<GeminiResponse> {
    const endpoint = `${trimSlash(this.options.baseUrl)}/models/${encodeURIComponent(
      this.options.model,
    )}:generateContent`;

    const payload = {
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      // Gemini's own field for the operator instruction. Keeping it separate
      // from the user turn preserves the semantics the Anthropic path has.
      systemInstruction: { parts: [{ text: request.system }] },
      generationConfig: {
        temperature: this.options.temperature,
        maxOutputTokens: request.maxTokens ?? this.options.maxOutputTokens,
        ...generation,
      },
    };

    return geminiFetch(endpoint, this.options.apiKey, payload, this.options.timeoutMs);
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * One request to Gemini, with every failure mapped onto a typed reason.
 *
 * Shared with Test Connection, which needs the identical request path — a test
 * that exercises a different code path is a test that can pass while the real
 * thing is broken.
 */
export async function geminiFetch(
  endpoint: string,
  apiKey: string,
  payload: unknown,
  timeoutMs: number = AI_DEFAULTS.timeoutMs,
): Promise<GeminiResponse> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header, not a query parameter: a URL is what proxies and error
        // reports keep.
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    // An aborted request is a timeout; anything else is the network.
    const timedOut =
      cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    throw new AIError(timedOut ? "AI_REQUEST_TIMEOUT" : "AI_PROVIDER_ERROR");
  }

  let body: GeminiResponse;
  try {
    body = (await response.json()) as GeminiResponse;
  } catch {
    throw new AIError(response.ok ? "AI_INVALID_RESPONSE" : reasonForStatus(response.status));
  }

  if (!response.ok) {
    // The provider's own *message* is never surfaced: it can echo the request,
    // and the request contains the prompt. Its `status` is a fixed enum —
    // RESOURCE_EXHAUSTED, PERMISSION_DENIED and so on — which carries no
    // content and is the difference between "wait a minute" and "your quota is
    // spent". Passed through only when it looks like one.
    throw new AIError(reasonForStatus(response.status), safeStatus(body));
  }

  const blocked = body.promptFeedback?.blockReason;
  if (blocked) throw new AIError("AI_CONTENT_BLOCKED");

  const finish = body.candidates?.[0]?.finishReason;
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST") {
    throw new AIError("AI_CONTENT_BLOCKED");
  }

  return body;
}

/**
 * The provider's status enum, if it is one.
 *
 * The pattern is the guarantee: an all-caps identifier cannot be an echo of a
 * prompt, so this can be shown to an admin without reading the body.
 */
function safeStatus(body: GeminiResponse): string | undefined {
  const status = body.error?.status;
  if (typeof status !== "string" || !/^[A-Z][A-Z_]{2,40}$/.test(status)) return undefined;
  return `(${status})`;
}

/** The first candidate's text, or empty when there is none to read. */
export function extractText(body: GeminiResponse): string {
  const parts = body.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * JSON Schema, narrowed to what Gemini accepts.
 *
 * It rejects `additionalProperties`, `$schema` and a few other keywords with a
 * 400 rather than ignoring them, so they are removed here instead of every
 * caller having to write a second schema for this provider.
 */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const DROP = new Set(["additionalProperties", "$schema", "$id", "definitions", "default"]);

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (DROP.has(key)) continue;
      out[key] = walk(child);
    }
    return out;
  };

  return walk(schema) as Record<string, unknown>;
}
