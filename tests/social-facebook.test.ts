import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FacebookProvider, FACEBOOK_SCOPES } from "@/lib/social/facebook";
import {
  AmbiguousPublishError,
  CredentialsRejectedError,
  ProviderUnreachableError,
} from "@/lib/social/errors";
import { ValidationError } from "@/lib/errors";
import { startFacebookDouble, type FacebookDouble } from "./support/facebook-double";
import type { PublishInput } from "@/lib/social/types";

/**
 * The Facebook adapter, against a double that speaks the Graph API.
 *
 * Three things matter most. A sign-in lists only Pages it can actually post
 * to, and hands back no token while listing. Each format has exactly one call
 * that makes the post visible, and only that call may be ambiguous. And a
 * metric Meta has retired comes back absent, never as zero, without taking
 * the other numbers with it.
 */

let double: FacebookDouble;
let provider: FacebookProvider;

const user = { accessToken: "fb-long-user", refreshToken: null, expiresAt: null };
const page = { accessToken: "page-token-1001", refreshToken: null, expiresAt: null };
const account = { externalId: "1001" };

function make(timeoutMs = 2_000) {
  return new FacebookProvider({
    clientId: "fb-app-id",
    clientSecret: "fb-app-secret",
    dialogBase: double.url,
    graphBase: double.url,
    videoBase: double.url,
    ruploadBase: double.url,
    timeoutMs,
  });
}

const jpeg = (n = 1) => ({ url: `https://cdn.example.com/${n}.jpg`, mimeType: "image/jpeg", thumbnailUrl: null });
const png = (n = 1) => ({ url: `https://cdn.example.com/${n}.png`, mimeType: "image/png", thumbnailUrl: null });
const mp4 = (n = 1) => ({ url: `https://cdn.example.com/${n}.mp4`, mimeType: "video/mp4", thumbnailUrl: null });

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

function since(from: number): string[] {
  return double.requests
    .slice(from)
    .map((r) => `${r.method} ${r.path.replace(/^\/v[\d.]+/, "")}`);
}

const body = (i: number) => JSON.parse(double.requests[i]!.body || "{}") as Record<string, unknown>;

beforeAll(async () => {
  double = await startFacebookDouble();
  provider = make();
});

afterAll(async () => {
  await double.close();
});

