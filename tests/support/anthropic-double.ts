import { createServer, type Server } from "node:http";

/**
 * A stand-in for the Anthropic Messages API, for tests and verification only.
 *
 * It speaks the wire shape the real SDK expects, so `lib/ai/anthropic.ts` — the
 * actual provider, with the real SDK — is exercised end to end rather than
 * stubbed. It records every request so a test can assert what was sent, which
 * is how "the prompt carried the real figures" is checked.
 */

export type RecordedRequest = {
  model: string;
  system: string;
  prompt: string;
  effort: string | undefined;
  format: unknown;
  maxTokens: number;
  authorization: string | undefined;
};

export type AnthropicDouble = {
  url: string;
  requests: RecordedRequest[];
  /** What the next call returns. A string for text, an object for structured. */
  reply: (value: string | object) => void;
  /** Make the next call fail with this status. */
  failWith: (status: number, body: string) => void;
  close: () => Promise<void>;
};

export async function startAnthropicDouble(): Promise<AnthropicDouble> {
  const requests: RecordedRequest[] = [];
  let nextReply: string | object = "A drafted reply.";
  let failure: { status: number; body: string } | null = null;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (failure) {
        const { status, body } = failure;
        failure = null;
        res.writeHead(status, { "content-type": "application/json" }).end(body);
        return;
      }

      const body = JSON.parse(raw || "{}") as {
        model?: string;
        max_tokens?: number;
        system?: { text?: string }[] | string;
        output_config?: { effort?: string; format?: unknown };
        messages?: { role: string; content: string }[];
      };

      const system = Array.isArray(body.system)
        ? (body.system[0]?.text ?? "")
        : (body.system ?? "");

      requests.push({
        model: body.model ?? "",
        system,
        prompt: body.messages?.[0]?.content ?? "",
        effort: body.output_config?.effort,
        format: body.output_config?.format,
        maxTokens: body.max_tokens ?? 0,
        authorization: (req.headers["x-api-key"] as string | undefined) ?? undefined,
      });

      const text = typeof nextReply === "string" ? nextReply : JSON.stringify(nextReply);

      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "msg_double",
          type: "message",
          role: "assistant",
          model: body.model ?? "claude-opus-5",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 120, output_tokens: 45 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("double did not bind");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    reply: (value) => {
      nextReply = value;
    },
    failWith: (status, body) => {
      failure = { status, body };
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
