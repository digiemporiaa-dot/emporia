import { describe, expect, it } from "vitest";
import { onboardingProgress, stepComplete, type OnboardingFacts } from "@/lib/onboarding/steps";
import {
  analyticsStepSchema,
  brandColorsSchema,
  brandPresignSchema,
  businessStepSchema,
  companyStepSchema,
  socialStepSchema,
  websiteStepSchema,
} from "@/lib/validation/onboarding";

/** Client onboarding, the pure half: when a step counts as done, and what the forms accept. */

const empty: OnboardingFacts = {
  company: { legalName: null, industry: null, website: null, addressLine1: null, city: null, countryCode: null },
  brand: { logos: 0, colors: 0 },
  website: { platform: null, confirmed: false },
  analytics: { propertyId: null, confirmed: false },
  searchConsoleConnected: false,
  social: { listedPlatforms: [], connectedPlatforms: [] },
  business: { publicPhone: null, addressLine1: null, openDays: 0 },
  notApplicable: [],
};

const full: OnboardingFacts = {
  company: { legalName: "Acme Pvt Ltd", industry: "Retail", website: "https://acme.example.org", addressLine1: "1 Main St", city: "Pune", countryCode: "IN" },
  brand: { logos: 1, colors: 2 },
  website: { platform: "WORDPRESS", confirmed: true },
  analytics: { propertyId: "123456789", confirmed: true },
  searchConsoleConnected: true,
  social: { listedPlatforms: ["INSTAGRAM"], connectedPlatforms: ["INSTAGRAM", "LINKEDIN"] },
  business: { publicPhone: "+91 98765 43210", addressLine1: "1 Main St", openDays: 5 },
  notApplicable: [],
};

describe("when each step is done", () => {
  it("nothing is done on an empty account, and everything on a full one", () => {
    expect(onboardingProgress(empty)).toMatchObject({ done: 0, applicable: 7, percent: 0, complete: false });
    expect(onboardingProgress(full)).toMatchObject({ done: 7, applicable: 7, percent: 100, complete: true });
  });

  it("company details need every required field, and blank text does not count", () => {
    expect(stepComplete("COMPANY", { ...full, company: { ...full.company, city: "   " } })).toBe(false);
    expect(stepComplete("COMPANY", { ...full, company: { ...full.company, countryCode: null } })).toBe(false);
  });

  it("brand needs a logo and a colour — either alone is not enough", () => {
    expect(stepComplete("BRAND", { ...full, brand: { logos: 1, colors: 0 } })).toBe(false);
    expect(stepComplete("BRAND", { ...full, brand: { logos: 0, colors: 3 } })).toBe(false);
  });

  it("website and analytics need the confirmation, not just the details", () => {
    expect(stepComplete("WEBSITE", { ...full, website: { platform: "SHOPIFY", confirmed: false } })).toBe(false);
    expect(stepComplete("ANALYTICS", { ...full, analytics: { propertyId: "123456789", confirmed: false } })).toBe(false);
    expect(stepComplete("ANALYTICS", { ...full, analytics: { propertyId: null, confirmed: true } })).toBe(false);
  });

  it("social is done only when every listed platform is connected, and never with nothing listed", () => {
    expect(stepComplete("SOCIAL", { ...full, social: { listedPlatforms: [], connectedPlatforms: ["INSTAGRAM"] } })).toBe(false);
    expect(stepComplete("SOCIAL", { ...full, social: { listedPlatforms: ["INSTAGRAM", "FACEBOOK"], connectedPlatforms: ["INSTAGRAM"] } })).toBe(false);
    expect(stepComplete("SOCIAL", { ...full, social: { listedPlatforms: ["INSTAGRAM", "INSTAGRAM"], connectedPlatforms: ["INSTAGRAM"] } })).toBe(true);
  });

  it("business needs phone, address and at least one open day", () => {
    expect(stepComplete("BUSINESS", { ...full, business: { ...full.business, openDays: 0 } })).toBe(false);
    expect(stepComplete("BUSINESS", { ...full, business: { ...full.business, addressLine1: null } })).toBe(false);
  });

  it("a step marked not needed leaves the count; it is not counted as done", () => {
    const progress = onboardingProgress({ ...empty, company: full.company, notApplicable: ["SOCIAL", "ANALYTICS"] });
    expect(progress).toMatchObject({ done: 1, applicable: 5, percent: 20 });
    expect(progress.steps.find((s) => s.step === "SOCIAL")?.state).toBe("not-applicable");
  });

  it("rounds down, so 99.9% never reads as 100%", () => {
    const sixOfSeven = onboardingProgress({ ...full, searchConsoleConnected: false });
    expect(sixOfSeven.percent).toBe(85);
    expect(sixOfSeven.complete).toBe(false);
  });

  it("everything not needed is complete", () => {
    expect(onboardingProgress({ ...empty, notApplicable: ["COMPANY", "BRAND", "WEBSITE", "ANALYTICS", "SEARCH_CONSOLE", "SOCIAL", "BUSINESS"] })).toMatchObject({ percent: 100, complete: true });
  });
});

