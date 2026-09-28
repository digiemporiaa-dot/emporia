import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InstagramProvider, INSTAGRAM_SCOPES } from "@/lib/social/instagram";
import { AmbiguousPublishError, CredentialsRejectedError } from "@/lib/social/errors";
import { ValidationError } from "@/lib/errors";
import { startInstagramDouble, type InstagramDouble } from "./support/instagram-double";
import type { PublishInput } from "@/lib/social/types";

/**
 * The Instagram adapter, against a double that speaks Instagram's protocol.
 *
 * What matters most is at the bottom of "publishing": the container calls are
 * safe to repeat and the publish call is not, so only the publish call may be
 * ambiguous — and a refused post must be refused before any container exists.
 */

let double: InstagramDouble;
let provider: InstagramProvider;

const credentials = { accessToken: "ig-long-token", refreshToken: null, expiresAt: null };
const account = { externalId: "17841400000000001" };

function make(over: { timeoutMs?: number; pollTimeoutMs?: number } = {}) {
  return new InstagramProvider({
    clientId: "ig-app-id",
    clientSecret: "ig-app-secret",
    authorizeBase: double.url,
    authBase: double.url,
    graphBase: double.url,
    pollIntervalMs: 10,
    pollTimeoutMs: over.pollTimeoutMs ?? 2_000,
    timeoutMs: over.timeoutMs ?? 2_000,
  });
}

const jpeg = (n = 1) => ({ url: `https://cdn.example.com/${n}.jpg`, mimeType: "image/jpeg", thumbnailUrl: null });
const mp4 = (n = 1) => ({ url: `https://cdn.example.com/${n}.mp4`, mimeType: "video/mp4", thumbnailUrl: null });

function input(over: Partial<PublishInput> = {}): PublishInput {
  return {
    type: "SINGLE_IMAGE",
    caption: "Three rooms, one afternoon.",
    headline: null,
    hashtags: [],
    mentions: [],
    callToAction: null,
    firstComment: null,
    linkUrl: null,
    media: [jpeg()],
    ...over,
  };
}

/** The requests made since `from`, as "METHOD /path". */
function since(from: number): string[] {
  return double.requests.slice(from).map((r) => `${r.method} ${r.path.replace(/^\/v[\d.]+/, "")}`);
}

beforeAll(async () => {
  double = await startInstagramDouble();
  provider = make();
});

afterAll(async () => {
  await double.close();
});

describe("connection", () => {
  it("sends the operator to Instagram's own login with the publishing scopes", () => {
    const url = new URL(provider.authorizationUrl("state-123", "https://app.example.com/cb"));
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("ig-app-id");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([...INSTAGRAM_SCOPES]);
  });

  it("keeps the long-lived token, not the hour-long one", async () => {
    const before = double.requests.length;
    const creds = await provider.exchangeCode("auth-code", "https://app.example.com/cb");

    expect(creds.accessToken).toBe("ig-long-token");
    expect(creds.refreshToken).toBeNull();
    // About sixty days out.
    const days = (creds.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59);

    const exchange = double.requests.slice(before).find((r) => r.path === "/access_token")!;
    expect(exchange.query["grant_type"]).toBe("ig_exchange_token");
    expect(exchange.query["access_token"]).toBe("ig-short-token");
  });

  it("refreshes by presenting the token itself", async () => {
    expect(provider.refreshesWithAccessToken).toBe(true);
    const before = double.requests.length;
    const fresh = await provider.refresh(credentials);

    expect(fresh.accessToken).toBe("ig-refreshed-token");
    const call = double.requests.slice(before).find((r) => r.path === "/refresh_access_token")!;
    expect(call.query["grant_type"]).toBe("ig_refresh_token");
    expect(call.query["access_token"]).toBe("ig-long-token");
  });

  it("reads the professional account", async () => {
    const me = await provider.getAccount(credentials);
    expect(me.externalId).toBe("17841400000000001");
    expect(me.username).toBe("northwind.studio");
    expect(me.profileUrl).toBe("https://www.instagram.com/northwind.studio/");
  });

  it("refuses to connect a personal account, which cannot be published to", async () => {
    double.profile({ user_id: "1", username: "someone", account_type: "PERSONAL" });
    await expect(provider.getAccount(credentials)).rejects.toThrow(/personal Instagram account/);
    double.profile({
      user_id: "17841400000000001",
      username: "northwind.studio",
      name: "Northwind Studio",
      account_type: "BUSINESS",
    });
  });
});

