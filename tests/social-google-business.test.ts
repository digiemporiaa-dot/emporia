import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleBusinessProvider, GOOGLE_BUSINESS_SCOPES } from "@/lib/social/google-business";
import { AmbiguousPublishError, CredentialsRejectedError } from "@/lib/social/errors";
import { ValidationError } from "@/lib/errors";
import { socialPostSchema } from "@/lib/validation/social";
import { startGoogleBusinessDouble, type GoogleBusinessDouble } from "./support/google-business-double";
import type { PublishInput } from "@/lib/social/types";

/**
 * The Business Profile adapter, against a double for Google's three
 * Business Profile APIs.
 *
 * What is pinned: only locations Google says can take posts are offered, each
 * once however many accounts reach it; a location is posted to through the
 * account it was offered under; the button is one of Google's own; and the
 * create call — the only call — is the one that may be ambiguous.
 */

let double: GoogleBusinessDouble;
let provider: GoogleBusinessProvider;

const credentials = { accessToken: "gbp-access", refreshToken: "gbp-refresh", expiresAt: null };
const location = { externalId: "locations/1001", externalParentId: "accounts/111" };

function make(timeoutMs = 2_000) {
  return new GoogleBusinessProvider({
    clientId: "gbp-client",
    clientSecret: "gbp-secret",
    authorizeUrl: `${double.url}/authorize`,
    tokenUrl: `${double.url}/token`,
    accountsBase: double.url,
    infoBase: double.url,
    postsBase: double.url,
    timeoutMs,
  });
}

