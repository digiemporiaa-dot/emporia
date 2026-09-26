import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LinkedInProvider, LINKEDIN_SCOPES } from "@/lib/social/linkedin";
import { ValidationError } from "@/lib/errors";
import { startLinkedInDouble, type LinkedInDouble } from "./support/linkedin-double";

/**
 * The LinkedIn adapter, against a wire-level stand-in.
 *
 * The adapter under test is the real one — real URL building, real form
 * encoding, real parsing, real error mapping. Only the host is local. That is
 * what makes these tests worth having: a mocked adapter would prove nothing
 * about the code that actually talks to LinkedIn.
 */

let double: LinkedInDouble;
let provider: LinkedInProvider;

beforeAll(async () => {
  double = await startLinkedInDouble();
  provider = new LinkedInProvider({
    clientId: "app-id",
    clientSecret: "app-secret",
    authBase: `${double.url}/oauth/v2`,
    apiBase: `${double.url}/v2`,
  });
});

afterAll(async () => {
  await double.close();
});

describe("authorization", () => {
  it("builds a URL with everything the provider requires", () => {
    const url = new URL(provider.authorizationUrl("the-state", "https://app.test/callback"));

    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("app-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/callback");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("scope")).toBe(LINKEDIN_SCOPES.join(" "));
  });

  it("does not put the client secret in a URL the browser will see", () => {
    // It belongs in the server-to-server token exchange and nowhere else.
    expect(provider.authorizationUrl("s", "https://app.test/cb")).not.toContain("app-secret");
  });
});

describe("token exchange", () => {
  it("exchanges a code and reads the expiry", async () => {
    const before = Date.now();
    const credentials = await provider.exchangeCode("the-code", "https://app.test/cb");

    expect(credentials.accessToken).toBe("li-access-token");
    expect(credentials.refreshToken).toBe("li-refresh-token");
    expect(credentials.expiresAt?.getTime()).toBeGreaterThan(before);

    const request = double.requests.at(-1);
    expect(request?.method).toBe("POST");
    expect(request?.contentType).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(request?.body ?? "");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_secret")).toBe("app-secret");
  });

  it("keeps the refresh token when a refresh response omits one", async () => {
    // LinkedIn does not always return one, and dropping it would force a
    // reconnect the operator did not need.
    double.token({ access_token: "rotated", expires_in: 3600 });
    const refreshed = await provider.refresh({
      accessToken: "old",
      refreshToken: "keep-me",
      expiresAt: null,
    });

    expect(refreshed.accessToken).toBe("rotated");
    expect(refreshed.refreshToken).toBe("keep-me");
  });

  it("refuses to refresh without a refresh token, in words", async () => {
    await expect(
      provider.refresh({ accessToken: "a", refreshToken: null, expiresAt: null }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a token response with no token rather than storing nothing", async () => {
    double.token({ expires_in: 3600 });
    await expect(provider.exchangeCode("c", "https://app.test/cb")).rejects.toBeInstanceOf(
      ValidationError,
    );
    double.token({ access_token: "li-access-token", refresh_token: "li-refresh-token", expires_in: 100 });
  });
});

describe("reading the account", () => {
  it("maps the profile onto our own shape", async () => {
    const account = await provider.getAccount({
      accessToken: "li-access-token",
      refreshToken: null,
      expiresAt: null,
    });

    expect(account.externalId).toBe("li-member-1");
    expect(account.name).toBe("Priya Raman");
    expect(account.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(double.requests.at(-1)?.authorization).toBe("Bearer li-access-token");
  });

  it("falls back to the name parts when the full name is missing", async () => {
    double.profile({ sub: "li-2", given_name: "Arun", family_name: "Nair" });
    const account = await provider.getAccount({
      accessToken: "t",
      refreshToken: null,
      expiresAt: null,
    });
    expect(account.name).toBe("Arun Nair");
  });

  it("refuses a profile with no id", async () => {
    double.profile({ name: "Nobody" });
    await expect(
      provider.getAccount({ accessToken: "t", refreshToken: null, expiresAt: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    double.profile({ sub: "li-member-1", name: "Priya Raman" });
  });
});

describe("failures", () => {
  it("turns a rejected token into a reconnect instruction", async () => {
    double.failWith("userinfo", 401);
    await expect(
      provider.getAccount({ accessToken: "stale", refreshToken: null, expiresAt: null }),
    ).rejects.toThrow(/reconnect/i);
  });

  it("says so plainly when rate limited", async () => {
    double.failWith("userinfo", 429);
    await expect(
      provider.getAccount({ accessToken: "t", refreshToken: null, expiresAt: null }),
    ).rejects.toThrow(/rate limit/i);
  });

  it("never puts the provider's response body in the message", async () => {
    // A token exchange failure can echo the request back, and that request
    // carries the client secret (CLAUDE.md 11).
    double.failWith("accessToken", 400, JSON.stringify({ error_description: "client_secret=app-secret" }));
    await expect(provider.exchangeCode("c", "https://app.test/cb")).rejects.toThrow(
      /LinkedIn refused/,
    );

    double.failWith("accessToken", 400, JSON.stringify({ error_description: "client_secret=app-secret" }));
    const error = await provider
      .exchangeCode("c", "https://app.test/cb")
      .then(() => null)
      .catch((e: unknown) => e as Error);
    expect(error?.message).not.toContain("app-secret");
    expect(error?.message).toBeTruthy();
  });
});

describe("what this phase does not do", () => {
  it("refuses to publish rather than returning a fabricated post id", async () => {
    await expect(provider.publish()).rejects.toBeInstanceOf(ValidationError);
    await expect(provider.getMetrics()).rejects.toBeInstanceOf(ValidationError);
  });
});
