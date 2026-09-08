import { createServer, type Server } from "node:http";

/**
 * A stand-in for the Gemini generateContent API, for tests only.
 *
 * It speaks the wire shape the real endpoint does, so `lib/ai/gemini.ts` — the
 * actual provider, with the real fetch — is exercised end to end rather than
 * stubbed. It records every request, which is how "the key travelled in the
 * header and not the URL" is checked.
 */

export type RecordedGeminiRequest = {
  path: string;
  apiKeyHeader: string | undefined;
  /** The whole URL as received, so a test can assert the key is not in it. */
  url: string;
  prompt: string;
  system: string;
  temperature: number | undefined;
  maxOutputTokens: number | undefined;
  responseSchema: unknown;
};

export type GeminiDouble = {
  url: string;
  requests: RecordedGeminiRequest[];
  /** What the next call returns as the candidate's text. */
  reply: (text: string) => void;
  /** Reply with a body that has no candidates at all. */
  replyEmpty: () => void;
  /** Reply as Gemini does when it refuses a prompt. */
  replyBlocked: (reason?: string) => void;
  /** Make the next call fail with this status and body. */
  failWith: (status: number, body: string) => void;
  /** Hang, so the caller's timeout is what ends the request. */
  hang: () => void;
  close: () => Promise<void>;
};

export async function startGeminiDouble(): Promise<GeminiDouble> {
  const requests: RecordedGeminiRequest[] = [];
  let nextText = "OK";
  let mode: "text" | "empty" | "blocked" | "hang" = "text";
  let blockReason = "SAFETY";
  let failure: { status: number; body: string } | null = null;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const contents = (body["contents"] ?? []) as {
        parts?: { text?: string }[];
      }[];
      const system = (body["systemInstruction"] ?? {}) as { parts?: { text?: string }[] };
      const generation = (body["generationConfig"] ?? {}) as Record<string, unknown>;

      requests.push({
        path: req.url ?? "",
        url: `http://${req.headers.host ?? "localhost"}${req.url ?? ""}`,
        apiKeyHeader: req.headers["x-goog-api-key"] as string | undefined,
        prompt: contents[0]?.parts?.[0]?.text ?? "",
        system: system.parts?.[0]?.text ?? "",
        temperature: generation["temperature"] as number | undefined,
        maxOutputTokens: generation["maxOutputTokens"] as number | undefined,
        responseSchema: generation["responseSchema"],
      });

      if (mode === "hang") return; // never responds; the client's timeout ends it

      if (failure) {
        const { status, body: text } = failure;
        failure = null;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(text);
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });

      if (mode === "empty") {
        res.end(JSON.stringify({ candidates: [] }));
        return;
      }
      if (mode === "blocked") {
        res.end(JSON.stringify({ promptFeedback: { blockReason } }));
        return;
      }

      res.end(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: nextText }], role: "model" }, finishReason: "STOP" },
          ],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("double failed to bind");

  return {
    url: `http://127.0.0.1:${address.port}/v1beta`,
    requests,
    reply: (text) => {
      mode = "text";
      nextText = text;
    },
    replyEmpty: () => {
      mode = "empty";
    },
    replyBlocked: (reason = "SAFETY") => {
      mode = "blocked";
      blockReason = reason;
    },
    failWith: (status, body) => {
      failure = { status, body };
    },
    hang: () => {
      mode = "hang";
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
