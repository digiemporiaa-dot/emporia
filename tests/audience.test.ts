import { describe, expect, it } from "vitest";
import {
  audienceAllows,
  describeRule,
  ruleMatches,
  type AudienceRule,
  type AudienceVisitor,
} from "@/lib/content/audience";

/**
 * Who a section is for.
 *
 * The one that would hurt most if it were wrong: a band with no rules must show
 * to everyone. Getting that backwards would make every existing page disappear
 * the day the feature shipped.
 */

const rule = (over: Partial<AudienceRule> = {}): AudienceRule => ({
  visitorType: "ANY",
  device: "ANY",
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  referrerContains: null,
  ...over,
});

const visitor = (over: Partial<AudienceVisitor> = {}): AudienceVisitor => ({
  device: "DESKTOP",
  isNewVisitor: true,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  referrer: null,
  ...over,
});

describe("no rules means everyone", () => {
  it("shows a band nobody has targeted", () => {
    expect(audienceAllows([], visitor())).toBe(true);
  });

  it("shows it to every kind of visitor", () => {
    for (const device of ["DESKTOP", "TABLET", "MOBILE"] as const) {
      for (const isNewVisitor of [true, false]) {
        expect(audienceAllows([], visitor({ device, isNewVisitor }))).toBe(true);
      }
    }
  });
});

describe("one rule", () => {
  it("matches a device", () => {
    expect(ruleMatches(rule({ device: "MOBILE" }), visitor({ device: "MOBILE" }))).toBe(true);
    expect(ruleMatches(rule({ device: "MOBILE" }), visitor({ device: "DESKTOP" }))).toBe(false);
  });

  it("matches first-time and returning visitors", () => {
    expect(ruleMatches(rule({ visitorType: "NEW" }), visitor({ isNewVisitor: true }))).toBe(true);
    expect(ruleMatches(rule({ visitorType: "NEW" }), visitor({ isNewVisitor: false }))).toBe(false);
    expect(
      ruleMatches(rule({ visitorType: "RETURNING" }), visitor({ isNewVisitor: false })),
    ).toBe(true);
  });

  it("matches a UTM value regardless of case or padding", () => {
    // A UTM is typed by a person on one side and by a person on the other.
    expect(ruleMatches(rule({ utmSource: " Google " }), visitor({ utmSource: "google" }))).toBe(
      true,
    );
  });

  it("does not match a UTM the visitor does not carry", () => {
    expect(ruleMatches(rule({ utmSource: "google" }), visitor({ utmSource: null }))).toBe(false);
  });

  it("treats a blank condition as 'any' rather than as 'must be empty'", () => {
    expect(ruleMatches(rule({ utmSource: "" }), visitor({ utmSource: "anything" }))).toBe(true);
  });

  it("matches a referrer by substring", () => {
    const r = rule({ referrerContains: "linkedin" });
    expect(ruleMatches(r, visitor({ referrer: "https://www.linkedin.com/feed" }))).toBe(true);
    expect(ruleMatches(r, visitor({ referrer: "https://example.com" }))).toBe(false);
    expect(ruleMatches(r, visitor({ referrer: null }))).toBe(false);
  });

  it("requires every condition in the rule to hold", () => {
    const paidMobile = rule({ device: "MOBILE", utmMedium: "cpc" });
    expect(ruleMatches(paidMobile, visitor({ device: "MOBILE", utmMedium: "cpc" }))).toBe(true);
    // Right device, wrong medium.
    expect(ruleMatches(paidMobile, visitor({ device: "MOBILE", utmMedium: "organic" }))).toBe(
      false,
    );
    // Right medium, wrong device.
    expect(ruleMatches(paidMobile, visitor({ device: "DESKTOP", utmMedium: "cpc" }))).toBe(false);
  });
});

describe("several rules", () => {
  it("shows the band when any one rule matches", () => {
    const rules = [rule({ utmMedium: "cpc" }), rule({ visitorType: "RETURNING" })];
    // Paid traffic, first visit.
    expect(audienceAllows(rules, visitor({ utmMedium: "cpc" }))).toBe(true);
    // Organic, but returning.
    expect(audienceAllows(rules, visitor({ isNewVisitor: false }))).toBe(true);
    // Neither.
    expect(audienceAllows(rules, visitor())).toBe(false);
  });
});

describe("describeRule", () => {
  it("says Everyone for a rule with nothing set", () => {
    expect(describeRule(rule())).toBe("Everyone");
  });

  it("reads as a sentence", () => {
    expect(describeRule(rule({ visitorType: "RETURNING", device: "MOBILE", utmSource: "google" })))
      .toBe("returning visitors, on mobile, from google");
  });
});

describe("what is deliberately absent", () => {
  it("offers no location attribute at all", () => {
    // There is no geo-IP in this application. A location rule that guessed
    // would be a fabricated audience, so the field does not exist rather than
    // existing and being unreliable.
    const keys = Object.keys(rule());
    expect(keys).not.toContain("city");
    expect(keys).not.toContain("country");
    expect(keys).not.toContain("region");
  });
});
