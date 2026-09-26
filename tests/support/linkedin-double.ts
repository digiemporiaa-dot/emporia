import { createServer, type Server } from "node:http";

/**
 * A stand-in for LinkedIn's OAuth and profile endpoints.
 *
 * The same approach `tests/support/anthropic-double.ts` takes for the AI
 * provider: speak the wire protocol so the *real* adapter — its URL building,
 * its form encoding, its response parsing, its error mapping — is exercised
 * end to end. Only the host moves.
 */

export type RecordedRequest = {
  path: string;
  method: string;
  body: string;
  authorization: string | undefined;
  contentType: string | undefined;
};

export type LinkedInDouble = {
  url: string;
  requests: RecordedRequest[];
  /** Replace the token response for the next exchange or refresh. */
  token: (value: object) => void;
  /** Replace the profile response. */
  profile: (value: object) => void;
  /** Make the next request of a kind fail. */
  failWith: (path: "accessToken" | "userinfo", status: number, body?: string) => void;
  close: () => Promise<void>;
};

export async function startLinkedInDouble(): Promise<LinkedInDouble> {
  const requests: RecordedRequest[] = [];
  let tokenResponse: object = {
    access_token: "li-access-token",
    refresh_token: "li-refresh-token",
    expires_in: 5_184_000,
  };
  let profileResponse: object = {
    sub: "li-member-1",
    name: "Priya Raman",
    given_name: "Priya",
    family_name: "Raman",
    picture: "https://example.com/avatar.jpg",
  };
  const failures = new Map<string, { status: number; body: string }>();

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      requests.push({
        path,
        method: req.method ?? "GET",
        body: raw,
        authorization: req.headers["authorization"] as string | undefined,
        contentType: req.headers["content-type"] as string | undefined,
      });

      const kind = path.endsWith("/accessToken") ? "accessToken" : "userinfo";
      const failure = failures.get(kind);
      if (failure) {
        failures.delete(kind);
        res.writeHead(failure.status, { "content-type": "application/json" }).end(failure.body);
        return;
      }

      const payload = kind === "accessToken" ? tokenResponse : profileResponse;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("double did not bind");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    token: (value) => {
      tokenResponse = value;
    },
    profile: (value) => {
      profileResponse = value;
    },
    failWith: (path, status, body = "{}") => failures.set(path, { status, body }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
