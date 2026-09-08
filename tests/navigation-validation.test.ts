import { describe, expect, it } from "vitest";
import { navHref, navigationSettingsSchema, socialLinkSchema } from "@/lib/validation/navigation";

/**
 * Navigation validation.
 *
 * An `href` typed in the admin is rendered into every page of the public site,
 * which makes it the one field here that is a security boundary rather than a
 * convenience. These cases pin what is accepted and — more importantly — what
 * is not.
 */

const base = {
  brandName: "Emporia",
  tagline: "",
  contactEmail: "",
  contactPhone: "",
  contactAddress: "",
  headerLinks: [],
  ctaEnabled: false,
  ctaLabel: "",
  ctaHref: "",
  footerCompanyLinks: [],
  footerLegalLinks: [],
  socialLinks: [],
  copyrightName: "Emporia",
};

describe("navHref", () => {
  it("accepts the shapes an editor legitimately needs", () => {
    for (const href of [
      "/services",
      "/services/seo/mumbai",
      "/contact?utm_source=footer",
      "#pricing",
      "https://example.com/page",
      "http://example.com",
      "mailto:hello@example.com",
      "tel:+911234567890",
    ]) {
      expect(navHref.safeParse(href).success, href).toBe(true);
    }
  });

  it("rejects script and data URLs", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
    ]) {
      expect(navHref.safeParse(href).success, href).toBe(false);
    }
  });

  it("rejects a scheme-relative URL", () => {
    // `//evil.example` inherits the page's scheme and silently leaves the site.
    expect(navHref.safeParse("//evil.example").success).toBe(false);
  });

  it("rejects a destination carrying markup or whitespace", () => {
    expect(navHref.safeParse('/x" onmouseover="alert(1)').success).toBe(false);
    expect(navHref.safeParse("/two words").success).toBe(false);
  });

  it("rejects a bare word that is neither a path nor a URL", () => {
    expect(navHref.safeParse("services").success).toBe(false);
  });

  it("rejects an empty destination", () => {
    expect(navHref.safeParse("   ").success).toBe(false);
  });
});

describe("navigation settings", () => {
  it("accepts a minimal configuration with no links at all", () => {
    expect(navigationSettingsSchema.safeParse(base).success).toBe(true);
  });

  it("requires a label and a destination once the button is switched on", () => {
    const result = navigationSettingsSchema.safeParse({ ...base, ctaEnabled: true });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("ctaLabel");
    expect(paths).toContain("ctaHref");
  });

  it("leaves the button's fields optional while it is switched off", () => {
    const result = navigationSettingsSchema.safeParse({
      ...base,
      ctaEnabled: false,
      ctaLabel: "",
      ctaHref: "",
    });
    expect(result.success).toBe(true);
  });

  it("reports which row of a list is wrong", () => {
    const result = navigationSettingsSchema.safeParse({
      ...base,
      headerLinks: [
        { label: "Services", href: "/services", newTab: false },
        { label: "Bad", href: "javascript:alert(1)", newTab: false },
      ],
    });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("headerLinks.1.href");
  });

  it("caps the header at eight links", () => {
    const link = { label: "L", href: "/x", newTab: false };
    const result = navigationSettingsSchema.safeParse({
      ...base,
      headerLinks: Array.from({ length: 9 }, () => link),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a list that did not arrive as an array", () => {
    expect(navigationSettingsSchema.safeParse({ ...base, headerLinks: null }).success).toBe(false);
  });

  it("allows a blank contact email but not a malformed one", () => {
    expect(navigationSettingsSchema.safeParse({ ...base, contactEmail: "" }).success).toBe(true);
    expect(navigationSettingsSchema.safeParse({ ...base, contactEmail: "nope" }).success).toBe(
      false,
    );
  });
});

describe("social links", () => {
  it("requires https, not a bare handle or an http URL", () => {
    expect(
      socialLinkSchema.safeParse({ platform: "linkedin", url: "https://linkedin.com/company/x" })
        .success,
    ).toBe(true);
    expect(socialLinkSchema.safeParse({ platform: "linkedin", url: "@emporia" }).success).toBe(
      false,
    );
    expect(
      socialLinkSchema.safeParse({ platform: "linkedin", url: "http://linkedin.com" }).success,
    ).toBe(false);
  });

  it("rejects a platform outside the known set", () => {
    expect(
      socialLinkSchema.safeParse({ platform: "myspace", url: "https://myspace.com/x" }).success,
    ).toBe(false);
  });
});