function input(over: Partial<PublishInput> = {}): PublishInput {
  return {
    type: "GBP_POST",
    caption: "Festive hours this week: 10am to 9pm, every day.",
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

const lastBody = () => JSON.parse(double.requests.at(-1)!.body) as Record<string, unknown>;

beforeAll(async () => {
  double = await startGoogleBusinessDouble();
  provider = make();
});

afterAll(async () => {
  await double.close();
});

describe("connecting", () => {
  it("asks Google for lasting access to manage the business", () => {
    const url = new URL(provider.authorizationUrl("state", "https://emporia.test/cb"));
    expect(url.searchParams.get("scope")).toBe(GOOGLE_BUSINESS_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("offers each postable location once, named by its town, with no token", async () => {
    const offered = await provider.listAccounts(credentials);
    expect(offered.map((o) => o.externalId)).toEqual(["locations/1001", "locations/1002"]);
    expect(offered[0]).toMatchObject({
      name: "Northwind Studio — Bandra",
      externalParentId: "accounts/111",
      profileUrl: "https://maps.google.com/?cid=1001",
    });
    expect(offered[1]!.name).toBe("Northwind Studio — Andheri");
    expect(JSON.stringify(offered)).not.toContain("gbp-access");
  });

  it("follows Google's pages of accounts and of locations", async () => {
    double.paginate(true);
    try {
      const offered = await provider.listAccounts(credentials);
      expect(offered.map((o) => o.externalId)).toEqual(["locations/1001", "locations/1002"]);
      const pageTokens = double.requests.filter((r) => r.query["pageToken"]).length;
      expect(pageTokens).toBeGreaterThan(0);
    } finally {
      double.paginate(false);
    }
  });

  it("selects a location with the account it is reached through, from Google, not the browser", async () => {
    const selected = await provider.selectAccount(credentials, "locations/1002");
    expect(selected.account).toMatchObject({ externalId: "locations/1002", externalParentId: "accounts/111" });
    // The person's own Google tokens: there is no per-location token.
    expect(selected.credentials).toBe(credentials);
  });

  it("refuses a location that cannot take posts, even by id", async () => {
    await expect(provider.selectAccount(credentials, "locations/1003")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses something that is not a location id before asking Google", async () => {
    const from = double.requests.length;
    await expect(provider.selectAccount(credentials, "accounts/111")).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(from);
  });

  it("re-reads a connected location by name", async () => {
    expect(await provider.getAccount(credentials, location)).toMatchObject({
      externalId: "locations/1001",
      externalParentId: "accounts/111",
      name: "Northwind Studio — Bandra",
    });
  });

  it("will not guess a location when none is named", async () => {
    await expect(provider.getAccount(credentials)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("publishing", () => {
  it("creates a standard post on the location, through its account", async () => {
    const result = await provider.publish(
      credentials,
      location,
      input({
        callToAction: "BOOK",
        linkUrl: "https://northwind.test/book?utm_source=google",
        media: [{ url: "https://cdn.example.com/room.jpg", mimeType: "image/jpeg", thumbnailUrl: null }],
      }),
    );

    expect(double.requests.at(-1)!.path).toBe("/v4/accounts/111/locations/1001/localPosts");
    expect(double.requests.at(-1)!.headers.authorization).toBe("Bearer gbp-access");
    expect(lastBody()).toEqual({
      languageCode: "en",
      topicType: "STANDARD",
      summary: "Festive hours this week: 10am to 9pm, every day.",
      callToAction: { actionType: "BOOK", url: "https://northwind.test/book?utm_source=google" },
      media: [{ mediaFormat: "PHOTO", sourceUrl: "https://cdn.example.com/room.jpg" }],
    });
    expect(result).toEqual({
      externalPostId: "accounts/111/locations/1001/localPosts/555",
      externalUrl: "https://local.google.com/place?use=posts&lpsid=555",
    });
  });

  it("puts a bare link behind a 'Learn more' button — the button is the link", async () => {
    await provider.publish(credentials, location, input({ linkUrl: "https://northwind.test/" }));
    expect(lastBody()["callToAction"]).toEqual({ actionType: "LEARN_MORE", url: "https://northwind.test/" });
  });

  it("sends 'Call now' with no link — it dials the profile's number", async () => {
    await provider.publish(credentials, location, input({ callToAction: "CALL" }));
    expect(lastBody()["callToAction"]).toEqual({ actionType: "CALL" });
  });

  it.each([
    ["no text", () => input({ caption: " " })],
    ["two photos", () => input({ media: [1, 2].map((n) => ({ url: `https://cdn.example.com/${n}.jpg`, mimeType: "image/jpeg", thumbnailUrl: null })) })],
    ["a video", () => input({ media: [{ url: "https://cdn.example.com/a.mp4", mimeType: "video/mp4", thumbnailUrl: null }] })],
    ["a button Google does not have", () => input({ callToAction: "Visit us!" })],
    ["a booking button with nowhere to go", () => input({ callToAction: "BOOK" })],
    ["a format Business Profile does not have", () => input({ type: "CAROUSEL" })],
  ])("refuses %s before any request", async (_label, post) => {
    const from = double.requests.length;
    await expect(provider.publish(credentials, location, post())).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(from);
  });

  it("refuses a location stored without its account, rather than guessing one", async () => {
    const from = double.requests.length;
    await expect(
      provider.publish(credentials, { externalId: "locations/1001", externalParentId: null }, input()),
    ).rejects.toThrow(/Reconnect/);
    expect(double.requests.length).toBe(from);
  });

  it("fails a post Google rejected, with the likely cause — a retry would be rejected too", async () => {
    double.postState("REJECTED");
    try {
      const failure = await provider.publish(credentials, location, input()).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ValidationError);
      expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
      expect(String((failure as Error).message)).toMatch(/content policies/);
    } finally {
      double.postState("LIVE");
    }
  });

  it("publishes a post still under Google's review, and says so", async () => {
    double.postState("PROCESSING");
    try {
      const result = await provider.publish(credentials, location, input());
      expect(result.warnings?.[0]).toMatch(/still reviewing/);
    } finally {
      double.postState("LIVE");
    }
  });
});

describe("when the reply goes missing", () => {
  it("calls a lost reply possibly live", async () => {
    double.swallowNextPost();
    await expect(make(300).publish(credentials, location, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls a gateway timeout possibly live", async () => {
    double.failWith("post", 504);
    await expect(provider.publish(credentials, location, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("calls an accepted post with no name possibly live", async () => {
    double.emptyNextPost();
    await expect(provider.publish(credentials, location, input())).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it("keeps an ordinary server error retryable", async () => {
    double.failWith("post", 500, { error: { code: 500, status: "INTERNAL" } });
    const failure = await provider.publish(credentials, location, input()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure).not.toBeInstanceOf(AmbiguousPublishError);
  });
});

describe("errors", () => {
  it("explains a quota refusal — an unapproved project has none", async () => {
    double.failWith("accounts", 429, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } });
    await expect(provider.listAccounts(credentials)).rejects.toThrow(/not yet approved/);
  });

  it("treats a 401 as dead credentials", async () => {
    double.failWith("post", 401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    await expect(provider.publish(credentials, location, input())).rejects.toBeInstanceOf(CredentialsRejectedError);
  });

  it("does not claim per-post metrics it cannot have", async () => {
    await expect(provider.getMetrics()).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the editor's rules for Google's buttons", () => {
  const base = { contentItemId: "item", provider: "GOOGLE_BUSINESS_PROFILE", type: "GBP_POST", caption: "Open late." };

  it("accepts one of Google's buttons with its link", () => {
    expect(socialPostSchema.safeParse({ ...base, callToAction: "LEARN_MORE", linkUrl: "https://northwind.test/" }).success).toBe(true);
    expect(socialPostSchema.safeParse({ ...base, callToAction: "CALL" }).success).toBe(true);
  });

  it("refuses free text where Google has fixed buttons", () => {
    const parsed = socialPostSchema.safeParse({ ...base, callToAction: "Visit us!" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message)).toContain("Choose one of the listed buttons.");
  });

  it("refuses a button that opens a link when there is no link", () => {
    const parsed = socialPostSchema.safeParse({ ...base, callToAction: "ORDER" });
    expect(parsed.error?.issues.map((i) => i.message)).toContain('The "Order online" button needs a link to open.');
  });

  it("leaves free-text calls to action alone on platforms without fixed buttons", () => {
    // No platform with free text currently offers the field; the rule only
    // applies where a list is declared.
    expect(socialPostSchema.safeParse({ ...base, provider: "LINKEDIN", type: "TEXT" }).success).toBe(true);
  });
});
