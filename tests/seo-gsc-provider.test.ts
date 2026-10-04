import { generateKeyPairSync, verify } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { GoogleSearchConsole, GSC_MAX_ROWS, queryAll } from "@/lib/seo-intel/providers/gsc";
import { SeoAccessError, SeoCredentialsError, SeoProviderError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";
import {
  clearServiceAccountTokens,
  parseServiceAccountJson,
  serviceAccountAssertion,
  serviceAccountToken,
} from "@/lib/seo-intel/google/service-account";
import { issueSignedState, readSignedState } from "@/lib/security/signed-state";
import { issueSeoState, readSeoState } from "@/lib/seo-intel/google/oauth-state";
import { issueState as issueSocialState } from "@/lib/social/oauth-state";
import type { GscQueryInput, GscRawRow, SearchConsoleProvider } from "@/lib/seo-intel/providers/types";

/**
 * The Search Console adapter, the service-account grant and the OAuth state,
 * against fake Google endpoints. Every failure must come back as a typed
 * error, never as an empty answer.
 */

type Call = { url: string; init?: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetcher, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("the Search Console adapter", () => {
  it("lists sites, keeping only entries with a known permission level", async () => {
    const { fetcher, calls } = fakeFetch(() =>
      json({
        siteEntry: [
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
          { siteUrl: "https://www.example.com/", permissionLevel: "siteRestrictedUser" },
          { siteUrl: "https://odd.com/", permissionLevel: "superUser" },
          { permissionLevel: "siteOwner" },
        ],
      }),
    );
    const gsc = new GoogleSearchConsole(async () => "token-1", fetcher, "https://gsc.test");
    expect(await gsc.listSites()).toEqual([
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.example.com/", permissionLevel: "siteRestrictedUser" },
    ]);
    expect(calls[0]?.url).toBe("https://gsc.test/sites");
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe("Bearer token-1");
  });

  it("an account with no sites is an empty list, not an error", async () => {
    const { fetcher } = fakeFetch(() => json({}));
    expect(await new GoogleSearchConsole(async () => "t", fetcher, "https://gsc.test").listSites()).toEqual([]);
  });

  it("encodes the site into the path and sends the query as JSON", async () => {
    const { fetcher, calls } = fakeFetch(() => json({ rows: [{ keys: ["2026-09-01"], clicks: 1, impressions: 2, position: 3 }] }));
    const gsc = new GoogleSearchConsole(async () => "t", fetcher, "https://gsc.test");
    const rows = await gsc.query({ siteUrl: "sc-domain:example.com", startDate: "2026-09-01", endDate: "2026-09-02", dimensions: ["date"], rowLimit: 99_999 });
    expect(rows).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://gsc.test/sites/sc-domain%3Aexample.com/searchAnalytics/query");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      dimensions: ["date"],
      rowLimit: GSC_MAX_ROWS,
      startRow: 0,
      dataState: "all",
      type: "web",
    });
  });

  it.each([
    [401, SeoCredentialsError],
    [403, SeoAccessError],
    [429, SeoRateLimitError],
    [500, SeoProviderError],
    [503, SeoProviderError],
  ])("maps HTTP %i to a typed error", async (status, type) => {
    const { fetcher } = fakeFetch(() => json({ error: { message: "secret detail" } }, status));
    const gsc = new GoogleSearchConsole(async () => "t", fetcher, "https://gsc.test");
    const error = await gsc.listSites().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type);
    expect((error as Error).message).not.toContain("secret detail");
  });

  it("reads Retry-After on a quota answer", async () => {
    const { fetcher } = fakeFetch(() => json({}, 429, { "retry-after": "120" }));
    const error = (await new GoogleSearchConsole(async () => "t", fetcher, "https://gsc.test").listSites().catch((e: unknown) => e)) as SeoRateLimitError;
    expect(error.retryAfterSeconds).toBe(120);
  });

  it("an unreachable Google or an unreadable body is a retryable provider error", async () => {
    const down = fakeFetch(() => Promise.reject(new Error("ECONNRESET")));
    await expect(new GoogleSearchConsole(async () => "t", down.fetcher, "https://gsc.test").listSites()).rejects.toBeInstanceOf(SeoProviderError);
    const garbled = fakeFetch(() => new Response("<html>", { status: 200 }));
    await expect(new GoogleSearchConsole(async () => "t", garbled.fetcher, "https://gsc.test").listSites()).rejects.toBeInstanceOf(SeoProviderError);
  });

  it("a failing token source fails the call rather than calling Google without one", async () => {
    const { fetcher, calls } = fakeFetch(() => json({}));
    const gsc = new GoogleSearchConsole(async () => {
      throw new SeoCredentialsError("gone");
    }, fetcher);
    await expect(gsc.listSites()).rejects.toBeInstanceOf(SeoCredentialsError);
    expect(calls).toHaveLength(0);
  });
});

