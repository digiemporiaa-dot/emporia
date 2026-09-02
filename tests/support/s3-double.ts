import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * A minimal S3-compatible object store, for tests only.
 *
 * This is verification scaffolding, not product code: it lets the real
 * `@aws-sdk/client-s3` path be exercised end to end — presigned PUT, HEAD,
 * ranged GET, DELETE — without reaching Cloudflare. It deliberately does not
 * verify signatures; what is under test is our own code, not AWS's signing.
 */

type StoredObject = { body: Buffer; contentType: string };

export class S3Double {
  private readonly objects = new Map<string, StoredObject>();
  private server: Server | null = null;
  private port = 0;

  /** Requests seen, so a test can assert what the browser actually sent. */
  readonly requests: { method: string; key: string; contentType?: string }[] = [];

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      // Path style: /<bucket>/<key...>
      const key = url.pathname.split("/").slice(2).join("/");

      if (request.method === "PUT") {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const body = Buffer.concat(chunks);
          const contentType = request.headers["content-type"] ?? "application/octet-stream";
          this.objects.set(key, { body, contentType: String(contentType) });
          this.requests.push({ method: "PUT", key, contentType: String(contentType) });
          response.writeHead(200, { ETag: `"${createHash("md5").update(body).digest("hex")}"` });
          response.end();
        });
        return;
      }

      const object = this.objects.get(key);

      if (request.method === "HEAD") {
        this.requests.push({ method: "HEAD", key });
        if (!object) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          "content-length": String(object.body.length),
          "content-type": object.contentType,
          ETag: `"${createHash("md5").update(object.body).digest("hex")}"`,
        });
        response.end();
        return;
      }

      if (request.method === "GET") {
        this.requests.push({ method: "GET", key });
        if (!object) {
          response.writeHead(404);
          response.end();
          return;
        }

        const range = request.headers["range"];
        let body = object.body;
        let status = 200;

        if (typeof range === "string") {
          const match = /bytes=(\d+)-(\d+)?/.exec(range);
          if (match) {
            const start = Number(match[1]);
            const end = match[2] ? Number(match[2]) : object.body.length - 1;
            body = object.body.subarray(start, Math.min(end + 1, object.body.length));
            status = 206;
          }
        }

        response.writeHead(status, {
          "content-length": String(body.length),
          "content-type": object.contentType,
        });
        response.end(body);
        return;
      }

      if (request.method === "DELETE") {
        this.requests.push({ method: "DELETE", key });
        this.objects.delete(key);
        response.writeHead(204);
        response.end();
        return;
      }

      response.writeHead(405);
      response.end();
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });

    this.port = (this.server!.address() as AddressInfo).port;
    return `http://127.0.0.1:${this.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  get(key: string): Buffer | null {
    return this.objects.get(key)?.body ?? null;
  }

  /** Write an object without going through a presigned PUT. */
  put(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType });
  }

  get size(): number {
    return this.objects.size;
  }
}
