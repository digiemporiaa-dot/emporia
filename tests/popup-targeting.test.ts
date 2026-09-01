import { describe, expect, it } from "vitest";
import {
  frequencyAllows,
  isScheduled,
  pathMatches,
  selectPopup,
  targetMatches,
  type PageContext,
  type PopupCandidate,
  type PopupTargetRule,
  type VisitorState,
} from "@/lib/popups/targeting";

/**
 * The Phase 6 exit criterion in pure form: a popup targeted at
 * /services/seo/gurgaon fires only there.
 */

const NOW = new Date("2026-06-15T12:00:00Z");

function rule(overrides: Partial<PopupTargetRule> = {}): PopupTargetRule {
  return {
    type: "GLOBAL",
    path: null,
    serviceId: null,
    cityId: null,
    serviceCityPageId: null,
    packageId: null,
    visitorType: "ANY",
    device: "ANY",
    ...overrides,
  };
}

function popup(overrides: Partial<PopupCandidate> = {}): PopupCandidate {
  return {
    id: "p1",
    priority: 0,
    frequency: "EVERY_VISIT",
    isActive: true,
    startsAt: null,
    endsAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    targets: [rule()],
    ...overrides,
  };
}

function page(overrides: Partial<PageContext> = {}): PageContext {
  return {
    path: "/",
    serviceId: null,
    cityId: null,
    serviceCityPageId: null,
    packageId: null,
    ...overrides,
  };
}

function visitor(overrides: Partial<VisitorState> = {}): VisitorState {
  return {
    device: "DESKTOP",
    isNewVisitor: true,
    seen: {},
    seenThisSession: [],
    now: NOW,
    ...overrides,
  };
}

describe("path matching", () => {
  it("matches an exact path regardless of trailing slash or query", () => {
    expect(pathMatches("/services/seo", "/services/seo")).toBe(true);
    expect(pathMatches("/services/seo", "/services/seo/")).toBe(true);
    expect(pathMatches("/services/seo", "/services/seo?utm_source=x")).toBe(true);
  });

  it("does not match a deeper path without a wildcard", () => {
    expect(pathMatches("/services", "/services/seo")).toBe(false);
  });

  it("matches a subtree with a trailing wildcard", () => {
    expect(pathMatches("/services/*", "/services/seo")).toBe(true);
    expect(pathMatches("/services/*", "/services/seo/gurgaon")).toBe(true);
    expect(pathMatches("/services/*", "/services")).toBe(true);
    expect(pathMatches("/services/*", "/packages")).toBe(false);
  });

  it("does not treat a prefix as a match", () => {
    expect(pathMatches("/service/*", "/services/seo")).toBe(false);
  });
});

describe("the exit criterion: fires only on its target page", () => {
  const seoGurgaon = popup({
    targets: [rule({ type: "SERVICE_CITY", serviceId: "svc-seo", cityId: "city-gurgaon" })],
  });

  const onTarget = page({
    path: "/services/seo/gurgaon",
    serviceId: "svc-seo",
    cityId: "city-gurgaon",
    serviceCityPageId: "scp-1",
  });

  it("fires on the targeted service-city page", () => {
    expect(selectPopup([seoGurgaon], onTarget, visitor())?.id).toBe("p1");
  });

  it("does not fire on the same service in another city", () => {
    const other = page({ path: "/services/seo/mumbai", serviceId: "svc-seo", cityId: "city-mumbai" });
    expect(selectPopup([seoGurgaon], other, visitor())).toBeNull();
  });

  it("does not fire on another service in the same city", () => {
    const other = page({ path: "/services/ppc/gurgaon", serviceId: "svc-ppc", cityId: "city-gurgaon" });
    expect(selectPopup([seoGurgaon], other, visitor())).toBeNull();
  });

  it("does not fire on the service page without a city", () => {
    const other = page({ path: "/services/seo", serviceId: "svc-seo" });
    expect(selectPopup([seoGurgaon], other, visitor())).toBeNull();
  });

  it("does not fire on the homepage", () => {
    expect(selectPopup([seoGurgaon], page(), visitor())).toBeNull();
  });
});

describe("target types", () => {
  it("GLOBAL matches anywhere", () => {
    expect(targetMatches(rule({ type: "GLOBAL" }), page({ path: "/anything" }), visitor())).toBe(true);
  });

  it("SERVICE matches only its service", () => {
    const r = rule({ type: "SERVICE", serviceId: "svc-a" });
    expect(targetMatches(r, page({ serviceId: "svc-a" }), visitor())).toBe(true);
    expect(targetMatches(r, page({ serviceId: "svc-b" }), visitor())).toBe(false);
    expect(targetMatches(r, page(), visitor())).toBe(false);
  });

  it("CITY matches only its city", () => {
    const r = rule({ type: "CITY", cityId: "city-a" });
    expect(targetMatches(r, page({ cityId: "city-a" }), visitor())).toBe(true);
    expect(targetMatches(r, page({ cityId: "city-b" }), visitor())).toBe(false);
  });

  it("PACKAGE matches only its package", () => {
    const r = rule({ type: "PACKAGE", packageId: "pkg-a" });
    expect(targetMatches(r, page({ packageId: "pkg-a" }), visitor())).toBe(true);
    expect(targetMatches(r, page({ packageId: "pkg-b" }), visitor())).toBe(false);
  });

  it("a rule with a null id never matches, rather than matching everything", () => {
    expect(targetMatches(rule({ type: "SERVICE" }), page({ serviceId: "svc-a" }), visitor())).toBe(false);
    expect(targetMatches(rule({ type: "PAGE" }), page({ path: "/x" }), visitor())).toBe(false);
  });
});

