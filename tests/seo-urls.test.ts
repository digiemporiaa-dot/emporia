import { afterEach, describe, expect, it } from "vitest";
import { absoluteUrl, resolveCanonical, siteOrigin } from "@/lib/seo/urls";
import { resetEnvCache } from "@/lib/config/env";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

function withSite(url: string) {
  process.env["SITE_URL"] = url;
  resetEnvCache();
}

describe("site origin", () => {
  it("strips a trailing slash so URLs never double up", () => {
    withSite("https://emporia.example/");
    expect(siteOrigin()).toBe("https://emporia.example");
  });
});

describe("absoluteUrl", () => {
  it("builds an absolute URL from a site-relative path", () => {
    withSite("https://emporia.example");
    expect(absoluteUrl("/services/seo")).toBe("https://emporia.example/services/seo");
  });

  it("tolerates a path without a leading slash", () => {
    withSite("https://emporia.example");
    expect(absoluteUrl("services")).toBe("https://emporia.example/services");
  });

  it("normalises a trailing slash, so one page has one canonical", () => {
    withSite("https://emporia.example");
    expect(absoluteUrl("/about/")).toBe("https://emporia.example/about");
  });

  it("keeps the root as a single slash", () => {
    withSite("https://emporia.example");
    expect(absoluteUrl("/")).toBe("https://emporia.example/");
  });
});

describe("canonical resolution", () => {
  it("derives from the page path when there is no override", () => {
    withSite("https://emporia.example");
    expect(resolveCanonical("/blog/post", null)).toBe("https://emporia.example/blog/post");
  });

  it("honours an absolute admin override", () => {
    withSite("https://emporia.example");
    expect(resolveCanonical("/blog/post", "https://elsewhere.example/canonical")).toBe(
      "https://elsewhere.example/canonical",
    );
  });

  it("makes a relative override absolute against the site origin", () => {
    withSite("https://emporia.example");
    expect(resolveCanonical("/blog/post", "/blog/preferred")).toBe(
      "https://emporia.example/blog/preferred",
    );
  });

  it("falls back to the derived URL for an unparseable override", () => {
    withSite("https://emporia.example");
    expect(resolveCanonical("/blog/post", "not a url")).toBe("https://emporia.example/blog/post");
  });

  it("ignores an empty or whitespace override", () => {
    withSite("https://emporia.example");
    expect(resolveCanonical("/x", "")).toBe("https://emporia.example/x");
    expect(resolveCanonical("/x", "   ")).toBe("https://emporia.example/x");
  });
});
