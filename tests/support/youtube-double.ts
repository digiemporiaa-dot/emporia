import { createServer, type Server } from "node:http";

/**
 * A stand-in for Google's token endpoint, the YouTube Data API, its resumable
 * upload sessions — and the storage the video is read from.
 *
 * The media file is served from the same port so the real streaming path
 * runs: bytes are fetched from "storage" and piped into the upload session,
 * and the double counts how many arrived.
 */

export type YtRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: string;
  bytes: number;
};

export type YtRoute = "token" | "channels" | "session" | "upload" | "status" | "media" | "videos";

/** What an "are you finished?" query answers. */
export type SessionAnswer = "complete" | "incomplete" | "error" | "hang";

export type YouTubeDouble = {
  url: string;
  requests: YtRequest[];
  /** The size of the served video, in bytes. */
  videoSize: number;
  /** Scopes the token endpoint reports as granted. */
  grantedScopes: (scopes: string) => void;
  /** Leave the refresh token out of the next code exchange. */
  noRefreshTokenNext: () => void;
  /** The channel list is empty — a Google account with no channel. */
  noChannel: (value: boolean) => void;
  /** Privacy YouTube reports on the created video. */
  privacy: (value: string) => void;
  /** Receive the next upload, then never answer. */
  swallowNextUpload: () => void;
  /** How the next session status query answers. */
  sessionAnswer: (value: SessionAnswer) => void;
  /** Serve the media without a content length. */
  chunkedMedia: (value: boolean) => void;
  /** Hide the like count, as a channel may. */
  hideLikes: (value: boolean) => void;
  failWith: (route: YtRoute, status: number, body?: object) => void;
  close: () => Promise<void>;
};

const VIDEO_SIZE = 64 * 1024;

export async function startYouTubeDouble(): Promise<YouTubeDouble> {
  const requests: YtRequest[] = [];
  let scopes =
    "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
  let noRefresh = false;
  let noChannel = false;
  let privacy = "public";
  let swallow = false;
  let answer: SessionAnswer = "complete";
  let chunked = false;
  let hideLikes = false;
  let sessions = 0;
  const failures = new Map<YtRoute, { status: number; body: object }>();

  const video = () => ({
    kind: "youtube#video",
    id: "vid-1",
    status: { privacyStatus: privacy, uploadStatus: "uploaded" },
  });

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://double");
      const path = url.pathname;
      const method = req.method ?? "GET";
      const raw = Buffer.concat(chunks);
      const contentRange = req.headers["content-range"] as string | undefined;

      const route: YtRoute =
        path === "/token"
          ? "token"
          : path === "/youtube/v3/channels"
            ? "channels"
            : path === "/youtube/v3/videos"
              ? "videos"
              : path === "/upload/youtube/v3/videos"
                ? "session"
                : path.startsWith("/upload/session/")
                  ? contentRange?.startsWith("bytes */")
                    ? "status"
                    : "upload"
                  : "media";

      requests.push({
        method,
        path,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: {
          authorization: req.headers["authorization"] as string | undefined,
          "content-range": contentRange,
          "content-length": req.headers["content-length"] as string | undefined,
          "content-type": req.headers["content-type"] as string | undefined,
          "x-upload-content-length": req.headers["x-upload-content-length"] as string | undefined,
          "x-upload-content-type": req.headers["x-upload-content-type"] as string | undefined,
        },
        body: route === "upload" ? "" : raw.toString("utf8"),
        bytes: raw.length,
      });

      const json = (status: number, payload: object, headers: Record<string, string> = {}) =>
        res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(payload));

      const failure = failures.get(route);
      if (failure) {
        failures.delete(route);
        return json(failure.status, failure.body);
      }

      switch (route) {
        case "token": {
          const form = new URLSearchParams(raw.toString("utf8"));
          if (form.get("grant_type") === "refresh_token") {
            if (form.get("refresh_token") === "revoked") {
              return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
            }
            return json(200, { access_token: "yt-access-2", expires_in: 3599, scope: scopes, token_type: "Bearer" });
          }
          const payload: Record<string, unknown> = {
            access_token: "yt-access",
            expires_in: 3599,
            scope: scopes,
            token_type: "Bearer",
          };
          if (!noRefresh) payload["refresh_token"] = "yt-refresh";
          noRefresh = false;
          return json(200, payload);
        }

        case "channels":
          return json(200, {
            items: noChannel
              ? []
              : [
                  {
                    id: "UC123",
                    snippet: {
                      title: "Northwind Studio",
                      customUrl: "@northwindstudio",
                      thumbnails: { default: { url: "https://yt.example.com/avatar.jpg" } },
                    },
                  },
                ],
          });

        case "session":
          sessions += 1;
          return json(200, {}, { location: `http://${req.headers.host}/upload/session/s-${sessions}?upload_id=secret-${sessions}` });

        case "upload":
          if (swallow) {
            swallow = false;
            // Every byte arrived; the reply never does.
            setTimeout(() => res.destroy(), 5_000);
            return;
          }
          return json(200, video());

        case "status":
          if (answer === "hang") {
            setTimeout(() => res.destroy(), 5_000);
            return;
          }
          if (answer === "complete") return json(200, video());
          if (answer === "incomplete") {
            return res.writeHead(308, { range: "bytes=0-1023" }).end();
          }
          return json(500, { error: { code: 500, message: "backend error" } });

        case "media": {
          const bytes = Buffer.alloc(VIDEO_SIZE, 7);
          if (chunked) {
            res.writeHead(200, { "content-type": "video/mp4" });
            res.write(bytes);
            return res.end();
          }
          return res
            .writeHead(200, { "content-type": "video/mp4", "content-length": String(VIDEO_SIZE) })
            .end(bytes);
        }

        case "videos": {
          const id = url.searchParams.get("id");
          if (id !== "vid-1") return json(200, { items: [] });
          const statistics: Record<string, string> = { viewCount: "1520", commentCount: "7", favoriteCount: "0" };
          if (!hideLikes) statistics["likeCount"] = "48";
          return json(200, { items: [{ id, statistics }] });
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("double did not bind");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    videoSize: VIDEO_SIZE,
    grantedScopes: (value) => {
      scopes = value;
    },
    noRefreshTokenNext: () => {
      noRefresh = true;
    },
    noChannel: (value) => {
      noChannel = value;
    },
    privacy: (value) => {
      privacy = value;
    },
    swallowNextUpload: () => {
      swallow = true;
    },
    sessionAnswer: (value) => {
      answer = value;
    },
    chunkedMedia: (value) => {
      chunked = value;
    },
    hideLikes: (value) => {
      hideLikes = value;
    },
    failWith: (route, status, body = {}) => failures.set(route, { status, body }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
