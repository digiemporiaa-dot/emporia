import { createServer, type Server } from "node:http";

/**
 * A stand-in for Facebook's login, Graph, video and reel-upload hosts.
 *
 * Same approach as the LinkedIn and Instagram doubles: speak the wire protocol
 * so the real adapter runs end to end, and move only the hosts. All four hosts
 * are served from one port; paths are what tell them apart.
 *
 * Tokens: the user token is `fb-long-user`; a Page's token is
 * `page-token-<pageId>`. `/me` answers as the Page when called with a Page
 * token, which is how Graph behaves.
 */

export type FbRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: string;
  headers: Record<string, string | undefined>;
};

export type FbRoute =
  | "token"
  | "accounts"
  | "permissions"
  | "page"
  | "me"
  | "feed"
  | "photos"
  | "videos"
  | "reelStart"
  | "reelFinish"
  | "rupload"
  | "object"
  | "insights";

export type FbPage = {
  id: string;
  name: string;
  username?: string;
  tasks: string[];
};

export type FacebookDouble = {
  url: string;
  requests: FbRequest[];
  pages: (value: FbPage[]) => void;
  /** Split `/me/accounts` into pages of this size. */
  pageSize: (size: number) => void;
  /** The rows `/me/permissions` answers with: what the person allowed and declined. */
  permissions: (rows: { permission: string; status: "granted" | "declined" }[]) => void;
  /** What `/{videoId}?fields=post_id` answers. */
  videoPost: (postId: string | null) => void;
  /** Make the next request of a kind fail. */
  failWith: (route: FbRoute, status: number, body?: object) => void;
  /** Make every request for one insight metric fail. */
  failMetric: (metric: string, status: number, body?: object) => void;
  /** Accept the next request of a kind and never answer. */
  swallowNext: (route: FbRoute) => void;
  /** Answer the next request of a kind with an empty object. */
  emptyNext: (route: FbRoute) => void;
  /** Leave `shares` off the next engagement read, as Graph does with no shares. */
  noSharesNext: () => void;
  close: () => Promise<void>;
};

const DEFAULT_PAGES: FbPage[] = [
  { id: "1001", name: "Northwind Studio", username: "northwindstudio", tasks: ["ANALYZE", "CREATE_CONTENT", "MODERATE"] },
  { id: "1002", name: "Northwind Outlet", tasks: ["ANALYZE", "CREATE_CONTENT"] },
  // Can see it, cannot post to it: must never be offered.
  { id: "1003", name: "Moderated Only", tasks: ["ANALYZE", "MODERATE"] },
];

