import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { XProvider, X_SCOPES } from "@/lib/social/x";
import { AmbiguousPublishError, CredentialsRejectedError } from "@/lib/social/errors";
import { ValidationError } from "@/lib/errors";
import { pkceChallenge, pkceVerifier } from "@/lib/social/oauth-state";
import { textLength } from "@/lib/social/text-length";
import { socialPostSchema } from "@/lib/validation/social";
import { startXDouble, type XDouble } from "./support/x-double";
import type { PublishInput } from "@/lib/social/types";

/**
 * The X adapter, against a double for X's token endpoint, the v2 API, its
 * chunked media upload and the storage creatives come from.
 *
 * Pinned: PKCE end to end with a verifier nobody else can compute; rotating
 * refresh tokens are stored as they rotate; a video is streamed up in
 * segments and waited on; only the post call may be ambiguous; and a post is
 * measured the way X measures it — the same way the editor does.
 */

let double: XDouble;
let provider: XProvider;

const credentials = { accessToken: "x-access-1", refreshToken: "x-refresh-1", expiresAt: null };
const account = { externalId: "4401" };

function make(timeoutMs = 3_000, processingTimeoutMs = 5_000) {
  return new XProvider({
    clientId: "x-client",
    clientSecret: "x-secret",
    authorizeBase: double.url,
    apiBase: double.url,
    timeoutMs,
    processingTimeoutMs,
    maxPollIntervalMs: 20,
  });
}

function input(over: Partial<PublishInput> = {}): PublishInput {
  return {
    type: "TEXT",
    caption: "Festive hours this week: 10am to 9pm.",
    headline: null,
    hashtags: [],
    mentions: [],
    callToAction: null,
    firstComment: null,
    linkUrl: null,
    media: [],
    ...over,
  };
}

const image = () => ({ url: `${double.url}/media/pic.jpg`, mimeType: "image/jpeg", thumbnailUrl: null });
const video = () => ({ url: `${double.url}/media/clip.mp4`, mimeType: "video/mp4", thumbnailUrl: null });

beforeAll(async () => {
  double = await startXDouble();
  provider = make();
});

afterAll(async () => {
  await double.close();
});

describe("connecting with PKCE", () => {
  const verifier = pkceVerifier("the-flow-nonce");

  it("sends an S256 challenge, never the verifier", () => {
    const url = new URL(provider.authorizationUrl("state", "https://emporia.test/cb", { verifier }));
    expect(url.pathname).toBe("/i/oauth2/authorize");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...X_SCOPES]);
    expect(url.toString()).not.toContain(verifier);
    expect(url.toString()).not.toContain("x-secret");
  });

  it("derives a verifier nobody can compute from the nonce alone, of a length X accepts", () => {
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceVerifier("the-flow-nonce")).toBe(verifier);
    expect(pkceVerifier("another-nonce")).not.toBe(verifier);
  });

  it("refuses to start without PKCE rather than sending a flow X would reject", () => {
    expect(() => provider.authorizationUrl("state", "https://emporia.test/cb")).toThrow(ValidationError);
  });

  it("exchanges the code with the verifier, the secret as Basic auth", async () => {
    double.expectVerifier(verifier);
    const from = double.requests.length;
    const result = await provider.exchangeCode("code", "https://emporia.test/cb", { verifier });
    expect(result.accessToken).toMatch(/^x-access-/);
    expect(result.refreshToken).toMatch(/^x-refresh-/);
    expect(result.scopes).toEqual(expect.arrayContaining(["tweet.write", "media.write"]));

    const call = double.requests[from]!;
    expect(new URLSearchParams(call.body).get("client_secret")).toBeNull();
    expect(call.headers.authorization).toMatch(/^Basic /);
  });

  it("fails the exchange when the verifier does not match", async () => {
    double.expectVerifier("something-else");
    await expect(provider.exchangeCode("code", "https://emporia.test/cb", { verifier })).rejects.toBeInstanceOf(
      CredentialsRejectedError,
    );
  });

  it("refuses a grant without permission to post", async () => {
    double.expectVerifier(verifier);
    double.grantedScopes("tweet.read users.read offline.access");
    try {
      await expect(provider.exchangeCode("code", "https://emporia.test/cb", { verifier })).rejects.toThrow(
        /permission to post/,
      );
    } finally {
      double.grantedScopes(X_SCOPES.join(" "));
    }
  });

  it("stores the rotated refresh token, and a spent one is refused", async () => {
    const first = await provider.refresh({ ...credentials, refreshToken: "x-refresh-1" });
    expect(first.refreshToken).not.toBe("x-refresh-1");
    await expect(provider.refresh({ ...credentials, refreshToken: "x-refresh-1" })).rejects.toBeInstanceOf(
      CredentialsRejectedError,
    );
  });

  it("reads the account", async () => {
    expect(await provider.getAccount(credentials)).toMatchObject({
      externalId: "4401",
      username: "northwind",
      profileUrl: "https://x.com/northwind",
    });
  });
});