describe("device and visitor targeting", () => {
  it("restricts by device", () => {
    const mobileOnly = rule({ device: "MOBILE" });
    expect(targetMatches(mobileOnly, page(), visitor({ device: "MOBILE" }))).toBe(true);
    expect(targetMatches(mobileOnly, page(), visitor({ device: "DESKTOP" }))).toBe(false);
  });

  it("restricts by new versus returning", () => {
    const newOnly = rule({ visitorType: "NEW" });
    const returningOnly = rule({ visitorType: "RETURNING" });
    expect(targetMatches(newOnly, page(), visitor({ isNewVisitor: true }))).toBe(true);
    expect(targetMatches(newOnly, page(), visitor({ isNewVisitor: false }))).toBe(false);
    expect(targetMatches(returningOnly, page(), visitor({ isNewVisitor: false }))).toBe(true);
  });
});

describe("scheduling", () => {
  it("respects the active flag", () => {
    expect(isScheduled(popup({ isActive: false }), NOW)).toBe(false);
  });

  it("does not fire before it starts or after it ends", () => {
    expect(isScheduled(popup({ startsAt: new Date("2026-07-01") }), NOW)).toBe(false);
    expect(isScheduled(popup({ endsAt: new Date("2026-06-01") }), NOW)).toBe(false);
    expect(
      isScheduled(popup({ startsAt: new Date("2026-06-01"), endsAt: new Date("2026-07-01") }), NOW),
    ).toBe(true);
  });
});

describe("frequency capping", () => {
  const day = 24 * 60 * 60 * 1000;

  it("EVERY_VISIT always allows", () => {
    expect(frequencyAllows(popup({ frequency: "EVERY_VISIT" }), visitor({ seen: { p1: NOW.getTime() } }))).toBe(true);
  });

  it("ONCE_PER_SESSION blocks a repeat within the session", () => {
    const p = popup({ frequency: "ONCE_PER_SESSION" });
    expect(frequencyAllows(p, visitor())).toBe(true);
    expect(frequencyAllows(p, visitor({ seenThisSession: ["p1"] }))).toBe(false);
  });

  it("ONCE_PER_DAY blocks within 24h and allows after", () => {
    const p = popup({ frequency: "ONCE_PER_DAY" });
    expect(frequencyAllows(p, visitor({ seen: { p1: NOW.getTime() - day / 2 } }))).toBe(false);
    expect(frequencyAllows(p, visitor({ seen: { p1: NOW.getTime() - day - 1000 } }))).toBe(true);
  });

  it("ONCE_PER_WEEK blocks within 7 days", () => {
    const p = popup({ frequency: "ONCE_PER_WEEK" });
    expect(frequencyAllows(p, visitor({ seen: { p1: NOW.getTime() - 3 * day } }))).toBe(false);
    expect(frequencyAllows(p, visitor({ seen: { p1: NOW.getTime() - 8 * day } }))).toBe(true);
  });

  it("ONCE_PER_USER never shows again", () => {
    const p = popup({ frequency: "ONCE_PER_USER" });
    expect(frequencyAllows(p, visitor())).toBe(true);
    expect(frequencyAllows(p, visitor({ seen: { p1: NOW.getTime() - 400 * day } }))).toBe(false);
  });
});

describe("selection", () => {
  it("returns at most one popup", () => {
    const a = popup({ id: "a", priority: 1 });
    const b = popup({ id: "b", priority: 5 });
    const result = selectPopup([a, b], page(), visitor());
    expect(result?.id).toBe("b");
  });

  it("breaks a priority tie on most recently updated", () => {
    const older = popup({ id: "older", priority: 3, updatedAt: new Date("2026-01-01") });
    const newer = popup({ id: "newer", priority: 3, updatedAt: new Date("2026-05-01") });
    expect(selectPopup([older, newer], page(), visitor())?.id).toBe("newer");
  });

  it("never fires a popup with no targets", () => {
    expect(selectPopup([popup({ targets: [] })], page(), visitor())).toBeNull();
  });

  it("skips a capped popup and falls through to the next eligible one", () => {
    const capped = popup({ id: "capped", priority: 9, frequency: "ONCE_PER_USER" });
    const open = popup({ id: "open", priority: 1 });
    const result = selectPopup([capped, open], page(), visitor({ seen: { capped: 1 } }));
    expect(result?.id).toBe("open");
  });

  it("returns null when nothing is eligible", () => {
    expect(selectPopup([], page(), visitor())).toBeNull();
    expect(selectPopup([popup({ isActive: false })], page(), visitor())).toBeNull();
  });
});
