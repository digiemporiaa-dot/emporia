import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATEGORY,
  acceptAll,
  choose,
  mayLoad,
  parseConsent,
  rejectAll,
  resolveConsent,
} from "@/lib/tracking/consent";

/**
 * Consent resolution.
 *
 * The rule that decides whether a pixel may fire, tested directly rather than
 * inferred from a rendered page.
 */

describe("parsing the stored choice", () => {
  it("reads a well-formed cookie", () => {
    const stored = parseConsent(JSON.stringify(acceptAll(3)));
    expect(stored).toMatchObject({ v: 3, analytics: true, marketing: true });
  });

  it.each([
    ["nothing", undefined],
    ["an empty string", ""],
    ["broken JSON", "{oh no"],
    ["a JSON array", "[]"],
    ["a missing version", JSON.stringify({ analytics: true, marketing: true })],
    ["a non-boolean flag", JSON.stringify({ v: 1, analytics: "yes", marketing: true })],
  ])("treats %s as no decision", (_label, raw) => {
    expect(parseConsent(raw)).toBeNull();
  });
});

describe("resolving against the current settings", () => {
  it("holds everything back in opt-in mode until asked", () => {
    expect(resolveConsent("OPT_IN", 1, null)).toEqual({
      analytics: false,
      marketing: false,
      needsDecision: true,
    });
  });

  it.each(["OPT_OUT", "IMPLIED"] as const)("runs by default in %s mode", (mode) => {
    expect(resolveConsent(mode, 1, null)).toEqual({
      analytics: true,
      marketing: true,
      needsDecision: true,
    });
  });

  it("honours a stored decision over the mode's default", () => {
    expect(resolveConsent("OPT_OUT", 1, rejectAll(1))).toEqual({
      analytics: false,
      marketing: false,
      needsDecision: false,
    });
  });

  it("asks again when the settings version has moved on", () => {
    // The visitor agreed to a different set of wording or categories, so their
    // answer no longer applies.
    const old = acceptAll(1);
    expect(resolveConsent("OPT_IN", 2, old)).toEqual({
      analytics: false,
      marketing: false,
      needsDecision: true,
    });
  });

  it("keeps a per-category choice", () => {
    expect(resolveConsent("OPT_IN", 5, choose(5, true, false))).toEqual({
      analytics: true,
      marketing: false,
      needsDecision: false,
    });
  });
});

describe("what each category gates", () => {
  it("lets the container itself load regardless", () => {
    // GTM is not a tag; what it may do is decided by Consent Mode, which the
    // manager signals separately.
    expect(PROVIDER_CATEGORY.gtm).toBe("necessary");
    expect(mayLoad("gtm", { analytics: false, marketing: false, needsDecision: true })).toBe(true);
  });

  it("stops analytics providers when analytics is refused", () => {
    const consent = { analytics: false, marketing: true, needsDecision: false };
    expect(mayLoad("ga4", consent)).toBe(false);
    expect(mayLoad("clarity", consent)).toBe(false);
    expect(mayLoad("hotjar", consent)).toBe(false);
    expect(mayLoad("metaPixel", consent)).toBe(true);
  });

  it("stops marketing providers when marketing is refused", () => {
    const consent = { analytics: true, marketing: false, needsDecision: false };
    for (const provider of ["googleAds", "metaPixel", "pinterest", "tiktok", "snapchat"] as const) {
      expect(mayLoad(provider, consent)).toBe(false);
    }
    expect(mayLoad("ga4", consent)).toBe(true);
  });

  it("categorises every provider it knows about", () => {
    for (const category of Object.values(PROVIDER_CATEGORY)) {
      expect(["necessary", "analytics", "marketing"]).toContain(category);
    }
  });
});
