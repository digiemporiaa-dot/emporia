import { createServer, type Server } from "node:http";

/**
 * A stand-in for X's OAuth 2.0 token endpoint, the v2 API, the v2 chunked
 * media upload — and storage, so the real streamed upload runs.
 *
 * Refresh tokens behave as X's do: **single-use and rotating**. Each renewal
 * spends the presented token and issues the next; presenting a spent one is
 * refused. That is what the credential service's lock is tested against.
 */

export type XRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: string;
  bytes: number;
};

export type XRoute = "token" | "me" | "init" | "append" | "finalize" | "status" | "tweets" | "media";

export type XDouble = {
  url: string;
  requests: XRequest[];
  imageSize: number;
  videoSize: number;
  /** The PKCE verifier the token endpoint will accept. */
  expectVerifier: (verifier: string) => void;
  /** Scopes reported as granted. */
  grantedScopes: (scopes: string) => void;
  /** Hold each refresh this long, to let two collide. */
  refreshDelay: (ms: number) => void;
  refreshCount: () => number;
  /** How video processing ends. */
  processing: (outcome: "succeeds" | "fails" | "never") => void;
  swallowNextTweet: () => void;
  emptyNextTweet: () => void;
  failWith: (route: XRoute, status: number, body?: object, headers?: Record<string, string>) => void;
  close: () => Promise<void>;
};

const IMAGE_SIZE = 200 * 1024;
const VIDEO_SIZE = 9 * 1024 * 1024;

export async function startXDouble(): Promise<XDouble> {
  const requests: XRequest[] = [];
  let verifier = "";
  let scopes = "tweet.read tweet.write users.read media.write offline.access";
  let delay = 0;
  let refreshes = 0;
  let generation = 1;
  const spent = new Set<string>();
  let outcome: "succeeds" | "fails" | "never" = "succeeds";
  const statusChecks = new Map<string, number>();
  let mediaCount = 0;
  let swallow = false;
  let empty = false;
  const failures = new Map<XRoute, { status: number; body: object; headers: Record<string, string> }>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://double");
      const path = url.pathname;
      const method = req.method ?? "GET";
      const raw = Buffer.concat(chunks);

      const route: XRoute =
        path === "/2/oauth2/token"
          ? "token"
          : path === "/2/users/me"
            ? "me"
            : path === "/2/media/upload/initialize"
              ? "init"
              : /^\/2\/media\/upload\/[^/]+\/append$/.test(path)
                ? "append"
                : /^\/2\/media\/upload\/[^/]+\/finalize$/.test(path)
                  ? "finalize"
                  : path === "/2/media/upload"
                    ? "status"
                    : path === "/2/tweets"
                      ? "tweets"
                      : "media";

      requests.push({
        method,
        path,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: {
          authorization: req.headers["authorization"] as string | undefined,
          "content-type": req.headers["content-type"] as string | undefined,
        },
        body: route === "append" ? (raw.toString("latin1").match(/name="segment_index"\r\n\r\n(\d+)/)?.[1] ?? "") : raw.toString("utf8"),
        bytes: raw.length,
      });

      const json = (status: number, payload: object, headers: Record<string, string> = {}) =>
        res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(payload));

      const failure = failures.get(route);
      if (failure) {
        failures.delete(route);
        return json(failure.status, failure.body, failure.headers);
      }

      switch (route) {
        case "token": {
          const basic = Buffer.from("x-client:x-secret").toString("base64");
          if (req.headers["authorization"] !== `Basic ${basic}`) {
            return json(401, { error: "unauthorized_client" });
          }
          const form = new URLSearchParams(raw.toString("utf8"));
          const issue = () => {
            generation += 1;
            return {
              token_type: "bearer",
              expires_in: 7200,
              access_token: `x-access-${generation}`,
              refresh_token: `x-refresh-${generation}`,
              scope: scopes,
            };
          };
          if (form.get("grant_type") === "authorization_code") {
            if (form.get("code_verifier") !== verifier) {
              return json(400, { error: "invalid_request", error_description: "Value passed for the code verifier did not match." });
            }
            return json(200, issue());
          }
          const presented = form.get("refresh_token") ?? "";
          if (spent.has(presented) || !presented.startsWith("x-refresh-")) {
            return json(400, { error: "invalid_request", error_description: "Value passed for the token was invalid." });
          }
          spent.add(presented);
          refreshes += 1;
          const payload = issue();
          setTimeout(() => json(200, payload), delay);
          return;
        }

        case "me":
          return json(200, { data: { id: "4401", name: "Northwind Studio", username: "northwind", profile_image_url: "https://pbs.example.com/a.jpg" } });

        case "media": {
          const video = path.endsWith(".mp4");
          const size = video ? VIDEO_SIZE : IMAGE_SIZE;
          return res
            .writeHead(200, { "content-type": video ? "video/mp4" : "image/jpeg", "content-length": String(size) })
            .end(Buffer.alloc(size, 3));
        }

        case "init":
          mediaCount += 1;
          return json(200, { data: { id: `m-${mediaCount}`, media_key: `7_m-${mediaCount}`, expires_after_secs: 86400 } });

        case "append":
          return res.writeHead(204).end();

        case "finalize": {
          const id = path.split("/")[4]!;
          const init = requests.filter((r) => r.path === "/2/media/upload/initialize").at(-1);
          const isVideo = init !== undefined && JSON.parse(init.body).media_category === "tweet_video";
          if (!isVideo) return json(200, { data: { id, media_key: `7_${id}` } });
          return json(200, { data: { id, processing_info: { state: "pending", check_after_secs: 1 } } });
        }

        case "status": {
          const id = url.searchParams.get("media_id") ?? "";
          const n = (statusChecks.get(id) ?? 0) + 1;
          statusChecks.set(id, n);
          if (outcome === "fails") {
            return json(200, { data: { id, processing_info: { state: "failed", error: { code: 1, message: "InvalidMedia" } } } });
          }
          if (outcome === "never" || n < 2) {
            return json(200, { data: { id, processing_info: { state: "in_progress", check_after_secs: 1, progress_percent: 40 } } });
          }
          return json(200, { data: { id, processing_info: { state: "succeeded", progress_percent: 100 } } });
        }

        case "tweets":
          if (swallow) {
            swallow = false;
            setTimeout(() => res.destroy(), 5_000);
            return;
          }
          if (empty) {
            empty = false;
            return json(201, {});
          }
          return json(201, { data: { id: "1790000000000000001", text: JSON.parse(raw.toString("utf8")).text } });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("double did not bind");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    imageSize: IMAGE_SIZE,
    videoSize: VIDEO_SIZE,
    expectVerifier: (value) => {
      verifier = value;
    },
    grantedScopes: (value) => {
      scopes = value;
    },
    refreshDelay: (ms) => {
      delay = ms;
    },
    refreshCount: () => refreshes,
    processing: (value) => {
      outcome = value;
    },
    swallowNextTweet: () => {
      swallow = true;
    },
    emptyNextTweet: () => {
      empty = true;
    },
    failWith: (route, status, body = {}, headers = {}) => failures.set(route, { status, body, headers }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
