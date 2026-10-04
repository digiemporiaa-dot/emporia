import "server-only";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { assertSafeUrl, resolvePublicHost, UnsafeTargetError } from "@/lib/seo-intel/net/safe-url";
import { normalizeUrl } from "@/lib/seo-intel/crawler/url";

/**
 * The only way the crawler reaches the internet.
 *
 * Every request re-checks the URL's spelling, resolves the host, insists every
 * address is public, and then connects to that checked address — the socket
 * never resolves the name again, so an answer that changes between check and
 * connect (DNS rebinding) cannot point it inside. Redirects are not followed
 * here; a caller that follows one makes a new request, checked the same way.
 */

export const CRAWLER_USER_AGENT = "EmporiaSEOBot/1.0 (+https://emporia.digital/bot)";

export type Resolver = (host: string) => Promise<string[]>;

export const publicResolver: Resolver = (host) =>
  resolvePublicHost(host, (name) => dnsLookup(name, { all: true, verbatim: true }));

export type FetchOptions = {
  resolve?: Resolver;
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Test seam: the port to connect to. The URL itself must use the default port. */
  port?: number;
};

export type FetchResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** The body was cut at `maxBytes`. */
  truncated: boolean;
  ms: number;
};

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchError";
  }
}

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_BYTES = 2_000_000;

function decode(body: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const options = { maxOutputLength: maxBytes };
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return gunzipSync(body, options);
    case "deflate":
      return inflateSync(body, options);
    case "br":
      return brotliDecompressSync(body, options);
    default:
      return body;
  }
}

export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(assertSafeUrl(rawUrl));
  } catch (error) {
    if (error instanceof UnsafeTargetError) throw error;
    throw new UnsafeTargetError("That address cannot be fetched.");
  }

  const addresses = await (options.resolve ?? publicResolver)(url.hostname);
  const address = addresses[0];
  if (!address) throw new UnsafeTargetError(`${url.hostname} could not be found.`);
  const family = isIP(address) === 6 ? 6 : 4;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;
  const started = Date.now();

  return new Promise<FetchResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: options.port ?? (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: isHttps ? url.hostname : undefined,
        headers: {
          "user-agent": CRAWLER_USER_AGENT,
          accept: options.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
        },
        // Connect to the address already checked; never resolve again.
        lookup: (_host, lookupOptions, callback) => {
          if ((lookupOptions as { all?: boolean }).all) {
            (callback as (err: null, list: { address: string; family: number }[]) => void)(null, [{ address, family }]);
          } else {
            (callback as (err: null, address: string, family: number) => void)(null, address, family);
          }
        },
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;

        response.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            response.destroy();
            done();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => done());
        response.on("error", (error) => {
          if (!truncated) finish(() => reject(new FetchError(error.message)));
        });

        function done() {
          finish(() => {
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              if (value !== undefined) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
            }
            let body: Buffer = Buffer.concat(chunks);
            if (!truncated) {
              try {
                body = decode(body, headers["content-encoding"], maxBytes);
              } catch {
                reject(new FetchError("The response could not be decompressed or was too large."));
                return;
              }
            }
            resolve({ url: url.toString(), status: response.statusCode ?? 0, headers, body, truncated, ms: Date.now() - started });
          });
        }
      },
    );

    const timer = setTimeout(() => {
      request.destroy();
      finish(() => reject(new FetchError(`No complete response within ${Math.round(timeoutMs / 1000)} seconds.`)));
    }, timeoutMs);

    request.on("error", (error) => finish(() => reject(new FetchError(error.message))));
    request.end();
  });
}

/**
 * For robots.txt and sitemaps: follow up to `maxHops` redirects, each one a
 * fresh checked request, and only to URLs `allowed` accepts.
 */
export async function fetchFollowing(
  url: string,
  options: FetchOptions & { maxHops?: number; allowed?: (url: string) => boolean } = {},
): Promise<FetchResult> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    const result = await safeFetch(current, options);
    const location = result.headers["location"];
    if (result.status >= 300 && result.status < 400 && location) {
      const next = normalizeUrl(location, current);
      if (!next || hop >= (options.maxHops ?? 5) || (options.allowed && !options.allowed(next))) return result;
      current = next;
      continue;
    }
    return result;
  }
}
