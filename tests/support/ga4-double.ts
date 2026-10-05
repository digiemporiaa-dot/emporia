import { createServer, type Server } from "node:http";

/**
 * A stand-in for Google's Analytics Admin API (v1beta: account summaries,
 * property, data streams) and Data API (v1beta runReport), on one port.
 * Reports are answered by a handler the test sets, from the request body.
 */

export type Ga4Request = { method: string; path: string; query: Record<string, string>; body: string; authorization: string | undefined };
export type Ga4ReportBody = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: { filter: { fieldName: string; stringFilter: { value: string } } };
  limit: string;
  offset: string;
};

export type Ga4Double = {
  url: string;
  requests: Ga4Request[];
  setProperties: (accounts: { account: string; displayName: string; properties: { property: string; displayName: string; currency?: string; timeZone?: string; streams?: string[] }[] }[]) => void;
  onReport: (handler: (property: string, body: Ga4ReportBody) => object) => void;
  /** One answer per page on the admin lists. */
  paginate: (value: boolean) => void;
  failNext: (status: number, body?: object) => void;
  close: () => Promise<void>;
};

export async function startGa4Double(): Promise<Ga4Double> {
  const requests: Ga4Request[] = [];
  let accounts: Parameters<Ga4Double["setProperties"]>[0] = [];
  let handler: (property: string, body: Ga4ReportBody) => object = () => ({ rows: [], rowCount: 0 });
  let paginate = false;
  let failure: { status: number; body: object } | null = null;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://double");
      const path = url.pathname;
      requests.push({ method: req.method ?? "GET", path, query: Object.fromEntries(url.searchParams.entries()), body: raw, authorization: req.headers["authorization"] as string | undefined });
      const json = (status: number, payload: object) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
      if (failure) {
        const f = failure;
        failure = null;
        return json(f.status, f.body);
      }
      const all = accounts.flatMap((account) => account.properties);

      if (path === "/v1beta/accountSummaries") {
        const summaries = accounts.map((account) => ({
          name: `accountSummaries/${account.account.split("/")[1]}`,
          account: account.account,
          displayName: account.displayName,
          propertySummaries: account.properties.map((p) => ({ property: p.property, displayName: p.displayName, propertyType: "PROPERTY_TYPE_ORDINARY" })),
        }));
        if (!paginate) return json(200, { accountSummaries: summaries });
        const at = Number(url.searchParams.get("pageToken") ?? 0);
        return json(200, { accountSummaries: summaries.slice(at, at + 1), ...(at + 1 < summaries.length ? { nextPageToken: String(at + 1) } : {}) });
      }
      let match = /^\/v1beta\/(properties\/\d+)\/dataStreams$/.exec(path);
      if (match) {
        const found = all.find((p) => p.property === match![1]);
        if (!found) return json(404, { error: { code: 404, status: "NOT_FOUND" } });
        return json(200, {
          dataStreams: [
            ...(found.streams ?? []).map((uri, i) => ({ name: `${found.property}/dataStreams/${i}`, type: "WEB_DATA_STREAM", webStreamData: { measurementId: `G-${i}`, defaultUri: uri } })),
            { name: `${found.property}/dataStreams/app`, type: "ANDROID_APP_DATA_STREAM", androidAppStreamData: { packageName: "x" } },
          ],
        });
      }
      match = /^\/v1beta\/(properties\/\d+)$/.exec(path);
      if (match) {
        const found = all.find((p) => p.property === match![1]);
        if (!found) return json(404, { error: { code: 404, status: "NOT_FOUND" } });
        return json(200, { name: found.property, displayName: found.displayName, currencyCode: found.currency ?? "INR", timeZone: found.timeZone ?? "Asia/Kolkata" });
      }
      match = /^\/v1beta\/(properties\/\d+):runReport$/.exec(path);
      if (match && req.method === "POST") return json(200, handler(match[1] as string, JSON.parse(raw) as Ga4ReportBody));
      return json(404, { error: { code: 404, status: "NOT_FOUND" } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("double did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    setProperties: (value) => {
      accounts = value;
    },
    onReport: (value) => {
      handler = value;
    },
    paginate: (value) => {
      paginate = value;
    },
    failNext: (status, body = {}) => {
      failure = { status, body };
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/** Build a runReport answer from rows of [dimension values…, sessions, engaged, keyEvents, revenue]. */
export function reportOf(dimensions: string[], rows: (string | number)[][]): object {
  return {
    dimensionHeaders: dimensions.map((name) => ({ name })),
    metricHeaders: [
      { name: "sessions", type: "TYPE_INTEGER" },
      { name: "engagedSessions", type: "TYPE_INTEGER" },
      { name: "keyEvents", type: "TYPE_FLOAT" },
      { name: "totalRevenue", type: "TYPE_CURRENCY" },
    ],
    rows: rows.map((row) => ({
      dimensionValues: row.slice(0, dimensions.length).map((value) => ({ value: String(value) })),
      metricValues: row.slice(dimensions.length).map((value) => ({ value: String(value) })),
    })),
    rowCount: rows.length,
  };
}
