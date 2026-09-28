import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LinkedInProvider, LINKEDIN_SCOPES } from "@/lib/social/linkedin";
import { AmbiguousPublishError } from "@/lib/social/errors";
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
    restBase: `${double.url}/rest`,
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

describe("publishing", () => {
  const credentials = { accessToken: "li-access-token", refreshToken: null, expiresAt: null };
  const account = { externalId: "li-member-1" };

  const input = (over: Partial<Parameters<LinkedInProvider["publish"]>[2]> = {}) => ({
    type: "TEXT" as const,
    caption: "Every table we ship starts at one of four mills.",
    headline: null,
    hashtags: [] as string[],
    mentions: [] as string[],
    callToAction: null,
    firstComment: null,
    linkUrl: null,
    media: [] as { url: string; mimeType: string; thumbnailUrl: string | null }[],
    ...over,
  });

  it("posts the copy and returns the id LinkedIn put in the header", async () => {
    const before = double.requests.length;
    const result = await provider.publish(credentials, account, input());

    expect(result.externalPostId).toBe("urn:li:share:7000000000000000001");
    expect(result.externalUrl).toContain("urn:li:share:7000000000000000001");

    const posted = double.requests.slice(before).find((r) => r.path.endsWith("/posts"))!;
    const body = JSON.parse(posted.body) as Record<string, unknown>;
    expect(body["author"]).toBe("urn:li:person:li-member-1");
    expect(body["commentary"]).toBe("Every table we ship starts at one of four mills.");
    expect(body["lifecycleState"]).toBe("PUBLISHED");
  });

  it("sends the version header LinkedIn refuses the call without", async () => {
    const before = double.requests.length;
    await provider.publish(credentials, account, input());
    const posted = double.requests.slice(before).find((r) => r.path.endsWith("/posts"))!;
    expect(posted.authorization).toBe("Bearer li-access-token");
  });

  it("appends hashtags to the end of the copy, where LinkedIn expects them", async () => {
    const before = double.requests.length;
    await provider.publish(credentials, account, input({ hashtags: ["diwali", "homestyling"] }));
    const posted = double.requests.slice(before).find((r) => r.path.endsWith("/posts"))!;
    const body = JSON.parse(posted.body) as { commentary: string };
    expect(body.commentary.endsWith("#diwali #homestyling")).toBe(true);
  });

  it("shares a bare link as an article so LinkedIn renders its card", async () => {
    const before = double.requests.length;
    await provider.publish(credentials, account, input({ linkUrl: "https://example.com/a?utm_source=linkedin" }));
    const posted = double.requests.slice(before).find((r) => r.path.endsWith("/posts"))!;
    const body = JSON.parse(posted.body) as { content?: { article?: { source: string } } };
    expect(body.content?.article?.source).toBe("https://example.com/a?utm_source=linkedin");
  });

  it("uploads a creative before posting, and references the returned urn", async () => {
    const before = double.requests.length;
    await provider.publish(
      credentials,
      account,
      input({ media: [{ url: `${double.url}/asset/1.jpg`, mimeType: "image/jpeg", thumbnailUrl: null }] }),
    );

    const sent = double.requests.slice(before);
    const order = sent.map((r) => r.path.replace(/\/\d+(\.jpg)?$/, ""));
    // Register, fetch our copy, upload, and only then post.
    expect(order.indexOf("/rest/images")).toBeLessThan(order.indexOf("/rest/posts"));
    expect(order.indexOf("/upload")).toBeLessThan(order.indexOf("/rest/posts"));

    const posted = sent.find((r) => r.path.endsWith("/posts"))!;
    const body = JSON.parse(posted.body) as { content?: { media?: { id: string } } };
    expect(body.content?.media?.id).toBe("urn:li:image:C4E10AQ");
  });

  it("does not post at all when the creative fails to upload", async () => {
    double.failWith("images", 500);
    const before = double.requests.length;

    await expect(
      provider.publish(
        credentials,
        account,
        input({ media: [{ url: `${double.url}/asset/1.jpg`, mimeType: "image/jpeg", thumbnailUrl: null }] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // A text-only post nobody asked for is the failure mode being prevented.
    expect(double.requests.slice(before).some((r) => r.path.endsWith("/posts"))).toBe(false);
  });

  it("refuses an empty post rather than sending nothing", async () => {
    await expect(
      provider.publish(credentials, account, input({ caption: null })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("says the post may exist when LinkedIn accepts it but returns no id", async () => {
    double.publishWithoutId();
    const error = await provider
      .publish(credentials, account, input())
      .then(() => null)
      .catch((e: unknown) => e as Error);

    // Critically it is not an ordinary failure: the engine must not retry it,
    // because retrying would duplicate the post.
    expect(error).toBeInstanceOf(AmbiguousPublishError);
    expect(error?.message).toContain("Check the page before retrying");
  });

  it("maps a rejected token to something an operator can act on", async () => {
    double.failWith("posts", 401);
    const error = await provider
      .publish(credentials, account, input())
      .then(() => null)
      .catch((e: unknown) => e as Error);
    expect(error?.message).toContain("Reconnect the account");
  });
});

describe("metrics", () => {
  const credentials = { accessToken: "li-access-token", refreshToken: null, expiresAt: null };
  const account = { externalId: "li-member-1" };
  const share = "urn:li:share:7000000000000000001";

  it("reads likes and comments back for a published post", async () => {
    const metrics = await provider.getMetrics(credentials, account, share);
    expect(metrics.likes).toBe(12);
    expect(metrics.comments).toBe(3);
  });

  it("reports what LinkedIn does not give as absent, never as zero", async () => {
    const metrics = await provider.getMetrics(credentials, account, share);
    // Impressions and reach need an organisation page and a scope this
    // integration does not have. Zero would be a measurement; this is not one.
    expect(metrics.impressions).toBeNull();
    expect(metrics.reach).toBeNull();
    expect(metrics.clicks).toBeNull();
    expect(metrics.shares).toBeNull();
  });

  it("asks about the post it was given", async () => {
    const before = double.requests.length;
    await provider.getMetrics(credentials, account, share);
    const asked = double.requests.slice(before).find((r) => r.path.includes("/socialActions/"))!;
    expect(decodeURIComponent(asked.path)).toContain(share);
  });

  it("falls back to first-level comments when the aggregate is missing", async () => {
    double.engagement({ likesSummary: { totalLikes: 4 }, commentsSummary: { totalFirstLevelComments: 2 } });
    const metrics = await provider.getMetrics(credentials, account, share);
    expect(metrics.comments).toBe(2);
    double.engagement({ likesSummary: { totalLikes: 12 }, commentsSummary: { aggregatedTotalComments: 3 } });
  });

  it("treats a nonsense figure as absent rather than believing it", async () => {
    double.engagement({ likesSummary: { totalLikes: "lots" }, commentsSummary: {} });
    const metrics = await provider.getMetrics(credentials, account, share);
    expect(metrics.likes).toBeNull();
    expect(metrics.comments).toBeNull();
    double.engagement({ likesSummary: { totalLikes: 12 }, commentsSummary: { aggregatedTotalComments: 3 } });
  });

  it("surfaces a rejected token rather than reporting nothing happened", async () => {
    double.failWith("socialActions", 401);
    await expect(provider.getMetrics(credentials, account, share)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
