import { describe, expect, it } from "vitest";
import { publicOrigin } from "@/lib/http/public-origin";

/**
 * Signed-out redirects must go to the address the visitor used. In the
 * standalone build `nextUrl.origin` is the bind address (0.0.0.0 in the
 * image), so the proxy's host and scheme are used instead — when they look
 * like a host and a scheme.
 */

const req = (headers: Record<string, string>, origin = "http://0.0.0.0:3000") => ({
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  nextUrl: { origin, protocol: new URL(origin).protocol },
});

describe("publicOrigin", () => {
  it("uses the proxy's forwarded host and scheme", () => {
    expect(publicOrigin(req({ host: "app:3000", "x-forwarded-host": "emporia.example", "x-forwarded-proto": "https" }))).toBe("https://emporia.example");
  });

  it("falls back to the Host header, keeping a port, and the request's own scheme", () => {
    expect(publicOrigin(req({ host: "127.0.0.1:3001" }))).toBe("http://127.0.0.1:3001");
    expect(publicOrigin(req({ host: "emporia.example", "x-forwarded-proto": "https, http" }))).toBe("https://emporia.example");
  });

  it("takes the first of several forwarded values", () => {
    expect(publicOrigin(req({ "x-forwarded-host": "emporia.example, internal.local", "x-forwarded-proto": "https" }))).toBe("https://emporia.example");
  });

  it("ignores a host or scheme that is not one", () => {
    for (const host of ["evil.example/path", "a b", "evil.example@x", "", "emporia.example:99999999"]) {
      expect(publicOrigin(req({ host }))).toBe("http://0.0.0.0:3000");
    }
    expect(publicOrigin(req({ host: "emporia.example", "x-forwarded-proto": "javascript" }))).toBe("http://emporia.example");
  });
});