describe("the forms", () => {
  const company = { legalName: "Acme", industry: "Retail", website: "acme.example.org", taxId: "", addressLine1: "1 Main", addressLine2: "", city: "Pune", region: "", postalCode: "", countryCode: "in" };

  it("normalises the website and country, and empties to null", () => {
    expect(companyStepSchema.parse(company)).toMatchObject({ website: "https://acme.example.org", countryCode: "IN", taxId: null, region: null });
    expect(companyStepSchema.parse({ ...company, website: "http://Acme.example.org/about" }).website).toBe("http://acme.example.org");
  });

  it("refuses an internal or unsafe website, and an unknown country", () => {
    expect(companyStepSchema.safeParse({ ...company, website: "http://10.0.0.1" }).success).toBe(false);
    expect(companyStepSchema.safeParse({ ...company, website: "localhost" }).success).toBe(false);
    expect(companyStepSchema.safeParse({ ...company, countryCode: "EU" }).success).toBe(false);
  });

  it("refuses line breaks in single-line fields", () => {
    expect(companyStepSchema.safeParse({ ...company, legalName: "Acme\nEvil" }).success).toBe(false);
  });

  it("reads brand colours with or without #, de-duplicated", () => {
    expect(brandColorsSchema.parse({ colors: "002a3a, #DF1F38 df1f38" }).colors).toEqual(["#002A3A", "#DF1F38"]);
    expect(brandColorsSchema.safeParse({ colors: "red" }).success).toBe(false);
    expect(brandColorsSchema.safeParse({ colors: "#FFF" }).success).toBe(false);
  });

  it("needs a platform for website access, and a real https login page", () => {
    expect(websiteStepSchema.safeParse({ platform: "", loginUrl: "", notes: "", confirmed: true }).success).toBe(false);
    expect(websiteStepSchema.safeParse({ platform: "WORDPRESS", loginUrl: "javascript:alert(1)", notes: "", confirmed: true }).success).toBe(false);
    expect(websiteStepSchema.parse({ platform: "WORDPRESS", loginUrl: "", notes: "", confirmed: false })).toMatchObject({ loginUrl: null, notes: null });
  });

  it("accepts a numeric GA4 property ID, with or without the properties/ prefix", () => {
    expect(analyticsStepSchema.parse({ propertyId: "properties/123456789", confirmed: true }).propertyId).toBe("123456789");
    expect(analyticsStepSchema.safeParse({ propertyId: "G-ABC123", confirmed: true }).success).toBe(false);
    expect(analyticsStepSchema.safeParse({ propertyId: "UA-1234-1", confirmed: true }).success).toBe(false);
  });

  it("limits social profiles to known platforms", () => {
    expect(socialStepSchema.safeParse({ profiles: [{ platform: "MYSPACE", handle: "@a" }] }).success).toBe(false);
    expect(socialStepSchema.safeParse({ profiles: [{ platform: "INSTAGRAM", handle: "<script>" }] }).success).toBe(false);
    expect(socialStepSchema.parse({ profiles: [{ platform: "X", handle: " @acme " }] }).profiles[0]?.handle).toBe("@acme");
  });

  it("checks opening hours make sense", () => {
    const closed = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    const base = { publicPhone: "+971 4 123 4567", publicEmail: "", serviceAreas: "Dubai, Sharjah, Dubai", googleBusinessUrl: "" };
    expect(businessStepSchema.parse({ ...base, hours: { ...closed, mon: [{ open: "09:00", close: "18:00" }] } }).serviceAreas).toEqual(["Dubai", "Sharjah"]);
    expect(businessStepSchema.safeParse({ ...base, hours: { ...closed, mon: [{ open: "18:00", close: "09:00" }] } }).success).toBe(false);
    expect(businessStepSchema.safeParse({ ...base, hours: { ...closed, mon: [{ open: "25:00", close: "26:00" }] } }).success).toBe(false);
    expect(businessStepSchema.safeParse({ ...base, publicPhone: "call me", hours: closed }).success).toBe(false);
  });

  it("brand uploads are images and PDFs only — never SVG", () => {
    expect(brandPresignSchema.safeParse({ filename: "logo.svg", contentType: "image/svg+xml", size: 100, kind: "LOGO" }).success).toBe(false);
    expect(brandPresignSchema.safeParse({ filename: "clip.mp4", contentType: "video/mp4", size: 100, kind: "OTHER" }).success).toBe(false);
    expect(brandPresignSchema.safeParse({ filename: "logo.png", contentType: "image/png", size: 100, kind: "LOGO" }).success).toBe(true);
  });
});