describe("publishing", () => {
  it("posts text with mentions, link and hashtags in reading order", async () => {
    const result = await provider.publish(
      credentials,
      account,
      input({ mentions: ["@bandra.eats"], linkUrl: "https://northwind.test/?utm_source=x", hashtags: ["festive"] }),
    );
    const sent = JSON.parse(double.requests.at(-1)!.body);
    expect(sent).toEqual({
      text: "Festive hours this week: 10am to 9pm.\n\n@bandra.eats\n\nhttps://northwind.test/?utm_source=x\n\n#festive",
    });
    expect(result).toEqual({
      externalPostId: "1790000000000000001",
      externalUrl: "https://x.com/i/web/status/1790000000000000001",
    });
  });

  it("uploads an image, then attaches it", async () => {
    const from = double.requests.length;
    await provider.publish(credentials, account, input({ type: "SINGLE_IMAGE", media: [image()] }));
    const calls = double.requests.slice(from).map((r) => `${r.method} ${r.path.replace(/m-\d+/, "{id}")}`);
    expect(calls).toEqual([
      "GET /media/pic.jpg",
      "POST /2/media/upload/initialize",
      "POST /2/media/upload/{id}/append",
      "POST /2/media/upload/{id}/finalize",
      "POST /2/tweets",
    ]);
    const init = JSON.parse(double.requests[from + 1]!.body);
    expect(init).toEqual({ media_type: "image/jpeg", total_bytes: double.imageSize, media_category: "tweet_image" });
    expect(JSON.parse(double.requests.at(-1)!.body).media.media_ids).toHaveLength(1);
  });

  it("streams a large video up in segments, and waits for X to process it", async () => {
    const from = double.requests.length;
    await provider.publish(credentials, account, input({ type: "VIDEO", media: [video()] }));
    const made = double.requests.slice(from);

    const appends = made.filter((r) => r.path.endsWith("/append"));
    // 9 MB in 4 MB segments: three, numbered from zero, every byte sent.
    expect(appends.map((r) => r.body)).toEqual(["0", "1", "2"]);
    expect(appends.reduce((sum, r) => sum + r.bytes, 0)).toBeGreaterThan(double.videoSize);
    expect(made.some((r) => r.query["command"] === "STATUS")).toBe(true);
    expect(made.at(-1)!.path).toBe("/2/tweets");
  });

  it("does not post a video X failed to process", async () => {
    double.processing("fails");
    try {
      const from = double.requests.length;
      await expect(provider.publish(credentials, account, input({ type: "VIDEO", media: [video()] }))).rejects.toThrow(
        /could not process/,
      );
      expect(double.requests.slice(from).some((r) => r.path === "/2/tweets")).toBe(false);
    } finally {
      double.processing("succeeds");
    }
  });

  it("leaves a video still processing for the next run — nothing posted", async () => {
    double.processing("never");
    try {
      const failure = await make(3_000, 200)
        .publish(credentials, account, input({ type: "VIDEO", media: [video()] }))
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ValidationError);
      expect(String((failure as Error).message)).toMatch(/next run/);
    } finally {
      double.processing("succeeds");
    }
  });

  it.each([
    ["an over-long post, counted X's way", () => input({ caption: "😀".repeat(141) })],
    ["a text post with a creative", () => input({ media: [image()] })],
    ["a MOV video", () => input({ type: "VIDEO", media: [{ ...video(), mimeType: "video/quicktime" }] })],
    ["a format X has no API for", () => input({ type: "CAROUSEL", media: [image(), image()] })],
  ])("refuses %s before any request", async (_label, post) => {
    const from = double.requests.length;
    await expect(provider.publish(credentials, account, post())).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(from);
  });
});

describe("when the reply goes missing", () => {
  it("calls a lost post reply possibly live", async () => {
    double.swallowNextTweet();
    await expect(make(300).publish(credentials, account, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls a gateway timeout possibly live", async () => {
    double.failWith("tweets", 504);
    await expect(provider.publish(credentials, account, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls an accepted post with no id possibly live", async () => {
    double.emptyNextTweet();
    await expect(provider.publish(credentials, account, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("does not call a failed upload ambiguous — nothing is visible until the post", async () => {
    double.failWith("append", 503);
    const failure = await provider
      .publish(credentials, account, input({ type: "SINGLE_IMAGE", media: [image()] }))
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
  });
});

describe("errors", () => {
  it("explains X's duplicate refusal — after an uncertain attempt, the first one usually went out", async () => {
    double.failWith("tweets", 403, {
      detail: "You are not allowed to create a Tweet with duplicate content.",
      type: "about:blank",
      title: "Forbidden",
      status: 403,
    });
    await expect(provider.publish(credentials, account, input())).rejects.toThrow(/duplicate of a recent post/);
  });

  it("says when the rate limit lifts", async () => {
    const reset = Math.floor(Date.UTC(2026, 8, 29, 14, 45) / 1000);
    double.failWith("tweets", 429, { title: "Too Many Requests" }, { "x-rate-limit-reset": String(reset) });
    await expect(provider.publish(credentials, account, input())).rejects.toThrow(/after 14:45 UTC/);
  });

  it("treats a 401 as dead credentials", async () => {
    double.failWith("tweets", 401, { title: "Unauthorized" });
    await expect(provider.publish(credentials, account, input())).rejects.toBeInstanceOf(CredentialsRejectedError);
  });
});

describe("length, the way X counts it", () => {
  it("counts a link as 23 and an emoji as two", () => {
    expect(textLength("https://northwind.test/a-very-long-path/that-goes-on-and-on?utm_source=x", "x-weighted")).toBe(23);
    expect(textLength("😀", "x-weighted")).toBe(2);
    expect(textLength("नमस्ते", "x-weighted")).toBe([..."नमस्ते"].length);
  });

  it("refuses at save a post that only overflows once the link and mentions are added", () => {
    const base = { contentItemId: "item", provider: "X", type: "TEXT" };
    // 260 fits alone; + a space + the link at 23 is 284; + two mentions is 297.
    const caption = "x".repeat(260);
    expect(socialPostSchema.safeParse({ ...base, caption }).success).toBe(true);
    expect(socialPostSchema.safeParse({ ...base, caption, linkUrl: "https://northwind.test/" }).success).toBe(false);
    expect(socialPostSchema.safeParse({ ...base, caption, mentions: ["northwind.bandra", "northwind.andheri"] }).success).toBe(false);
  });
});