describe("reading every page of a query", () => {
  function pagedProvider(total: number) {
    const seen: GscQueryInput[] = [];
    const provider: SearchConsoleProvider = {
      listSites: async () => [],
      query: async (input) => {
        seen.push(input);
        const start = input.startRow ?? 0;
        const count = Math.max(0, Math.min(input.rowLimit, total - start));
        return Array.from({ length: count }, (_, i): GscRawRow => ({ keys: [`q${start + i}`], clicks: 0, impressions: 1, position: 1 }));
      },
    };
    return { provider, seen };
  }

  it("pages until a short page", async () => {
    const { provider, seen } = pagedProvider(GSC_MAX_ROWS + 10);
    const result = await queryAll(provider, { siteUrl: "s", startDate: "a", endDate: "b", dimensions: ["query"] }, 100_000);
    expect(result).toMatchObject({ truncated: false });
    expect(result.rows).toHaveLength(GSC_MAX_ROWS + 10);
    expect(seen.map((input) => input.startRow)).toEqual([0, GSC_MAX_ROWS]);
  });

  it("stops at the cap and says the answer was cut", async () => {
    const { provider } = pagedProvider(10_000);
    const result = await queryAll(provider, { siteUrl: "s", startDate: "a", endDate: "b", dimensions: ["query"] }, 5_000);
    expect(result.rows).toHaveLength(5_000);
    expect(result.truncated).toBe(true);
  });

  it("an exact multiple of the page size makes one extra, empty request and is complete", async () => {
    const { provider, seen } = pagedProvider(GSC_MAX_ROWS);
    const result = await queryAll(provider, { siteUrl: "s", startDate: "a", endDate: "b", dimensions: ["query"] }, 100_000);
    expect(result).toMatchObject({ truncated: false });
    expect(seen).toHaveLength(2);
  });
});

