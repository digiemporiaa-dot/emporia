import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InstagramProvider } from "@/lib/social/instagram";
import { FacebookProvider } from "@/lib/social/facebook";
import { YouTubeProvider } from "@/lib/social/youtube";
import { GoogleBusinessProvider } from "@/lib/social/google-business";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { XProvider } from "@/lib/social/x";
import { CAPABILITIES } from "@/lib/social/capabilities";
import { parsePlatformTime, sameOriginNext } from "@/lib/social/recent";
import { startRouteDouble, type RouteDouble } from "./support/route-double";
import type { SocialProviderAdapter } from "@/lib/social/types";

/**
 * Listing an account's recent posts (brief §48), per platform, against a
 * stand-in that answers the way each platform documents.
 *
 * Pinned: only what falls inside the window is returned, and listing stops
 * once it reaches older posts; only public, published posts (no stories, no
 * private or unlisted videos, no rejected Business Profile posts); Meta's
 * `+0000` timestamps are read; paging links are followed only on the
 * platform's own host; a Facebook video post carries its video id as an alias;
 * and every adapter's capability flag matches whether it can list at all.
 */

const credentials = { accessToken: "token", refreshToken: null, expiresAt: null };
const since = new Date("2026-09-01T00:00:00Z");

describe("platform timestamps and paging links", () => {
  it("reads Meta's offset without a colon, and ISO, and refuses nonsense", () => {
    expect(parsePlatformTime("2026-09-25T10:00:00+0000")?.toISOString()).toBe("2026-09-25T10:00:00.000Z");
    expect(parsePlatformTime("2026-09-25T15:30:00+0530")?.toISOString()).toBe("2026-09-25T10:00:00.000Z");
    expect(parsePlatformTime("2026-09-25T10:00:00Z")?.toISOString()).toBe("2026-09-25T10:00:00.000Z");
    for (const value of ["", "yesterday", null, 42]) expect(parsePlatformTime(value)).toBeNull();
  });

  it("follows a next link only on the platform's own host", () => {
    expect(sameOriginNext("https://graph.instagram.com/v24.0/me/media?after=x", "https://graph.instagram.com/v24.0")).toBe(
      "https://graph.instagram.com/v24.0/me/media?after=x",
    );
    expect(sameOriginNext("https://evil.example/collect", "https://graph.instagram.com/v24.0")).toBeNull();
    expect(sameOriginNext("not a url", "https://graph.instagram.com")).toBeNull();
    expect(sameOriginNext(undefined, "https://graph.instagram.com")).toBeNull();
  });
});

describe("which platforms can list", () => {
  it("matches each adapter's capability to whether it implements listing", () => {
    const adapters: SocialProviderAdapter[] = [
      new InstagramProvider({ clientId: "a", clientSecret: "b" }),
      new FacebookProvider({ clientId: "a", clientSecret: "b" }),
      new YouTubeProvider({ clientId: "a", clientSecret: "b" }),
      new GoogleBusinessProvider({ clientId: "a", clientSecret: "b" }),
      new LinkedInProvider({ clientId: "a", clientSecret: "b" }),
      new XProvider({ clientId: "a", clientSecret: "b" }),
    ];
    for (const adapter of adapters) {
      expect(typeof adapter.listRecentPosts === "function", adapter.provider).toBe(CAPABILITIES[adapter.provider].recentPosts);
    }
    expect(CAPABILITIES.LINKEDIN.recentPosts).toBe(false);
    expect(CAPABILITIES.X.recentPosts).toBe(false);
  });
});

