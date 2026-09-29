import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { YouTubeProvider, YOUTUBE_SCOPES } from "@/lib/social/youtube";
import { AmbiguousPublishError, CredentialsRejectedError } from "@/lib/social/errors";
import { ValidationError } from "@/lib/errors";
import { startYouTubeDouble, type YouTubeDouble } from "./support/youtube-double";
import type { PublishInput } from "@/lib/social/types";

/**
 * The YouTube adapter, against a double for Google's token endpoint, the
 * Data API, resumable uploads and the storage the file comes from.
 *
 * The part worth reading is "when the upload's reply goes missing": a
 * resumable session can be asked whether it finished, so a lost reply is
 * resolved into "it exists", "it does not", or — only when even that
 * question goes unanswered — "it may".
 */

let double: YouTubeDouble;
let provider: YouTubeProvider;

const credentials = { accessToken: "yt-access", refreshToken: "yt-refresh", expiresAt: null };
const account = { externalId: "UC123" };

function make(uploadTimeoutMs = 3_000) {
  return new YouTubeProvider({
    clientId: "yt-client",
    clientSecret: "yt-secret",
    authorizeUrl: `${double.url}/authorize`,
    tokenUrl: `${double.url}/token`,
    apiBase: double.url,
    timeoutMs: 2_000,
    uploadTimeoutMs,
  });
}

function input(over: Partial<PublishInput> = {}): PublishInput {
  return {
    type: "YOUTUBE_VIDEO",
    caption: "How we plan a festive shoot, start to finish.",
    headline: "Planning a festive shoot",
    hashtags: ["behindthescenes"],
    mentions: [],
    callToAction: null,
    firstComment: null,
    linkUrl: null,
    media: [{ url: `${double.url}/media/clip.mp4`, mimeType: "video/mp4", thumbnailUrl: null }],
    ...over,
  };
}

function since(from: number): string[] {
  return double.requests.slice(from).map((r) => `${r.method} ${r.path}`);
}

beforeAll(async () => {
  double = await startYouTubeDouble();
  provider = make();
});

afterAll(async () => {
  await double.close();
});

describe("connecting", () => {
  it("asks Google for offline access with consent shown, so a refresh token comes back", () => {
    const url = new URL(provider.authorizationUrl("signed-state", "https://emporia.test/cb"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...YOUTUBE_SCOPES]);
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.toString()).not.toContain("yt-secret");
  });

  it("keeps both tokens from the exchange, with the secret in the body", async () => {
    const from = double.requests.length;
    const result = await provider.exchangeCode("the-code", "https://emporia.test/cb");
    expect(result.accessToken).toBe("yt-access");
    expect(result.refreshToken).toBe("yt-refresh");
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    const call = double.requests[from]!;
    expect(call.query["client_secret"]).toBeUndefined();
    expect(new URLSearchParams(call.body).get("client_secret")).toBe("yt-secret");
  });

  it("refuses a connection where the upload box was unticked", async () => {
    double.grantedScopes("https://www.googleapis.com/auth/youtube.readonly");
    try {
      await expect(provider.exchangeCode("c", "https://emporia.test/cb")).rejects.toThrow(/not granted/);
    } finally {
      double.grantedScopes(YOUTUBE_SCOPES.join(" "));
    }
  });

  it("refuses a connection with no lasting access", async () => {
    double.noRefreshTokenNext();
    await expect(provider.exchangeCode("c", "https://emporia.test/cb")).rejects.toThrow(/lasting access/);
  });

  it("renews the access token and keeps the refresh token Google did not resend", async () => {
    const fresh = await provider.refresh(credentials);
    expect(fresh).toMatchObject({ accessToken: "yt-access-2", refreshToken: "yt-refresh" });
  });

  it("treats a revoked refresh token as a dead connection", async () => {
    await expect(
      provider.refresh({ ...credentials, refreshToken: "revoked" }),
    ).rejects.toBeInstanceOf(CredentialsRejectedError);
  });

  it("reads the channel the person chose on Google's screen", async () => {
    expect(await provider.getAccount(credentials)).toMatchObject({
      externalId: "UC123",
      name: "Northwind Studio",
      username: "northwindstudio",
      profileUrl: "https://www.youtube.com/@northwindstudio",
    });
  });

  it("refuses a Google account with no channel", async () => {
    double.noChannel(true);
    try {
      await expect(provider.getAccount(credentials)).rejects.toThrow(/no YouTube channel/);
    } finally {
      double.noChannel(false);
    }
  });
});