describe("the service account", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyFile = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ type: "service_account", client_email: "emporia@agency-123.iam.gserviceaccount.com", private_key: pem, private_key_id: "kid-1", ...overrides });

  beforeEach(() => clearServiceAccountTokens());

  it("reads a real key file", () => {
    expect(parseServiceAccountJson(keyFile())).toEqual({ email: "emporia@agency-123.iam.gserviceaccount.com", keyId: "kid-1", privateKey: pem });
  });

  it.each([
    ["not json", /not a service account key file/],
    [JSON.stringify([1, 2]), /not a service account key file|type is not/],
    [keyFile({ type: "authorized_user" }), /type is not service_account/],
    [keyFile({ client_email: "someone@gmail.com" }), /client_email/],
    [keyFile({ private_key: undefined }), /no private key/],
    [keyFile({ private_key: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" }), /could not be read/],
  ])("refuses %s", (raw, message) => {
    expect(() => parseServiceAccountJson(raw)).toThrow(message);
  });

  it("signs an RS256 assertion Google can verify with the public key", () => {
    const assertion = serviceAccountAssertion({ email: "sa@x.iam.gserviceaccount.com", keyId: "kid-1", privateKey: pem }, ["scope-a", "scope-b"], 1_800_000_000);
    const [header, claims, signature] = assertion.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT", kid: "kid-1" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "sa@x.iam.gserviceaccount.com",
      scope: "scope-a scope-b",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("exchanges the assertion for a token, and caches it until near expiry", async () => {
    const { fetcher, calls } = fakeFetch(() => json({ access_token: "ya29.sa", expires_in: 3600 }));
    const key = { email: "sa@x.iam.gserviceaccount.com", keyId: null, privateKey: pem };
    expect(await serviceAccountToken(key, ["s"], fetcher, "https://token.test")).toBe("ya29.sa");
    expect(await serviceAccountToken(key, ["s"], fetcher, "https://token.test")).toBe("ya29.sa");
    expect(calls).toHaveLength(1);
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(body.get("assertion")?.split(".")).toHaveLength(3);
    // A different scope is a different token.
    await serviceAccountToken(key, ["other"], fetcher, "https://token.test");
    expect(calls).toHaveLength(2);
  });

  it("a refused key is a credentials error; an outage is retryable", async () => {
    const key = { email: "sa@x.iam.gserviceaccount.com", keyId: null, privateKey: pem };
    const refused = fakeFetch(() => json({ error: "invalid_grant" }, 400));
    await expect(serviceAccountToken(key, ["s"], refused.fetcher, "https://token.test")).rejects.toBeInstanceOf(SeoCredentialsError);
    const down = fakeFetch(() => json({}, 503));
    await expect(serviceAccountToken(key, ["s"], down.fetcher, "https://token.test")).rejects.toBeInstanceOf(SeoProviderError);
  });
});

describe("the OAuth state", () => {
  it("round-trips the property for the browser that started the flow", () => {
    const { state, nonce } = issueSeoState({ propertyId: "prop-1", source: "SEARCH_CONSOLE", via: "staff" });
    expect(readSeoState(state, nonce)).toMatchObject({ ok: true, value: { propertyId: "prop-1", source: "SEARCH_CONSOLE", via: "staff" } });
  });

  it("refuses a different browser, a tampered payload and a missing state", () => {
    const { state, nonce } = issueSeoState({ propertyId: "prop-1", source: "SEARCH_CONSOLE", via: "staff" });
    expect(readSeoState(state, "someone-elses-nonce")).toEqual({ ok: false, reason: "nonce" });
    expect(readSeoState(state, null)).toEqual({ ok: false, reason: "nonce" });
    const [body, signature] = state.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), propertyId: "other" })).toString("base64url");
    expect(readSeoState(`${forged}.${signature}`, nonce)).toEqual({ ok: false, reason: "signature" });
    expect(readSeoState(null, nonce)).toEqual({ ok: false, reason: "malformed" });
  });

  it("a state minted for social accounts cannot be replayed here", () => {
    const social = issueSocialState({ clientId: "c", provider: "YOUTUBE", returnTo: "/" });
    expect(readSeoState(social.state, social.nonce)).toEqual({ ok: false, reason: "signature" });
  });

  it("expires", () => {
    const { state, nonce } = issueSignedState("test-purpose", { a: 1 });
    expect(readSignedState("test-purpose", state, nonce, { maxAgeMs: 60_000, isPayload: () => true }).ok).toBe(true);
    expect(readSignedState("test-purpose", state, nonce, { maxAgeMs: -1, isPayload: () => true })).toEqual({ ok: false, reason: "expired" });
  });

  it("checks the caller's own fields", () => {
    const { state, nonce } = issueSignedState("seo-google-oauth", { propertyId: 5, source: "SEARCH_CONSOLE", via: "staff" });
    expect(readSeoState(state, nonce)).toEqual({ ok: false, reason: "malformed" });
    const noSide = issueSignedState("seo-google-oauth", { propertyId: "p", source: "SEARCH_CONSOLE" });
    expect(readSeoState(noSide.state, noSide.nonce)).toEqual({ ok: false, reason: "malformed" });
    const oddSide = issueSignedState("seo-google-oauth", { propertyId: "p", source: "SEARCH_CONSOLE", via: "admin" });
    expect(readSeoState(oddSide.state, oddSide.nonce)).toEqual({ ok: false, reason: "malformed" });
  });
});
