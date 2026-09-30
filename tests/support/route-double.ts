import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A minimal platform stand-in for tests that need one or two endpoints: each
 * route is `"GET /path"` → a handler returning status and JSON. The real
 * adapter code runs against it; only the host moves.
 */

export type RouteRequest = { method: string; path: string; query: Record<string, string>; headers: IncomingMessage["headers"] };
export type RouteHandler = (request: RouteRequest) => { status?: number; body: unknown };

export type RouteDouble = {
  url: string;
  requests: RouteRequest[];
  /** Add or replace a route, e.g. `on("GET /v24.0/me/media", ...)`. Paths match exactly. */
  on: (route: string, handler: RouteHandler) => void;
  close: () => Promise<void>;
};

export async function startRouteDouble(routes: Record<string, RouteHandler> = {}): Promise<RouteDouble> {
  const table = new Map(Object.entries(routes));
  const requests: RouteRequest[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://double");
    const request: RouteRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: req.headers,
    };
    requests.push(request);
    req.resume();
    req.on("end", () => {
      const handler = table.get(`${request.method} ${request.path}`);
      const answer = handler ? handler(request) : { status: 404, body: { error: { message: `No route for ${request.method} ${request.path}` } } };
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    on: (route, handler) => table.set(route, handler),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
