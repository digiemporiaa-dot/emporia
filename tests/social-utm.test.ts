import { describe, expect, it } from "vitest";
import { tagLink, utmSource, utmValue } from "@/lib/social/utm";

describe("utm tagging", () => {
  const base = { provider: "LINKEDIN" as const, campaign: "Diwali Sale", content: "reel-1" };

  it("adds source, medium, campaign and content to a bare link", () => {
    const url = new URL(tagLink("https://example.com/offer", base)!);
    expect(url.searchParams.get("utm_source")).toBe("linkedin");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.get("utm_campaign")).toBe("diwali-sale");
    expect(url.searchParams.get("utm_content")).toBe("reel-1");
  });

  it("never overwrites a tag somebody set deliberately", () => {
    const url = new URL(tagLink("https://example.com/o?utm_source=newsletter", base)!);
    expect(url.searchParams.get("utm_source")).toBe("newsletter");
    // The ones they did not set are still added.
    expect(url.searchParams.get("utm_medium")).toBe("social");
  });

  it("keeps the link's own query parameters", () => {
    const url = new URL(tagLink("https://example.com/o?ref=abc&page=2", base)!);
    expect(url.searchParams.get("ref")).toBe("abc");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("normalises a campaign name so one campaign is not two in reporting", () => {
    expect(utmValue("Diwali Sale")).toBe("diwali-sale");
    expect(utmValue("  Diwali   SALE!! ")).toBe("diwali-sale");
    expect(utmValue("Festive — 2026")).toBe("festive-2026");
  });

  it("leaves out what it has no value for", () => {
    const url = new URL(tagLink("https://example.com/o", { ...base, campaign: null, content: null })!);
    expect(url.searchParams.has("utm_campaign")).toBe(false);
    expect(url.searchParams.has("utm_content")).toBe(false);
    expect(url.searchParams.get("utm_source")).toBe("linkedin");
  });

  it("passes a null link through", () => {
    expect(tagLink(null, base)).toBeNull();
  });

  it("returns a malformed link untouched rather than mangling it", () => {
    expect(tagLink("not a url", base)).toBe("not a url");
  });

  it("refuses to decorate a non-http scheme", () => {
    expect(tagLink("javascript:alert(1)", base)).toBe("javascript:alert(1)");
    expect(tagLink("data:text/html,hi", base)).toBe("data:text/html,hi");
  });

  it("gives every platform a stable lowercase source", () => {
    expect(utmSource("INSTAGRAM")).toBe("instagram");
    expect(utmSource("GOOGLE_BUSINESS_PROFILE")).toBe("google_business");
    expect(utmSource("X")).toBe("x");
  });
});
