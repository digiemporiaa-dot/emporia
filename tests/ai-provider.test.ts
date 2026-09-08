import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GeminiProvider, toGeminiSchema } from "@/lib/ai/gemini";
import { AIError } from "@/lib/ai/errors";
import { AI_PROVIDERS, PROVIDER_CATALOG, isProviderId, providerLabel } from "@/lib/ai/catalog";
import { aiSettingsSchema, aiTestSchema } from "@/lib/validation/ai-settings";
import { startGeminiDouble, type GeminiDouble } from "./support/gemini-double";

/**
 * The Gemini provider, against a double that speaks the real wire shape.
 *
 * The provider itself is exercised — the real fetch, the real request body, the
 * real response parsing — rather than stubbed, so a test passing means the code
 * that ships works. Only the network endpoint is replaced.
 */

let double: GeminiDouble;

function provider(overrides: Partial<ConstructorParameters<typeof GeminiProvider>[0]> = {}) {
  return new GeminiProvider({
    apiKey: "test-key-value",
    model: "gemini-flash-latest",
    baseUrl: double.url,
    temperature: 0.7,
    maxOutputTokens: 2048,
    timeoutMs: 2_000,
    ...overrides,
  });
}

const request = {
  task: "generateContent" as const,
  system: "You are helping.",
  prompt: "Reply with exactly: OK",
};

beforeAll(async () => {
  double = await startGeminiDouble();
});

afterAll(async () => {
  await double.close();
});

beforeEach(() => {
  double.requests.length = 0;
  double.reply("OK");
});

describe("the request Gemini receives", () => {
  it("posts to the generateContent endpoint for the configured model", async () => {
    await provider().complete(request);
    expect(double.requests[0]?.path).toBe("/v1beta/models/gemini-flash-latest:generateContent");
  });

  it("sends the key as a header and never in the URL", async () => {
    await provider().complete(request);
    const sent = double.requests[0]!;
    expect(sent.apiKeyHeader).toBe("test-key-value");
    // A URL is the part that ends up in proxy logs and error reports.
    expect(sent.url).not.toContain("test-key-value");
  });

  it("keeps the system instruction out of the user turn", async () => {
    await provider().complete(request);
    const sent = double.requests[0]!;
    expect(sent.system).toBe("You are helping.");
    expect(sent.prompt).toBe("Reply with exactly: OK");
  });

  it("passes the configured temperature and token ceiling", async () => {
    await provider({ temperature: 0.2, maxOutputTokens: 512 }).complete(request);
    expect(double.requests[0]).toMatchObject({ temperature: 0.2, maxOutputTokens: 512 });
  });

  it("lets one request ask for fewer tokens than the ceiling", async () => {
    await provider().complete({ ...request, maxTokens: 32 });
    expect(double.requests[0]?.maxOutputTokens).toBe(32);
  });

  it("tolerates a base URL with a trailing slash", async () => {
    await provider({ baseUrl: `${double.url}/` }).complete(request);
    expect(double.requests[0]?.path).toBe("/v1beta/models/gemini-flash-latest:generateContent");
  });

  it("escapes the model into the path", async () => {
    await provider({ model: "models/../evil" }).complete(request).catch(() => undefined);
    expect(double.requests[0]?.path).not.toContain("../");
  });
});

describe("reading the reply", () => {
  it("returns the candidate's text and its token usage", async () => {
    double.reply("OK");
    const result = await provider().complete(request);
    expect(result.text).toBe("OK");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    // The version Google resolved the alias to, not the alias that was asked
    // for — otherwise nobody can tell which model actually answered.
    expect(result.model).toBe("gemini-2.5-flash-002");
  });

  it("falls back to the configured name when the provider names no version", async () => {
    double.replyWithoutVersion("OK");
    expect((await provider().complete(request)).model).toBe("gemini-flash-latest");
  });

  it("refuses a reply with no candidates rather than returning nothing", async () => {
    double.replyEmpty();
    await expect(provider().complete(request)).rejects.toMatchObject({
      reason: "AI_INVALID_RESPONSE",
    });
  });

  it("reports a blocked prompt as its own reason", async () => {
    double.replyBlocked();
    await expect(provider().complete(request)).rejects.toMatchObject({
      reason: "AI_CONTENT_BLOCKED",
    });
  });

  it("refuses prose where an object was asked for", async () => {
    double.reply("Sorry, here is a sentence instead.");
    await expect(
      provider().completeStructured({
        ...request,
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
        parse: (value) => value as { ok: boolean },
      }),
    ).rejects.toMatchObject({ reason: "AI_INVALID_RESPONSE" });
  });

  it("hands a structured reply to the caller's own parser", async () => {
    double.reply(JSON.stringify({ ok: true }));
    const result = await provider().completeStructured({
      ...request,
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      parse: (value) => {
        const parsed = value as { ok: boolean };
        if (typeof parsed.ok !== "boolean") throw new Error("wrong shape");
        return parsed;
      },
    });
    expect(result.data).toEqual({ ok: true });
  });
});

