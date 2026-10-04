import { createServer, type Server } from "node:http";

/**
 * A stand-in for Google's token endpoint and the three Business Profile APIs
 * (Account Management v1, Business Information v1, My Business v4 posts),
 * all on one port.
 *
 * The default estate is the awkward one an agency really has: an
 * organisation account with three locations — two that can take posts and a
 * warehouse that cannot — and the person's own account, through which one of
 * the same locations is *also* reachable.
 */

export type GbpRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: string;
};

export type GbpRoute = "token" | "accounts" | "locations" | "location" | "post" | "reviews";

/** A review as Google's v4 API returns it. */
export type GbpReviewJson = {
  reviewId?: string;
  name?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

export type GoogleBusinessDouble = {
  url: string;
  requests: GbpRequest[];
  /** One item per page on the accounts and locations lists. */
  paginate: (value: boolean) => void;
  /** The state Google reports on a created post. */
  postState: (value: "LIVE" | "PROCESSING" | "REJECTED") => void;
  swallowNextPost: () => void;
  emptyNextPost: () => void;
  failWith: (route: GbpRoute, status: number, body?: object) => void;
  /** The reviews a location returns, newest first, with Google's own totals. */
  setReviews: (location: string, reviews: GbpReviewJson[], totals?: { averageRating?: number; totalReviewCount?: number }) => void;
  /** Another location, reachable by its own name (tests that need ids nobody else uses). */
  addLocation: (name: string) => void;
  close: () => Promise<void>;
};

type Loc = { name: string; title: string; locality: string; canPost: boolean };

const ESTATE: Record<string, Loc[]> = {
  "accounts/111": [
    { name: "locations/1001", title: "Northwind Studio", locality: "Bandra", canPost: true },
    { name: "locations/1002", title: "Northwind Studio", locality: "Andheri", canPost: true },
    { name: "locations/1003", title: "Northwind Warehouse", locality: "Bhiwandi", canPost: false },
  ],
  "accounts/222": [
    { name: "locations/1001", title: "Northwind Studio", locality: "Bandra", canPost: true },
  ],
};

export async function startGoogleBusinessDouble(): Promise<GoogleBusinessDouble> {
  const requests: GbpRequest[] = [];
  let paginate = false;
  let state: "LIVE" | "PROCESSING" | "REJECTED" = "LIVE";
  let swallow = false;
  let empty = false;
  const failures = new Map<GbpRoute, { status: number; body: object }>();
  const extra: Loc[] = [];
  const reviews = new Map<string, { list: GbpReviewJson[]; totals: { averageRating?: number; totalReviewCount?: number } }>();

  const locationJson = (l: Loc) => ({
    name: l.name,
    title: l.title,
    storefrontAddress: { locality: l.locality, regionCode: "IN", addressLines: ["14 Hill Road"], administrativeArea: "Maharashtra", postalCode: "400050" },
    phoneNumbers: { primaryPhone: "022 4000 1001" },
    websiteUri: "https://northwind.example/",
    // Proto3 JSON omits false booleans; so does this.
    metadata: {
      ...(l.canPost ? { canOperateLocalPost: true } : {}),
      mapsUri: `https://maps.google.com/?cid=${l.name.split("/")[1]}`,
    },
  });

  const page = <T,>(items: T[], token: string | undefined) => {
    if (!paginate) return { items, next: undefined };
    const at = token ? Number(token) : 0;
    return { items: items.slice(at, at + 1), next: at + 1 < items.length ? String(at + 1) : undefined };
  };

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://double");
      const path = url.pathname;
      const method = req.method ?? "GET";
      const query = Object.fromEntries(url.searchParams.entries());
      requests.push({
        method,
        path,
        query,
        headers: { authorization: req.headers["authorization"] as string | undefined },
        body: raw,
      });

      const route: GbpRoute =
        path === "/token"
          ? "token"
          : path === "/v1/accounts"
            ? "accounts"
            : /^\/v1\/accounts\/\d+\/locations$/.test(path)
              ? "locations"
              : /^\/v1\/locations\/\d+$/.test(path)
                ? "location"
                : /^\/v4\/accounts\/\d+\/locations\/\d+\/reviews$/.test(path)
                  ? "reviews"
                  : "post";

      const json = (status: number, payload: object) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));

      const failure = failures.get(route);
      if (failure) {
        failures.delete(route);
        return json(failure.status, failure.body);
      }

      switch (route) {
        case "token": {
          const form = new URLSearchParams(raw);
          const scope = "https://www.googleapis.com/auth/business.manage";
          if (form.get("grant_type") === "refresh_token") {
            return json(200, { access_token: "gbp-access-2", expires_in: 3599, scope, token_type: "Bearer" });
          }
          return json(200, { access_token: "gbp-access", refresh_token: "gbp-refresh", expires_in: 3599, scope, token_type: "Bearer" });
        }

        case "accounts": {
          const all = Object.keys(ESTATE).map((name) => ({ name, accountName: name, type: "ORGANIZATION" }));
          const { items, next } = page(all, query["pageToken"]);
          return json(200, { accounts: items, ...(next ? { nextPageToken: next } : {}) });
        }

        case "locations": {
          if (!query["readMask"]) {
            return json(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "read_mask is required" } });
          }
          const account = path.replace(/^\/v1\//, "").replace(/\/locations$/, "");
          const { items, next } = page((ESTATE[account] ?? []).map(locationJson), query["pageToken"]);
          return json(200, { locations: items, ...(next ? { nextPageToken: next } : {}) });
        }

        case "location": {
          const name = path.replace(/^\/v1\//, "");
          const found = [...Object.values(ESTATE).flat(), ...extra].find((l) => l.name === name);
          if (!found) return json(404, { error: { code: 404, status: "NOT_FOUND" } });
          return json(200, locationJson(found));
        }

        case "reviews": {
          const location = path.replace(/^\/v4\/accounts\/\d+\//, "").replace(/\/reviews$/, "");
          const entry = reviews.get(location) ?? { list: [], totals: {} };
          const size = Math.min(50, Number(query["pageSize"] ?? 50));
          const at = query["pageToken"] ? Number(query["pageToken"]) : 0;
          const items = entry.list.slice(at, at + size);
          const next = at + size < entry.list.length ? String(at + size) : undefined;
          return json(200, { reviews: items, ...entry.totals, ...(next ? { nextPageToken: next } : {}) });
        }

        case "post": {
          if (method !== "POST" || !/^\/v4\/accounts\/\d+\/locations\/\d+\/localPosts$/.test(path)) {
            return json(404, { error: { code: 404, status: "NOT_FOUND" } });
          }
          if (swallow) {
            swallow = false;
            setTimeout(() => res.destroy(), 5_000);
            return;
          }
          if (empty) {
            empty = false;
            return json(200, {});
          }
          const parent = path.replace(/^\/v4\//, "").replace(/\/localPosts$/, "");
          return json(200, {
            name: `${parent}/localPosts/555`,
            state,
            searchUrl: "https://local.google.com/place?use=posts&lpsid=555",
            createTime: new Date().toISOString(),
          });
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
    paginate: (value) => {
      paginate = value;
    },
    postState: (value) => {
      state = value;
    },
    swallowNextPost: () => {
      swallow = true;
    },
    emptyNextPost: () => {
      empty = true;
    },
    failWith: (route, status, body = {}) => failures.set(route, { status, body }),
    addLocation: (name) => {
      extra.push({ name, title: "Northwind Studio", locality: "Bandra", canPost: true });
    },
    setReviews: (location, list, totals = {}) => {
      reviews.set(location, { list, totals });
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