export async function startFacebookDouble(): Promise<FacebookDouble> {
  const requests: FbRequest[] = [];
  let pages = DEFAULT_PAGES;
  let size = 100;
  let videoPostId: string | null = null;
  let permissionRows: { permission: string; status: "granted" | "declined" }[] = [
    { permission: "pages_show_list", status: "granted" },
    { permission: "pages_read_engagement", status: "granted" },
    { permission: "pages_manage_posts", status: "granted" },
    { permission: "read_insights", status: "granted" },
    { permission: "public_profile", status: "granted" },
  ];
  let photoCount = 0;
  let noShares = false;
  const failures = new Map<FbRoute, { status: number; body: object }>();
  const metricFailures = new Map<string, { status: number; body: object }>();
  const swallow = new Set<FbRoute>();
  const empty = new Set<FbRoute>();

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
        headers: {
          authorization: req.headers["authorization"] as string | undefined,
          file_url: req.headers["file_url"] as string | undefined,
        },
      });

      const body = (() => {
        try {
          return JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          return {};
        }
      })();
      const token = String(query["access_token"] ?? body["access_token"] ?? "");

      const graph = path.replace(/^\/v[\d.]+/, "");
      const route: FbRoute =
        path.startsWith("/video-upload/")
          ? "rupload"
          : graph === "/oauth/access_token"
            ? "token"
            : graph === "/me/accounts"
              ? "accounts"
              : graph === "/me/permissions"
                ? "permissions"
              : graph === "/me"
                ? "me"
                : graph.endsWith("/feed")
                  ? "feed"
                  : graph.endsWith("/photos")
                    ? "photos"
                    : graph.endsWith("/videos")
                      ? "videos"
                      : graph.endsWith("/video_reels")
                        ? body["upload_phase"] === "start"
                          ? "reelStart"
                          : "reelFinish"
                        : graph.endsWith("/insights")
                          ? "insights"
                          : /^\/\d+$/.test(graph) && query["fields"]?.includes("access_token")
                            ? "page"
                            : "object";

      const json = (status: number, payload: object) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));

      if (swallow.has(route)) {
        swallow.delete(route);
        setTimeout(() => res.destroy(), 5_000);
        return;
      }
      const failure = failures.get(route);
      if (failure) {
        failures.delete(route);
        return json(failure.status, failure.body);
      }
      if (empty.has(route)) {
        empty.delete(route);
        return json(200, {});
      }

      const pageFor = (id: string) => pages.find((p) => p.id === id);
      const pageJson = (p: FbPage) => ({
        id: p.id,
        name: p.name,
        ...(p.username ? { username: p.username } : {}),
        link: `https://www.facebook.com/${p.username ?? p.id}`,
        picture: { data: { url: `https://example.com/${p.id}.jpg` } },
      });

      switch (route) {
        case "token":
          return query["grant_type"] === "fb_exchange_token"
            ? json(200, { access_token: "fb-long-user", token_type: "bearer", expires_in: 5_183_944 })
            : json(200, { access_token: "fb-short-user", token_type: "bearer", expires_in: 3_600 });

        case "accounts": {
          const start = query["after"] ? Number(query["after"]) : 0;
          const slice = pages.slice(start, start + size);
          const more = start + size < pages.length;
          return json(200, {
            data: slice.map((p) => ({ ...pageJson(p), tasks: p.tasks, access_token: `page-token-${p.id}` })),
            paging: {
              cursors: { before: String(start), after: String(start + size) },
              ...(more ? { next: "https://graph.facebook.com/next-page" } : {}),
            },
          });
        }

        case "permissions":
          return json(200, { data: permissionRows });

        case "page": {
          const p = pageFor(graph.slice(1));
          if (!p) return json(400, { error: { message: "Unsupported get request", code: 100 } });
          return json(200, { ...pageJson(p), access_token: `page-token-${p.id}` });
        }

        case "me": {
          const p = pageFor(token.replace("page-token-", ""));
          if (!p) return json(400, { error: { message: "not a page token", code: 100 } });
          return json(200, pageJson(p));
        }

        case "feed":
          return json(200, { id: `${graph.split("/")[1]}_900` });

        case "photos":
          photoCount += 1;
          return body["published"] === false
            ? json(200, { id: `photo-${photoCount}` })
            : json(200, { id: `photo-${photoCount}`, post_id: `${graph.split("/")[1]}_901` });

        case "videos":
          return json(200, { id: "7001" });

        case "reelStart":
          return json(200, { video_id: "8001", upload_url: "https://rupload.facebook.com/video-upload/v26.0/8001" });

        case "rupload":
          return json(200, { success: true });

        case "reelFinish":
          return json(200, { success: true });

        case "insights": {
          const metric = query["metric"] ?? "";
          const failed = metricFailures.get(metric);
          // A status of 0 clears the failure.
          if (failed && failed.status > 0) return json(failed.status, failed.body);
          const value = metric === "post_impressions_unique" ? 800 : metric === "post_clicks" ? 37 : 0;
          return json(200, { data: [{ name: metric, period: "lifetime", values: [{ value }] }] });
        }

        case "object": {
          const fields = query["fields"] ?? "";
          const id = graph.slice(1);
          if (fields === "permalink_url") {
            return json(200, {
              permalink_url: /^\d+$/.test(id)
                ? `/northwindstudio/videos/${id}/`
                : `https://www.facebook.com/${id.replace("_", "/posts/")}`,
            });
          }
          if (fields === "post_id") return json(200, videoPostId ? { post_id: videoPostId } : { id });
          if (fields.includes("shares") && /^\d+$/.test(id)) {
            // Graph refuses a field a node does not have.
            return json(400, { error: { message: "(#100) Tried accessing nonexisting field (shares) on node type (Video)", code: 100 } });
          }
          const counts = {
            reactions: { data: [], summary: { total_count: 31 } },
            comments: { data: [], summary: { total_count: 4 } },
          };
          if (fields.includes("shares")) {
            if (noShares) {
              noShares = false;
              return json(200, { id, ...counts });
            }
            return json(200, { id, ...counts, shares: { count: 2 } });
          }
          return json(200, { id, ...counts });
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
    pages: (value) => {
      pages = value;
    },
    pageSize: (value) => {
      size = value;
    },
    permissions: (rows) => {
      permissionRows = rows;
    },
    videoPost: (value) => {
      videoPostId = value;
    },
    failWith: (route, status, body = {}) => failures.set(route, { status, body }),
    failMetric: (metric, status, body = {}) => metricFailures.set(metric, { status, body }),
    swallowNext: (route) => swallow.add(route),
    emptyNext: (route) => empty.add(route),
    noSharesNext: () => {
      noShares = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