describe("failures, mapped onto shared reasons", () => {
  it.each([
    [401, "AI_INVALID_API_KEY"],
    [403, "AI_INVALID_API_KEY"],
    [404, "AI_MODEL_UNAVAILABLE"],
    [429, "AI_RATE_LIMITED"],
    [500, "AI_PROVIDER_ERROR"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    double.failWith(status, JSON.stringify({ error: { message: "nope" } }));
    await expect(provider().complete(request)).rejects.toMatchObject({ reason });
  });

  it("passes through the provider's status enum, which helps and cannot leak", async () => {
    double.failWith(
      429,
      JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }),
    );
    await expect(provider().complete(request)).rejects.toSatisfy((error: AIError) =>
      error.publicMessage.includes("RESOURCE_EXHAUSTED"),
    );
  });

  it("ignores a status that is not a plain enum", async () => {
    // Anything that could carry content is dropped rather than shown.
    double.failWith(
      429,
      JSON.stringify({ error: { status: "your prompt was: secret text", message: "x" } }),
    );
    await expect(provider().complete(request)).rejects.toSatisfy(
      (error: AIError) => !error.publicMessage.includes("secret"),
    );
  });

  it("never surfaces the provider's own message", async () => {
    // The body can echo the request, and the request contains the prompt.
    double.failWith(400, JSON.stringify({ error: { message: "API key AIzaSecret is invalid" } }));
    await expect(provider().complete(request)).rejects.toSatisfy(
      (error: AIError) => !error.publicMessage.includes("AIzaSecret"),
    );
  });

  it("times out rather than hanging forever", async () => {
    double.hang();
    await expect(provider({ timeoutMs: 300 }).complete(request)).rejects.toMatchObject({
      reason: "AI_REQUEST_TIMEOUT",
    });
    double.reply("OK");
  });

  it("reports an unreachable provider rather than crashing", async () => {
    const unreachable = provider({ baseUrl: "http://127.0.0.1:1/v1beta", timeoutMs: 500 });
    await expect(unreachable.complete(request)).rejects.toMatchObject({
      reason: "AI_PROVIDER_ERROR",
    });
  });
});

describe("the JSON schema Gemini is given", () => {
  it("strips the keywords Gemini rejects", () => {
    const cleaned = toGeminiSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        nested: { type: "object", additionalProperties: false, properties: { a: { type: "string" } } },
        list: { type: "array", items: { type: "object", additionalProperties: false } },
      },
    });

    const serialised = JSON.stringify(cleaned);
    expect(serialised).not.toContain("additionalProperties");
    expect(serialised).not.toContain("$schema");
    // Everything else survives, including through arrays and nesting.
    expect(serialised).toContain('"nested"');
    expect(serialised).toContain('"items"');
  });

  it("is sent when a structured reply is asked for", async () => {
    double.reply(JSON.stringify({ ok: true }));
    await provider().completeStructured({
      ...request,
      schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } } },
      parse: (value) => value as { ok: boolean },
    });
    expect(double.requests[0]?.responseSchema).toBeDefined();
    expect(JSON.stringify(double.requests[0]?.responseSchema)).not.toContain(
      "additionalProperties",
    );
  });
});

describe("the provider catalog", () => {
  it("has a definition for every provider it offers", () => {
    for (const id of AI_PROVIDERS) {
      const entry = PROVIDER_CATALOG[id];
      expect(entry.defaultModel, id).toBeTruthy();
      expect(entry.defaultBaseUrl, id).toMatch(/^https:\/\//);
      expect(entry.suggestedModels.length, id).toBeGreaterThan(0);
    }
  });

  it("defaults Gemini to the documented endpoint and model", () => {
    expect(PROVIDER_CATALOG.gemini.defaultBaseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    expect(PROVIDER_CATALOG.gemini.defaultModel).toBe("gemini-flash-latest");
  });

  it("recognises only what it implements", () => {
    expect(isProviderId("gemini")).toBe(true);
    expect(isProviderId("anthropic")).toBe(true);
    expect(isProviderId("openai")).toBe(false);
    expect(providerLabel("gemini")).toBe("Google Gemini");
  });
});

describe("settings validation", () => {
  const valid = {
    enabled: true,
    provider: "gemini",
    model: "gemini-flash-latest",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    temperature: 0.7,
    maxOutputTokens: 2048,
  };

  it("accepts a Gemini configuration", () => {
    expect(aiSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["file", "file:///etc/passwd"],
    ["data", "data:text/plain,hello"],
    ["not a URL", "generativelanguage.googleapis.com"],
    ["credentials in the URL", "https://user:key@example.com/v1"],
  ])("refuses %s as a base URL", (_label, baseUrl) => {
    expect(aiSettingsSchema.safeParse({ ...valid, baseUrl }).success).toBe(false);
  });

  it("allows a local http endpoint, for a proxy or a test double", () => {
    expect(
      aiSettingsSchema.safeParse({ ...valid, baseUrl: "http://127.0.0.1:8080/v1beta" }).success,
    ).toBe(true);
  });

  it("refuses a provider it does not implement", () => {
    expect(aiSettingsSchema.safeParse({ ...valid, provider: "openai" }).success).toBe(false);
  });

  it("accepts any model name, so a new release needs no deploy", () => {
    for (const model of ["gemini-3.0-ultra", "models/gemini-x", "claude-opus-9"]) {
      expect(aiSettingsSchema.safeParse({ ...valid, model }).success, model).toBe(true);
    }
  });

  it("refuses a model name carrying anything but a name", () => {
    for (const model of ["", "a b", "../etc", "<script>"]) {
      expect(aiSettingsSchema.safeParse({ ...valid, model }).success, model).toBe(false);
    }
  });

  it("bounds temperature and the token ceiling", () => {
    expect(aiSettingsSchema.safeParse({ ...valid, temperature: -1 }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ ...valid, temperature: 9 }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ ...valid, maxOutputTokens: 0 }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ ...valid, maxOutputTokens: 10_000_000 }).success).toBe(
      false,
    );
  });

  it("lets Test Connection run without a key, to use the stored one", () => {
    const { enabled: _enabled, ...rest } = valid;
    const parsed = aiTestSchema.safeParse({ ...rest, apiKey: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.apiKey).toBeUndefined();
  });
});
