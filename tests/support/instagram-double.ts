import { createServer, type Server } from "node:http";

/**
 * A stand-in for Instagram's login and Graph endpoints.
 *
 * Same approach as `linkedin-double.ts`: speak the wire protocol so the *real*
 * adapter — its URL building, its container flow, its polling, its error
 * mapping — runs end to end. Only the hosts move.
 *
 * Containers are numbered `c-1`, `c-2`…; the published media is `m-1`. That
 * prefix is how a GET is routed to "container status" or "media fields".
 */

export type IgRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: string;
  authorization: string | undefined;
};

export type IgRoute =
  | "shortToken"
  | "exchange"
  | "refresh"
  | "me"
  | "container"
  | "status"
  | "publish"
  | "media"
  | "comments"
  | "insights";

export type InstagramDouble = {
  url: string;
  requests: IgRequest[];
  /** Replace the /me response. */
  profile: (value: object) => void;
  /** The next N status checks answer IN_PROGRESS before FINISHED. */
  processingFor: (checks: number) => void;
  /** The next status check answers this final status instead. */
  statusOnce: (status: "ERROR" | "EXPIRED") => void;
  /** Make the next request of a kind fail. */
  failWith: (route: IgRoute, status: number, body?: object) => void;
  /** Accept the next publish and never answer — the reply is lost. */
  swallowNextPublish: () => void;
  /** Answer the next publish with no id. */
  publishWithoutId: () => void;
  close: () => Promise<void>;
};

export async function startInstagramDouble(): Promise<InstagramDouble> {
  const requests: IgRequest[] = [];
  let profile: object = {
    user_id: "17841400000000001",
    username: "northwind.studio",
    name: "Northwind Studio",
    profile_picture_url: "https://example.com/ig-avatar.jpg",
    account_type: "BUSINESS",
  };
  let processing = 0;
  let finalStatus: "ERROR" | "EXPIRED" | null = null;
  let containerCount = 0;
  let swallow = false;
  let noId = false;
  const failures = new Map<IgRoute, { status: number; body: object }>();

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://double");
      const path = url.pathname;
      const query = Object.fromEntries(url.searchParams.entries());
      const method = req.method ?? "GET";
      requests.push({
        method,
        path,
        query,
        body: raw,
        authorization: req.headers["authorization"] as string | undefined,
      });

      const graphPath = path.replace(/^\/v[\d.]+/, "");
      const route: IgRoute =
        path === "/oauth/access_token"
          ? "shortToken"
          : path === "/access_token"
            ? "exchange"
            : path === "/refresh_access_token"
              ? "refresh"
              : graphPath === "/me"
                ? "me"
                : graphPath === "/me/media"
                  ? "container"
                  : graphPath === "/me/media_publish"
                    ? "publish"
                    : graphPath.endsWith("/comments")
                      ? "comments"
                      : graphPath.endsWith("/insights")
                        ? "insights"
                        : graphPath.startsWith("/c-")
                          ? "status"
                          : "media";

      const json = (status: number, body: object) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

      const failure = failures.get(route);
      if (failure) {
        failures.delete(route);
        json(failure.status, failure.body);
        return;
      }

      switch (route) {
        case "shortToken":
          return json(200, { access_token: "ig-short-token", user_id: 17841400000000001 });
        case "exchange":
          return json(200, { access_token: "ig-long-token", token_type: "bearer", expires_in: 5_184_000 });
        case "refresh":
          return json(200, { access_token: "ig-refreshed-token", token_type: "bearer", expires_in: 5_184_000 });
        case "me":
          return json(200, profile);
        case "container":
          containerCount += 1;
          return json(200, { id: `c-${containerCount}` });
        case "status":
          if (finalStatus) {
            const status = finalStatus;
            finalStatus = null;
            return json(200, { status_code: status });
          }
          if (processing > 0) {
            processing -= 1;
            return json(200, { status_code: "IN_PROGRESS" });
          }
          return json(200, { status_code: "FINISHED" });
        case "publish":
          if (swallow) {
            swallow = false;
            setTimeout(() => res.destroy(), 5_000);
            return;
          }
          if (noId) {
            noId = false;
            return json(200, {});
          }
          return json(200, { id: "m-1" });
        case "comments":
          return json(200, { id: "comment-1" });
        case "insights":
          return json(200, {
            data: [
              { name: "reach", values: [{ value: 420 }] },
              { name: "saved", values: [{ value: 9 }] },
              { name: "shares", values: [{ value: 4 }] },
            ],
          });
        case "media":
          if (query["fields"]?.includes("permalink")) {
            return json(200, { permalink: "https://www.instagram.com/p/DOUBLE123/" });
          }
          return json(200, { like_count: 57, comments_count: 6 });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("double did not bind");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    profile: (value) => {
      profile = value;
    },
    processingFor: (checks) => {
      processing = checks;
    },
    statusOnce: (status) => {
      finalStatus = status;
    },
    failWith: (route, status, body = {}) => failures.set(route, { status, body }),
    swallowNextPublish: () => {
      swallow = true;
    },
    publishWithoutId: () => {
      noId = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