describe("publishing", () => {
  it("publishes a single image: container, then publish, then permalink", async () => {
    const before = double.requests.length;
    const result = await provider.publish(credentials, account, input());

    expect(result.externalPostId).toBe("m-1");
    expect(result.externalUrl).toBe("https://www.instagram.com/p/DOUBLE123/");
    const calls = since(before);
    expect(calls.indexOf("POST /me/media")).toBeLessThan(calls.indexOf("POST /me/media_publish"));

    const container = double.requests.slice(before).find((r) => r.path.endsWith("/me/media"))!;
    expect(JSON.parse(container.body)).toMatchObject({ image_url: "https://cdn.example.com/1.jpg" });
    expect(container.authorization).toBe("Bearer ig-long-token");
  });

  it("puts hashtags and mentions into the caption, where Instagram reads them", async () => {
    const before = double.requests.length;
    await provider.publish(
      credentials,
      account,
      input({ hashtags: ["diwali", "homestyling"], mentions: ["@priya", "rohan"] }),
    );
    const container = double.requests.slice(before).find((r) => r.path.endsWith("/me/media"))!;
    const caption = (JSON.parse(container.body) as { caption: string }).caption;
    expect(caption).toContain("@priya @rohan");
    expect(caption.endsWith("#diwali #homestyling")).toBe(true);
  });

  it("publishes a reel, waiting for Instagram to finish processing the video", async () => {
    double.processingFor(2);
    const before = double.requests.length;
    await provider.publish(credentials, account, input({ type: "REEL", media: [mp4()] }));

    const calls = since(before);
    const statusChecks = calls.filter((c) => c.startsWith("GET /c-")).length;
    expect(statusChecks).toBe(3);
    const container = double.requests.slice(before).find((r) => r.path.endsWith("/me/media"))!;
    expect(JSON.parse(container.body)).toMatchObject({ media_type: "REELS", share_to_feed: true });
  });

  it("publishes a plain video as a reel, since Instagram retired the feed video type", async () => {
    const before = double.requests.length;
    await provider.publish(credentials, account, input({ type: "VIDEO", media: [mp4()] }));
    const container = double.requests.slice(before).find((r) => r.path.endsWith("/me/media"))!;
    expect(JSON.parse(container.body)).toMatchObject({ media_type: "REELS" });
  });

  it("publishes a carousel: a container per item, then a parent listing them", async () => {
    const before = double.requests.length;
    await provider.publish(
      credentials,
      account,
      input({ type: "CAROUSEL", media: [jpeg(1), jpeg(2), mp4(3)] }),
    );

    const containers = double.requests
      .slice(before)
      .filter((r) => r.path.endsWith("/me/media"))
      .map((r) => JSON.parse(r.body) as Record<string, unknown>);
    expect(containers).toHaveLength(4);
    expect(containers.slice(0, 3).every((c) => c["is_carousel_item"] === true)).toBe(true);
    const parent = containers[3]!;
    expect(parent["media_type"]).toBe("CAROUSEL");
    expect((parent["children"] as string).split(",")).toHaveLength(3);
  });

  it("adds the first comment once the post is live", async () => {
    const before = double.requests.length;
    const result = await provider.publish(credentials, account, input({ firstComment: "#festive" }));
    const calls = since(before);
    expect(calls.indexOf("POST /m-1/comments")).toBeGreaterThan(calls.indexOf("POST /me/media_publish"));
    expect(result.warnings).toBeUndefined();
  });

  it("reports a failed first comment as a warning, never a failed post", async () => {
    double.failWith("comments", 500);
    const result = await provider.publish(credentials, account, input({ firstComment: "#festive" }));
    expect(result.externalPostId).toBe("m-1");
    expect(result.warnings?.[0]).toContain("first comment");
  });

  // ---- Refused before any container is made --------------------------------

  const refusals: [string, Partial<PublishInput>, RegExp][] = [
    ["a PNG", { media: [{ url: "x.png", mimeType: "image/png", thumbnailUrl: null }] }, /only accepts JPEG/],
    ["no creative at all", { media: [] }, /needs a creative/],
    ["a one-item carousel", { type: "CAROUSEL", media: [jpeg()] }, /2 to 10 items/],
    ["an eleven-item carousel", { type: "CAROUSEL", media: Array.from({ length: 11 }, (_, i) => jpeg(i)) }, /2 to 10 items/],
    ["a reel without a video", { type: "REEL", media: [jpeg()] }, /MP4 or MOV/],
    ["two images on a single-image post", { media: [jpeg(1), jpeg(2)] }, /exactly one creative/],
    ["thirty-one hashtags", { hashtags: Array.from({ length: 31 }, (_, i) => `tag${i}`) }, /at most 30 hashtags/],
  ];

  for (const [what, over, message] of refusals) {
    it(`refuses ${what} before creating anything`, async () => {
      const before = double.requests.length;
      await expect(provider.publish(credentials, account, input(over))).rejects.toThrow(message);
      expect(double.requests.length).toBe(before);
    });
  }

  it("says so when Instagram cannot process the creative", async () => {
    double.statusOnce("ERROR");
    await expect(
      provider.publish(credentials, account, input({ type: "REEL", media: [mp4()] })),
    ).rejects.toThrow(/could not process/);
  });

  it("gives up waiting on a slow video without publishing anything", async () => {
    const impatient = make({ pollTimeoutMs: 30 });
    double.processingFor(100);
    const before = double.requests.length;

    const error = await impatient
      .publish(credentials, account, input({ type: "REEL", media: [mp4()] }))
      .catch((e: unknown) => e as Error);

    // An ordinary, retryable failure — nothing went live.
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).not.toBeInstanceOf(AmbiguousPublishError);
    expect(since(before)).not.toContain("POST /me/media_publish");
    double.processingFor(0);
  });

  // ---- The one dangerous call ----------------------------------------------

  it("treats a lost reply to the publish call as possibly live", async () => {
    const impatient = make({ timeoutMs: 300 });
    double.swallowNextPublish();
    await expect(impatient.publish(credentials, account, input())).rejects.toBeInstanceOf(
      AmbiguousPublishError,
    );
  });

  it("treats a gateway timeout on the publish call as possibly live", async () => {
    double.failWith("publish", 504);
    await expect(provider.publish(credentials, account, input())).rejects.toBeInstanceOf(
      AmbiguousPublishError,
    );
  });

  it("treats a publish accepted without an id as possibly live", async () => {
    double.publishWithoutId();
    await expect(provider.publish(credentials, account, input())).rejects.toBeInstanceOf(
      AmbiguousPublishError,
    );
  });

  it("treats a failure while creating the container as safe to retry", async () => {
    double.failWith("container", 500);
    const error = await provider.publish(credentials, account, input()).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).not.toBeInstanceOf(AmbiguousPublishError);
  });

  it("types an expired or revoked token so the account gets marked", async () => {
    double.failWith("container", 400, { error: { message: "Error validating access token", code: 190 } });
    await expect(provider.publish(credentials, account, input())).rejects.toBeInstanceOf(
      CredentialsRejectedError,
    );
  });
});

describe("metrics", () => {
  it("reads likes and comments from the post, and reach, saves and shares from insights", async () => {
    const metrics = await provider.getMetrics(credentials, account, "m-1");
    expect(metrics).toMatchObject({ likes: 57, comments: 6, reach: 420, saves: 9, shares: 4 });
  });

  it("reports impressions as absent, not zero — Meta retired them", async () => {
    const metrics = await provider.getMetrics(credentials, account, "m-1");
    expect(metrics.impressions).toBeNull();
    expect(metrics.clicks).toBeNull();
  });

  it("keeps likes and comments when insights are refused for that kind of post", async () => {
    double.failWith("insights", 400, { error: { message: "metric not supported", code: 100 } });
    const metrics = await provider.getMetrics(credentials, account, "m-1");
    expect(metrics.likes).toBe(57);
    expect(metrics.reach).toBeNull();
    expect(metrics.saves).toBeNull();
  });

  it("surfaces a rejected token rather than reporting nothing happened", async () => {
    double.failWith("media", 401);
    await expect(provider.getMetrics(credentials, account, "m-1")).rejects.toBeInstanceOf(
      CredentialsRejectedError,
    );
  });
});
