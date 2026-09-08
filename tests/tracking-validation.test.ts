import { describe, expect, it } from "vitest";
import { capiTokenSchema, trackingSettingsSchema } from "@/lib/validation/tracking";

/**
 * Tracking ID validation.
 *
 * A typo in a measurement ID is invisible until someone notices a month of
 * missing data, so the formats are checked on save rather than trusted.
 */

const EMPTY = {
  gtmEnabled: false,
  gtmId: "",
  ga4Enabled: false,
  ga4Id: "",
  googleAdsEnabled: false,
  googleAdsId: "",
  googleAdsLabelEnabled: false,
  googleAdsLabel: "",
  googleSiteVerificationEnabled: false,
  googleSiteVerification: "",
  metaPixelEnabled: false,
  metaPixelId: "",
  clarityEnabled: false,
  clarityId: "",
  hotjarEnabled: false,
  hotjarId: "",
  pinterestEnabled: false,
  pinterestId: "",
  tiktokEnabled: false,
  tiktokId: "",
  snapchatEnabled: false,
  snapchatId: "",
  consentMode: "IMPLIED" as const,
  consentBannerText: "",
  capiPurchasesEnabled: false,
};

describe("tracking settings validation", () => {
  it("accepts an entirely empty configuration", () => {
    const parsed = trackingSettingsSchema.parse(EMPTY);
    expect(parsed.gtmId).toBeNull();
    expect(parsed.ga4Id).toBeNull();
    expect(parsed.consentBannerText).toBeNull();
  });

  it("stores a blank ID as null rather than an empty string", () => {
    // The difference matters downstream: `publicTrackingConfig` treats null as
    // "not configured", and "" would be a configured provider with no ID.
    const parsed = trackingSettingsSchema.parse({ ...EMPTY, ga4Id: "   " });
    expect(parsed.ga4Id).toBeNull();
  });

  it("strips whitespace inside a pasted ID", () => {
    const parsed = trackingSettingsSchema.parse({ ...EMPTY, gtmId: " GTM-ABC 1234 " });
    expect(parsed.gtmId).toBe("GTM-ABC1234");
  });

  it.each([
    ["gtmId", "GTM-ABC1234", "UA-12345-1"],
    ["ga4Id", "G-AB12CD34EF", "GA-AB12CD34"],
    ["googleAdsId", "AW-123456789", "AW_123456789"],
    ["metaPixelId", "123456789012345", "12345"],
    ["clarityId", "abcd1234xy", "ABCD1234XY"],
    ["hotjarId", "1234567", "12345"],
    ["pinterestId", "2612345678901", "26123456789"],
    ["tiktokId", "CABCDEFGHIJKLMNOPQRS", "cabcdefghijklmnopqrs"],
    ["snapchatId", "3f1b0c9a-1d2e-4f3a-8b7c-9d0e1f2a3b4c", "3f1b0c9a1d2e4f3a"],
  ])("%s accepts its own format and rejects another", (field, good, bad) => {
    expect(trackingSettingsSchema.safeParse({ ...EMPTY, [field]: good }).success).toBe(true);
    expect(trackingSettingsSchema.safeParse({ ...EMPTY, [field]: bad }).success).toBe(false);
  });

  it("rejects a whole meta tag pasted into site verification", () => {
    const result = trackingSettingsSchema.safeParse({
      ...EMPTY,
      googleSiteVerification: '<meta name="google-site-verification" content="abc123" />',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("content value");
    }
  });

  it("refuses to enable a provider with no ID", () => {
    const result = trackingSettingsSchema.safeParse({ ...EMPTY, ga4Enabled: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["ga4Id"]);
    }
  });

  it("refuses a conversion label without a conversion ID", () => {
    const result = trackingSettingsSchema.safeParse({
      ...EMPTY,
      googleAdsLabelEnabled: true,
      googleAdsLabel: "AbCdEfGh",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "googleAdsLabel")).toBe(true);
    }
  });

  it("accepts a conversion label alongside its ID", () => {
    expect(
      trackingSettingsSchema.safeParse({
        ...EMPTY,
        googleAdsEnabled: true,
        googleAdsId: "AW-123456789",
        googleAdsLabelEnabled: true,
        googleAdsLabel: "AbCdEfGh",
      }).success,
    ).toBe(true);
  });

  it("rejects a consent mode it does not implement", () => {
    expect(trackingSettingsSchema.safeParse({ ...EMPTY, consentMode: "MAYBE" }).success).toBe(false);
  });
});

describe("conversions api token validation", () => {
  it("rejects something too short to be a token", () => {
    expect(capiTokenSchema.safeParse({ token: "short" }).success).toBe(false);
  });

  it("accepts a plausible token and trims it", () => {
    const parsed = capiTokenSchema.parse({ token: `  ${"EAA" + "x".repeat(40)}  ` });
    expect(parsed.token.startsWith("EAA")).toBe(true);
    expect(parsed.token).not.toMatch(/\s/);
  });
});