describe("listing recent posts", () => {
  let double: RouteDouble;
  beforeAll(async () => {
    double = await startRouteDouble();
  });
  afterAll(async () => {
    await double.close();
  });

  it("Instagram: feed posts and reels in the window, no stories, stopping at older posts", async () => {
    const provider = new InstagramProvider({ clientId: "a", clientSecret: "b", graphBase: double.url });
    double.on("GET /v24.0/me/media", (request) =>
      request.query["after"]
        ? { body: { data: [{ id: "should-not-be-read", timestamp: "2026-09-20T10:00:00+0000" }] } }
        : {
            body: {
              data: [
                { id: "reel-1", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://instagram.com/reel/1", thumbnail_url: "https://cdn/1.jpg", caption: "Monsoon sale", timestamp: "2026-09-25T10:00:00+0000" },
                { id: "story-1", media_type: "IMAGE", media_product_type: "STORY", timestamp: "2026-09-24T10:00:00+0000" },
                { id: "image-1", media_type: "IMAGE", media_product_type: "FEED", media_url: "https://cdn/2.jpg", timestamp: "2026-09-10T10:00:00+0000" },
                { id: "old-1", media_type: "IMAGE", timestamp: "2026-08-20T10:00:00+0000" },
              ],
              paging: { next: `${double.url}/v24.0/me/media?after=p2` },
            },
          },
    );
    const from = double.requests.length;
    const posts = await provider.listRecentPosts(credentials, { externalId: "ig" }, since);
    expect(posts.map((p) => [p.externalPostId, p.format])).toEqual([
      ["reel-1", "REELS"],
      ["image-1", "IMAGE"],
    ]);
    expect(posts[0]).toMatchObject({ externalUrl: "https://instagram.com/reel/1", caption: "Monsoon sale", thumbnailUrl: "https://cdn/1.jpg" });
    expect(posts[0]!.publishedAt.toISOString()).toBe("2026-09-25T10:00:00.000Z");
    expect(posts[1]!.thumbnailUrl).toBe("https://cdn/2.jpg");
    // Reached older posts on page one: page two is never asked for.
    expect(double.requests.slice(from).length).toBe(1);
    expect(double.requests.at(-1)!.headers.authorization).toBe("Bearer token");
  });

  it("Instagram: follows the next page on its own host, never another", async () => {
    const provider = new InstagramProvider({ clientId: "a", clientSecret: "b", graphBase: double.url });
    double.on("GET /v24.0/me/media", (request) =>
      request.query["after"] === "p2"
        ? { body: { data: [{ id: "page-2", media_type: "IMAGE", timestamp: "2026-09-05T10:00:00+0000" }], paging: { next: "https://evil.example/steal" } } }
        : { body: { data: [{ id: "page-1", media_type: "IMAGE", timestamp: "2026-09-25T10:00:00+0000" }], paging: { next: `${double.url}/v24.0/me/media?after=p2` } } },
    );
    const from = double.requests.length;
    const posts = await provider.listRecentPosts(credentials, { externalId: "ig" }, since);
    expect(posts.map((p) => p.externalPostId)).toEqual(["page-1", "page-2"]);
    expect(double.requests.slice(from).map((r) => r.query["after"] ?? null)).toEqual([null, "p2"]);
  });

  it("Facebook: the Page's own posts since the window, with a video post's video id as an alias", async () => {
    const provider = new FacebookProvider({ clientId: "a", clientSecret: "b", graphBase: double.url });
    double.on("GET /v26.0/1001/published_posts", () => ({
      body: {
        data: [
          {
            id: "1001_900",
            message: "Reel from the shop",
            permalink_url: "https://facebook.com/1001/posts/900",
            created_time: "2026-09-25T10:00:00+0000",
            status_type: "added_video",
            attachments: { data: [{ media_type: "video", target: { id: "555" } }] },
          },
          { id: "1001_901", message: "Photo", created_time: "2026-09-20T10:00:00+0000", attachments: { data: [{ media_type: "photo", target: { id: "777" } }] } },
          { id: "1001_800", created_time: "2026-08-01T10:00:00+0000" },
        ],
      },
    }));
    const from = double.requests.length;
    const posts = await provider.listRecentPosts(credentials, { externalId: "1001" }, since);
    expect(posts.map((p) => [p.externalPostId, p.aliases])).toEqual([
      ["1001_900", ["555"]],
      ["1001_901", []],
    ]);
    const call = double.requests[from]!;
    expect(call.query["since"]).toBe(String(since.getTime() / 1000));
    expect(call.query["fields"]).toContain("attachments");
  });

  it("Facebook: refuses an account id that is not a Page id before asking anything", async () => {
    const provider = new FacebookProvider({ clientId: "a", clientSecret: "b", graphBase: double.url });
    const from = double.requests.length;
    await expect(provider.listRecentPosts(credentials, { externalId: "../me" }, since)).rejects.toThrow();
    expect(double.requests.length).toBe(from);
  });

  it("YouTube: public uploads in the window only", async () => {
    const provider = new YouTubeProvider({ clientId: "a", clientSecret: "b", apiBase: double.url });
    double.on("GET /youtube/v3/channels", () => ({ body: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] } }));
    double.on("GET /youtube/v3/playlistItems", (request) => ({
      body: {
        items: [
          { snippet: { title: "Launch film", thumbnails: { default: { url: "https://i.ytimg/1.jpg" } } }, contentDetails: { videoId: "vid1", videoPublishedAt: "2026-09-22T05:00:00Z" }, status: { privacyStatus: "public" } },
          { snippet: { title: "Draft" }, contentDetails: { videoId: "vid2", videoPublishedAt: "2026-09-21T05:00:00Z" }, status: { privacyStatus: "private" } },
          { snippet: { title: "For the client" }, contentDetails: { videoId: "vid3", videoPublishedAt: "2026-09-20T05:00:00Z" }, status: { privacyStatus: "unlisted" } },
          { snippet: { title: "Old" }, contentDetails: { videoId: "vid4", videoPublishedAt: "2026-07-01T05:00:00Z" }, status: { privacyStatus: "public" } },
        ],
        nextPageToken: request.query["pageToken"] ? undefined : "next",
      },
    }));
    const from = double.requests.length;
    const posts = await provider.listRecentPosts(credentials, { externalId: "UC1" }, since);
    expect(posts).toEqual([
      expect.objectContaining({ externalPostId: "vid1", externalUrl: "https://www.youtube.com/watch?v=vid1", caption: "Launch film", format: "VIDEO" }),
    ]);
    const playlistCall = double.requests.slice(from).find((r) => r.path === "/youtube/v3/playlistItems")!;
    expect(playlistCall.query).toMatchObject({ playlistId: "UU123", part: "snippet,contentDetails,status" });
    // Reached older uploads: no second page.
    expect(double.requests.slice(from).filter((r) => r.path === "/youtube/v3/playlistItems").length).toBe(1);
  });

  it("Business Profile: the location's live posts in the window, newest first", async () => {
    const provider = new GoogleBusinessProvider({ clientId: "a", clientSecret: "b", postsBase: double.url });
    double.on("GET /v4/accounts/111/locations/1002/localPosts", (request) =>
      request.query["pageToken"]
        ? { body: { localPosts: [{ name: "accounts/111/locations/1002/localPosts/3", summary: "Diwali hours", searchUrl: "https://g.page/3", createTime: "2026-09-26T08:00:00Z", state: "LIVE", topicType: "EVENT" }] } }
        : {
            body: {
              localPosts: [
                { name: "accounts/111/locations/1002/localPosts/1", summary: "Open late", createTime: "2026-09-12T08:00:00Z", state: "LIVE", topicType: "STANDARD" },
                { name: "accounts/111/locations/1002/localPosts/2", summary: "Refused", createTime: "2026-09-13T08:00:00Z", state: "REJECTED" },
                { name: "accounts/111/locations/1002/localPosts/0", summary: "Old", createTime: "2026-08-01T08:00:00Z", state: "LIVE" },
              ],
              nextPageToken: "p2",
            },
          },
    );
    const posts = await provider.listRecentPosts(credentials, { externalId: "locations/1002", externalParentId: "accounts/111" }, since);
    expect(posts.map((p) => p.externalPostId)).toEqual([
      "accounts/111/locations/1002/localPosts/3",
      "accounts/111/locations/1002/localPosts/1",
    ]);
    expect(posts[0]).toMatchObject({ caption: "Diwali hours", externalUrl: "https://g.page/3", format: "EVENT" });
  });
});