describe("publishing", () => {
  it("streams the file from storage into a resumable session", async () => {
    const from = double.requests.length;
    const result = await provider.publish(credentials, account, input());

    expect(since(from)).toEqual([
      "GET /media/clip.mp4",
      "POST /upload/youtube/v3/videos",
      "PUT /upload/session/s-1",
    ]);
    const [, session, upload] = double.requests.slice(from);
    expect(session!.query).toMatchObject({ uploadType: "resumable", part: "snippet,status" });
    expect(session!.headers["x-upload-content-length"]).toBe(String(double.videoSize));
    expect(session!.headers["x-upload-content-type"]).toBe("video/mp4");
    expect(JSON.parse(session!.body)).toEqual({
      snippet: {
        title: "Planning a festive shoot",
        description: "How we plan a festive shoot, start to finish.\n\n#behindthescenes",
        tags: ["behindthescenes"],
        categoryId: "22",
      },
      status: { privacyStatus: "public" },
    });
    // Every byte arrived.
    expect(upload!.bytes).toBe(double.videoSize);
    expect(result).toEqual({ externalPostId: "vid-1", externalUrl: "https://www.youtube.com/watch?v=vid-1" });
  });

  it("tags a Short so YouTube can recognise it, and links it as one", async () => {
    const from = double.requests.length;
    const result = await provider.publish(credentials, account, input({ type: "YOUTUBE_SHORT" }));
    const session = double.requests.slice(from).find((r) => r.path === "/upload/youtube/v3/videos")!;
    expect(JSON.parse(session.body).snippet.description).toMatch(/#Shorts$/);
    expect(result.externalUrl).toBe("https://www.youtube.com/shorts/vid-1");
  });

  it("warns, rather than fails, when YouTube keeps the video private", async () => {
    double.privacy("private");
    try {
      const result = await provider.publish(credentials, account, input());
      expect(result.externalPostId).toBe("vid-1");
      expect(result.warnings?.[0]).toMatch(/kept this video private/);
    } finally {
      double.privacy("public");
    }
  });

  // Factories: the table is built before the double is listening.
  it.each([
    ["no title", () => input({ headline: null })],
    ["a title over 100 characters", () => input({ headline: "x".repeat(101) })],
    ["angle brackets", () => input({ caption: "Use <b>bold</b>" })],
    ["an image", () => input({ media: [{ url: "https://cdn.example.com/a.jpg", mimeType: "image/jpeg", thumbnailUrl: null }] })],
    ["two videos", () => input({ media: [input().media[0]!, input().media[0]!] })],
    ["a format YouTube does not have", () => input({ type: "CAROUSEL" })],
  ])("refuses %s before any request", async (_label, post) => {
    const from = double.requests.length;
    await expect(provider.publish(credentials, account, post())).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(from);
  });

  it("refuses a file storage will not size, before opening a session", async () => {
    double.chunkedMedia(true);
    try {
      const from = double.requests.length;
      await expect(provider.publish(credentials, account, input())).rejects.toThrow(/how large/);
      expect(since(from)).toEqual(["GET /media/clip.mp4"]);
    } finally {
      double.chunkedMedia(false);
    }
  });
});

describe("when the upload's reply goes missing", () => {
  it("asks the session, and takes a finished upload as the success it is", async () => {
    double.swallowNextUpload();
    double.sessionAnswer("complete");
    const from = double.requests.length;
    const result = await make(500).publish(credentials, account, input());

    expect(result.externalPostId).toBe("vid-1");
    const query = double.requests.slice(from).find((r) => r.headers["content-range"]?.startsWith("bytes */"));
    expect(query?.headers["content-range"]).toBe(`bytes */${double.videoSize}`);
  });

  it("calls an unfinished upload a plain retry — YouTube makes nothing from part of a file", async () => {
    double.swallowNextUpload();
    double.sessionAnswer("incomplete");
    const failure = await make(500).publish(credentials, account, input()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls it possibly live only when the session cannot answer either", async () => {
    double.swallowNextUpload();
    double.sessionAnswer("error");
    await expect(make(500).publish(credentials, account, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("asks the session after a server error on the upload too", async () => {
    double.failWith("upload", 503, { error: { code: 503, message: "backend" } });
    double.sessionAnswer("complete");
    expect((await provider.publish(credentials, account, input())).externalPostId).toBe("vid-1");
  });

  it("does not treat a lost session-opening reply as ambiguous — no video exists yet", async () => {
    double.failWith("session", 500, { error: { code: 500 } });
    const failure = await provider.publish(credentials, account, input()).catch((e: unknown) => e);
    expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
  });

  afterAll(() => double.sessionAnswer("complete"));
});

describe("errors", () => {
  it("says the daily quota is used up, in words", async () => {
    double.failWith("session", 403, { error: { code: 403, errors: [{ reason: "quotaExceeded" }] } });
    await expect(provider.publish(credentials, account, input())).rejects.toThrow(/daily API quota/);
  });

  it("treats a 401 as dead credentials", async () => {
    double.failWith("session", 401, { error: { code: 401 } });
    await expect(provider.publish(credentials, account, input())).rejects.toBeInstanceOf(
      CredentialsRejectedError,
    );
  });

  it("treats a missing permission as needing reconnection", async () => {
    double.failWith("channels", 403, { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } });
    await expect(provider.getAccount(credentials)).rejects.toBeInstanceOf(CredentialsRejectedError);
  });
});

describe("metrics", () => {
  it("reads views, likes and comments, parsed from YouTube's strings", async () => {
    expect(await provider.getMetrics(credentials, account, "vid-1")).toMatchObject({
      videoViews: 1520,
      likes: 48,
      comments: 7,
      watchTimeSeconds: null,
      shares: null,
    });
  });

  it("leaves hidden likes absent, not zero", async () => {
    double.hideLikes(true);
    try {
      expect((await provider.getMetrics(credentials, account, "vid-1")).likes).toBeNull();
    } finally {
      double.hideLikes(false);
    }
  });

  it("says so when the video is gone", async () => {
    await expect(provider.getMetrics(credentials, account, "deleted")).rejects.toThrow(/no video/);
  });
});
