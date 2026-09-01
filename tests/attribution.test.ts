import { describe, expect, it } from "vitest";
import {
  decodePopupState,
  decodeTouch,
  deviceFromUserAgent,
  encodePopupState,
  encodeTouch,
  readUtm,
} from "@/lib/attribution/cookies";

describe("UTM extraction", () => {
  it("reads the standard utm parameters", () => {
    const params = new URLSearchParams(
      "utm_source=google&utm_medium=cpc&utm_campaign=q3&utm_term=seo&utm_content=b",
    );
    expect(readUtm(params)).toEqual({
      source: "google",
      medium: "cpc",
      campaign: "q3",
      term: "seo",
      content: "b",
    });
  });

  it("returns null when there is nothing to attribute", () => {
    expect(readUtm(new URLSearchParams("page=2"))).toBeNull();
    expect(readUtm(new URLSearchParams())).toBeNull();
  });

  it("infers paid traffic from an ad platform click id", () => {
    expect(readUtm(new URLSearchParams("gclid=abc123"))).toEqual({ source: "google", medium: "cpc" });
    expect(readUtm(new URLSearchParams("fbclid=xyz"))).toEqual({ source: "facebook", medium: "cpc" });
  });

  it("prefers explicit utm parameters over a click id", () => {
    const params = new URLSearchParams("utm_source=newsletter&gclid=abc");
    expect(readUtm(params)?.source).toBe("newsletter");
  });

  it("truncates an absurdly long value rather than storing it whole", () => {
    const params = new URLSearchParams(`utm_source=${"x".repeat(500)}`);
    expect(readUtm(params)?.source?.length).toBe(200);
  });
});

describe("touch cookie round trip", () => {
  it("survives encode and decode", () => {
    const touch = {
      source: "google",
      medium: "cpc",
      campaign: "q3",
      landingPath: "/services/seo/gurgaon",
      at: 1750000000000,
    };
    expect(decodeTouch(encodeTouch(touch))).toEqual(touch);
  });

  it("returns null for missing or corrupt data rather than throwing", () => {
    expect(decodeTouch(undefined)).toBeNull();
    expect(decodeTouch("not-json")).toBeNull();
    expect(decodeTouch(encodeURIComponent('{"source":"x"}'))).toBeNull(); // no timestamp
    expect(decodeTouch(encodeURIComponent('"a string"'))).toBeNull();
  });
});

describe("popup state cookie", () => {
  it("round trips popup timestamps", () => {
    const state = { a: 1750000000000, b: 1750000001000 };
    expect(decodePopupState(encodePopupState(state))).toEqual(state);
  });

  it("drops non-numeric entries instead of trusting them", () => {
    const raw = encodeURIComponent(JSON.stringify({ good: 123, bad: "soon", worse: null }));
    expect(decodePopupState(raw)).toEqual({ good: 123 });
  });

  it("returns an empty state for corrupt data", () => {
    expect(decodePopupState("%%%")).toEqual({});
    expect(decodePopupState(undefined)).toEqual({});
  });
});

describe("device detection", () => {
  it("classifies phones, tablets and desktops", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit")).toBe("MOBILE");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile Safari")).toBe("MOBILE");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit")).toBe("TABLET");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("DESKTOP");
  });

  it("defaults to desktop when the header is absent", () => {
    expect(deviceFromUserAgent(null)).toBe("DESKTOP");
  });
});
