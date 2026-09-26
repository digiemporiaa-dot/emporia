import { describe, expect, it } from "vitest";
import { CAPABILITIES, PROVIDER_LABEL, supportsField, supportsType } from "@/lib/social/capabilities";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { socialPostSchema } from "@/lib/validation/social";
import { IntegrationNotConfiguredError } from "@/lib/errors";

/**
 * Provider capabilities.
 *
 * These six platforms are not interchangeable, and the whole module is built
 * so that difference lives in one table instead of in `if (provider === …)`
 * branches. What is worth testing is that the table is actually consulted —
 * that a post which a platform would reject is refused when it is written, not
 * at 7:30pm when the scheduler tries to send it.
 */

const PROVIDERS = Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[];

describe("capability table", () => {
  it("covers every provider, with a label", () => {
    for (const provider of PROVIDERS) {
      expect(CAPABILITIES[provider].postTypes.length, provider).toBeGreaterThan(0);
      expect(PROVIDER_LABEL[provider], provider).toBeTruthy();
    }
  });

  it("does not offer a link field where a link is not clickable", () => {
    // An Instagram caption does not linkify. Offering the field would invite
    // an editor to waste it.
    expect(supportsField("INSTAGRAM", "linkUrl")).toBe(false);
    expect(supportsField("FACEBOOK", "linkUrl")).toBe(true);
  });

  it("keeps formats to what each publishing API actually accepts", () => {
    expect(supportsType("GOOGLE_BUSINESS_PROFILE", "CAROUSEL")).toBe(false);
    expect(supportsType("INSTAGRAM", "CAROUSEL")).toBe(true);
    expect(supportsType("X", "CAROUSEL")).toBe(false);
    expect(supportsType("YOUTUBE", "SINGLE_IMAGE")).toBe(false);
  });

  it("declares where metrics cannot be read back", () => {
    // Said out loud rather than returning zeros for a platform that reports
    // nothing (CLAUDE.md 2 rule 5).
    expect(CAPABILITIES.X.metrics).toBe(false);
    expect(CAPABILITIES.INSTAGRAM.metrics).toBe(true);
  });
});

describe("post validation against the provider", () => {
  const base = {
    contentItemId: "item-1",
    type: "SINGLE_IMAGE" as const,
    caption: "A short caption.",
  };

  it("accepts a post the platform supports", () => {
    expect(socialPostSchema.safeParse({ ...base, provider: "INSTAGRAM" }).success).toBe(true);
  });

  it("refuses a format the platform cannot publish", () => {
    const result = socialPostSchema.safeParse({
      ...base,
      provider: "GOOGLE_BUSINESS_PROFILE",
      type: "CAROUSEL",
    });
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0]?.message).toMatch(/not supported/i);
  });

  it("refuses a field the platform does not have", () => {
    const result = socialPostSchema.safeParse({
      ...base,
      provider: "INSTAGRAM",
      linkUrl: "https://example.com",
    });
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0]?.path.join(".")).toBe("linkUrl");
  });

  it("counts hashtags towards the caption limit", () => {
    // A caption that fits until the tags are added is a caption that fails at
    // publication, which is the worst moment to find out.
    const caption = "x".repeat(270);
    expect(socialPostSchema.safeParse({ ...base, provider: "X", type: "TEXT", caption }).success).toBe(
      true,
    );
    const withTags = socialPostSchema.safeParse({
      ...base,
      provider: "X",
      type: "TEXT",
      caption,
      hashtags: ["diwali", "offers"],
    });
    expect(withTags.success).toBe(false);
  });

  it("caps a carousel at what the platform takes", () => {
    const result = socialPostSchema.safeParse({
      ...base,
      provider: "INSTAGRAM",
      type: "CAROUSEL",
      mediaIds: Array.from({ length: 11 }, (_, i) => `m${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("normalises hashtags and refuses ones that cannot exist", () => {
    const parsed = socialPostSchema.parse({
      ...base,
      provider: "INSTAGRAM",
      hashtags: ["#Diwali", "offers"],
    });
    expect(parsed.hashtags).toEqual(["Diwali", "offers"]);

    expect(
      socialPostSchema.safeParse({ ...base, provider: "INSTAGRAM", hashtags: ["two words"] }).success,
    ).toBe(false);
  });
});

describe("an unconfigured provider", () => {
  const adapter = new UnconfiguredSocialProvider("LINKEDIN");

  it("still reports what it would be able to do", () => {
    // So the screen can say "Not configured" and describe the integration,
    // rather than going blank.
    expect(adapter.configured).toBe(false);
    expect(adapter.label).toBe("LinkedIn");
    expect(adapter.capabilities.postTypes).toContain("TEXT");
  });

  it("refuses every call with a typed error rather than pretending", async () => {
    expect(() => adapter.authorizationUrl()).toThrow(IntegrationNotConfiguredError);
    await expect(adapter.publish()).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    await expect(adapter.getMetrics()).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    await expect(adapter.getAccount()).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });
});