describe("connecting", () => {
  it("sends the operator to Facebook's dialog with the Page scopes and no secret", () => {
    const url = new URL(provider.authorizationUrl("signed-state", "https://emporia.test/cb"));
    expect(url.pathname).toBe("/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("fb-app-id");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("redirect_uri")).toBe("https://emporia.test/cb");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([...FACEBOOK_SCOPES]);
    expect(url.toString()).not.toContain("fb-app-secret");
  });

  it("trades the code for a long-lived user token, because a Page token inherits its lifetime", async () => {
    const from = double.requests.length;
    const credentials = await provider.exchangeCode("the-code", "https://emporia.test/cb");

    expect(credentials.accessToken).toBe("fb-long-user");
    expect(credentials.refreshToken).toBeNull();
    const [shortCall, longCall] = double.requests.slice(from);
    expect(shortCall!.query).toMatchObject({ code: "the-code", redirect_uri: "https://emporia.test/cb" });
    expect(longCall!.query).toMatchObject({ grant_type: "fb_exchange_token", fb_exchange_token: "fb-short-user" });
  });

  it("records the permissions the person actually allowed, not the ones asked for", async () => {
    double.permissions([
      { permission: "pages_show_list", status: "granted" },
      { permission: "pages_manage_posts", status: "declined" },
      { permission: "read_insights", status: "granted" },
    ]);
    const credentials = await provider.exchangeCode("the-code", "https://emporia.test/cb");
    expect(credentials.scopes).toEqual(["pages_show_list", "read_insights"]);
    // Read with the long-lived user token.
    expect(double.requests.at(-1)).toMatchObject({ path: expect.stringMatching(/\/me\/permissions$/), query: { access_token: "fb-long-user" } });
  });

  it("connects anyway when the permissions cannot be read, as not reported", async () => {
    double.failWith("permissions", 500, { error: { message: "boom", code: 1 } });
    const credentials = await provider.exchangeCode("the-code", "https://emporia.test/cb");
    expect(credentials.accessToken).toBe("fb-long-user");
    expect(credentials.scopes).toBeNull();
  });

  it("carries the person's grant to the chosen Page", async () => {
    const selected = await provider.selectAccount({ ...user, scopes: ["pages_manage_posts"] }, "1002");
    expect(selected.credentials.scopes).toEqual(["pages_manage_posts"]);
  });

  it("lists only the Pages the sign-in can post to, across pages of results, with no token", async () => {
    double.pageSize(1);
    try {
      const pages = await provider.listAccounts(user);
      expect(pages.map((p) => p.externalId)).toEqual(["1001", "1002"]);
      expect(pages[0]).toMatchObject({
        name: "Northwind Studio",
        username: "northwindstudio",
        profileUrl: "https://www.facebook.com/northwindstudio",
      });
      // The double hands out Page tokens in this response, as Graph does.
      // None of them may leave the adapter.
      expect(JSON.stringify(pages)).not.toContain("page-token");
    } finally {
      double.pageSize(100);
    }
  });

  it("swaps the person's token for the chosen Page's own", async () => {
    const selected = await provider.selectAccount(user, "1002");
    expect(selected.account.externalId).toBe("1002");
    expect(selected.credentials).toEqual({ accessToken: "page-token-1002", refreshToken: null, expiresAt: null, scopes: null });
  });

  it("refuses a Page id that is not one before asking Facebook anything", async () => {
    const from = double.requests.length;
    await expect(provider.selectAccount(user, "../me")).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(from);
  });

  it("refuses a Page Facebook grants no token for", async () => {
    double.emptyNext("page");
    await expect(provider.selectAccount(user, "1001")).rejects.toBeInstanceOf(ValidationError);
  });

  it("reads the Page back with its own token", async () => {
    const me = await provider.getAccount(page);
    expect(me).toMatchObject({ externalId: "1001", name: "Northwind Studio" });
  });

  it("does not pretend to refresh a token Facebook never expires", async () => {
    await expect(provider.refresh()).rejects.toBeInstanceOf(CredentialsRejectedError);
  });
});

describe("publishing", () => {
  it("posts text to the Page feed, with the token in the body and a valid proof", async () => {
    const from = double.requests.length;
    const result = await provider.publish(page, account, input({ hashtags: ["festive"] }));

    expect(result).toEqual({
      externalPostId: "1001_900",
      externalUrl: "https://www.facebook.com/1001/posts/900",
    });
    expect(since(from)[0]).toBe("POST /1001/feed");
    const sent = body(from);
    expect(sent["message"]).toBe("Festive hours this week: 10am to 9pm.\n\n#festive");
    expect(sent["access_token"]).toBe("page-token-1001");
    expect(sent["appsecret_proof"]).toBe(
      createHmac("sha256", "fb-app-secret").update("page-token-1001").digest("hex"),
    );
    // Never in a POST's URL, where proxies and logs would keep it.
    expect(double.requests[from]!.query["access_token"]).toBeUndefined();
  });

  it("sends a link post's link as the link, not twice in the text", async () => {
    const from = double.requests.length;
    await provider.publish(page, account, input({ type: "LINK", linkUrl: "https://northwind.test/?utm_source=facebook" }));
    const sent = body(from);
    expect(sent["link"]).toBe("https://northwind.test/?utm_source=facebook");
    expect(sent["message"]).not.toContain("northwind.test");
  });

  it("publishes a single image and keeps the post's id, not the photo's", async () => {
    const from = double.requests.length;
    const result = await provider.publish(
      page,
      account,
      input({ type: "SINGLE_IMAGE", media: [png()], linkUrl: "https://northwind.test/sale" }),
    );
    expect(result.externalPostId).toBe("1001_901");
    const sent = body(from);
    expect(sent["url"]).toBe("https://cdn.example.com/1.png");
    // Outside a link post the link belongs in the text, where it is clickable.
    expect(sent["caption"]).toContain("https://northwind.test/sale");
  });

  it("builds a multi-photo post from unpublished photos, then one feed post", async () => {
    const from = double.requests.length;
    const result = await provider.publish(
      page,
      account,
      input({ type: "CAROUSEL", media: [jpeg(1), jpeg(2), jpeg(3)] }),
    );

    expect(since(from).slice(0, 4)).toEqual([
      "POST /1001/photos",
      "POST /1001/photos",
      "POST /1001/photos",
      "POST /1001/feed",
    ]);
    for (const i of [0, 1, 2]) expect(body(from + i)["published"]).toBe(false);
    const attached = body(from + 3)["attached_media"] as { media_fbid: string }[];
    expect(attached).toHaveLength(3);
    expect(attached.every((a) => a.media_fbid.startsWith("photo-"))).toBe(true);
    expect(result.externalPostId).toBe("1001_900");
  });

  it("publishes a video by URL and resolves its relative permalink", async () => {
    const from = double.requests.length;
    const result = await provider.publish(page, account, input({ type: "VIDEO", media: [mp4()] }));
    expect(since(from)[0]).toBe("POST /1001/videos");
    expect(body(from)).toMatchObject({ file_url: "https://cdn.example.com/1.mp4" });
    expect(result).toEqual({
      externalPostId: "7001",
      externalUrl: "https://www.facebook.com/northwindstudio/videos/7001/",
    });
  });

  it("publishes a reel in three phases, handing Facebook the file's URL in a header", async () => {
    const from = double.requests.length;
    const result = await provider.publish(page, account, input({ type: "REEL", media: [mp4()] }));

    expect(since(from).slice(0, 3)).toEqual([
      "POST /1001/video_reels",
      "POST /video-upload/v26.0/8001",
      "POST /1001/video_reels",
    ]);
    const upload = double.requests[from + 1]!;
    expect(upload.headers.file_url).toBe("https://cdn.example.com/1.mp4");
    expect(upload.headers.authorization).toBe("OAuth page-token-1001");
    expect(body(from + 2)).toMatchObject({ upload_phase: "finish", video_id: "8001", video_state: "PUBLISHED" });
    // `finish` answers {success:true}; the video id was already known.
    expect(result.externalPostId).toBe("8001");
  });

  it.each([
    ["a text post with a creative", input({ media: [jpeg()] })],
    ["a link post without a link", input({ type: "LINK" })],
    ["a multi-photo post with a video", input({ type: "CAROUSEL", media: [jpeg(), mp4()] })],
    ["a multi-photo post of one", input({ type: "CAROUSEL", media: [jpeg()] })],
    ["a reel without a video", input({ type: "REEL", media: [jpeg()] })],
    ["a format Facebook has no API for", input({ type: "STORY", media: [jpeg()] })],
  ])("refuses %s before any request", async (_label, post) => {
    const from = double.requests.length;
    await expect(provider.publish(page, account, post)).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(from);
  });
});

describe("when the reply goes missing", () => {
  it("calls a lost feed reply possibly live", async () => {
    double.swallowNext("feed");
    await expect(make(300).publish(page, account, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls a gateway timeout possibly live", async () => {
    double.failWith("photos", 504);
    await expect(
      provider.publish(page, account, input({ type: "SINGLE_IMAGE", media: [jpeg()] })),
    ).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls an accepted post with no id possibly live", async () => {
    double.emptyNext("feed");
    await expect(provider.publish(page, account, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls a lost reel finish possibly live", async () => {
    double.swallowNext("reelFinish");
    await expect(
      make(300).publish(page, account, input({ type: "REEL", media: [mp4()] })),
    ).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("keeps an ordinary server error retryable", async () => {
    double.failWith("feed", 500, { error: { message: "An unknown error occurred", code: 1 } });
    const failure = await provider.publish(page, account, input()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
  });

  it("does not call a lost unpublished-photo upload ambiguous — nothing was shown", async () => {
    double.swallowNext("photos");
    const failure = await make(300)
      .publish(page, account, input({ type: "CAROUSEL", media: [jpeg(1), jpeg(2)] }))
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProviderUnreachableError);
    expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
  });

  it("does not call a lost reel start ambiguous", async () => {
    double.swallowNext("reelStart");
    const failure = await make(300)
      .publish(page, account, input({ type: "REEL", media: [mp4()] }))
      .catch((e: unknown) => e);
    expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
  });
});

describe("errors", () => {
  it("treats Graph code 190 as a dead token", async () => {
    double.failWith("feed", 400, { error: { message: "Error validating access token", code: 190 } });
    await expect(provider.publish(page, account, input())).rejects.toBeInstanceOf(CredentialsRejectedError);
  });

  it("says so when rate limited", async () => {
    double.failWith("feed", 400, { error: { message: "Application request limit reached", code: 4 } });
    await expect(provider.publish(page, account, input())).rejects.toThrow(/rate limiting/);
  });
});

describe("metrics", () => {
  it("reads reactions, comments, shares, reach and clicks for a post", async () => {
    expect(await provider.getMetrics(page, account, "1001_900")).toMatchObject({
      likes: 31,
      comments: 4,
      shares: 2,
      reach: 800,
      clicks: 37,
      impressions: null,
      saves: null,
    });
  });

  it("leaves a retired metric absent without losing the others", async () => {
    double.failMetric("post_clicks", 400, { error: { message: "(#100) The value must be a valid insights metric", code: 100 } });
    try {
      const metrics = await provider.getMetrics(page, account, "1001_900");
      expect(metrics.clicks).toBeNull();
      expect(metrics.reach).toBe(800);
      expect(metrics.likes).toBe(31);
    } finally {
      double.failMetric("post_clicks", 0);
    }
  });

  it("counts a post nobody shared as zero shares — Graph omits the field", async () => {
    double.noSharesNext();
    expect((await provider.getMetrics(page, account, "1001_900")).shares).toBe(0);
  });

  it("reads a still-processing video's own counts, with shares absent", async () => {
    double.videoPost(null);
    const metrics = await provider.getMetrics(page, account, "7001");
    expect(metrics).toMatchObject({ likes: 31, comments: 4, shares: null, reach: null });
  });

  it("follows a processed video to its post", async () => {
    double.videoPost("1001_950");
    try {
      const from = double.requests.length;
      const metrics = await provider.getMetrics(page, account, "7001");
      expect(metrics).toMatchObject({ likes: 31, shares: 2, reach: 800 });
      expect(double.requests.slice(from).some((r) => r.path.endsWith("/1001_950"))).toBe(true);
    } finally {
      double.videoPost(null);
    }
  });

  it("throws on a dead token even from insights", async () => {
    double.failMetric("post_impressions_unique", 400, { error: { message: "expired", code: 190 } });
    try {
      await expect(provider.getMetrics(page, account, "1001_900")).rejects.toBeInstanceOf(
        CredentialsRejectedError,
      );
    } finally {
      double.failMetric("post_impressions_unique", 0);
    }
  });
});
