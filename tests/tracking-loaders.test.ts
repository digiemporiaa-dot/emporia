import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Script loader idempotency.
 *
 * Double initialisation is not cosmetic: it doubles page views and
 * conversions, which corrupts the numbers a campaign is judged on. The
 * loaders guarantee once-per-page, and that is what is asserted here.
 *
 * The environment is node, so a minimal DOM is stood up rather than pulling in
 * jsdom for four methods. It records what was appended, which is exactly what
 * these tests need to see.
 */

type FakeScript = { src: string; async: boolean; setAttribute: (n: string, v: string) => void };

let appended: FakeScript[];

function fakeDom() {
  appended = [];
  const head = {
    appendChild: (node: FakeScript) => {
      appended.push(node);
      return node;
    },
  };
  const document = {
    createElement: (): FakeScript => ({ src: "", async: false, setAttribute: () => {} }),
    head,
  };
  Object.assign(globalThis, { document, window: {} });
}

function srcs(): string[] {
  return appended.map((script) => script.src);
}

async function loaders() {
  return import("@/components/website/tracking/loaders");
}

beforeEach(async () => {
  fakeDom();
  (await loaders()).resetLoaders();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});

describe("idempotency", () => {
  it("loads Google Tag Manager exactly once however often it is asked", async () => {
    const { loadGtm } = await loaders();
    loadGtm("GTM-ABC1234");
    loadGtm("GTM-ABC1234");
    loadGtm("GTM-ABC1234");
    expect(srcs().filter((src) => src.includes("gtm.js"))).toHaveLength(1);
  });

  it("initialises the Meta pixel exactly once", async () => {
    const { loadMetaPixel } = await loaders();
    const w = globalThis.window as unknown as { fbq: { queue: unknown[] } };

    loadMetaPixel("123456789012345");
    loadMetaPixel("123456789012345");

    expect(srcs().filter((src) => src.includes("fbevents.js"))).toHaveLength(1);
    // One init and one PageView, not two of each.
    expect(w.fbq.queue.filter((call) => (call as unknown[])[0] === "init")).toHaveLength(1);
    expect(w.fbq.queue.filter((call) => (call as unknown[])[0] === "track")).toHaveLength(1);
  });

  it.each([
    ["loadGa4", "G-AB12CD34EF", "gtag/js"],
    ["loadClarity", "abcd1234xy", "clarity.ms"],
    ["loadHotjar", "1234567", "hotjar"],
    ["loadPinterest", "2612345678901", "pinimg"],
    ["loadTiktok", "CABCDEFGHIJKLMNOPQRS", "tiktok"],
    ["loadSnapchat", "3f1b0c9a-1d2e-4f3a-8b7c-9d0e1f2a3b4c", "sc-static"],
  ])("%s injects one script for repeated calls", async (name, id, marker) => {
    const api = (await loaders()) as unknown as Record<string, (id: string) => void>;
    api[name]!(id);
    api[name]!(id);
    expect(srcs().filter((src) => src.includes(marker))).toHaveLength(1);
  });

  it("treats a different ID as a different load", async () => {
    const { loadGa4 } = await loaders();
    loadGa4("G-AAAAAAAAAA");
    loadGa4("G-BBBBBBBBBB");
    expect(srcs().filter((src) => src.includes("gtag/js"))).toHaveLength(2);
  });

  it("escapes an ID into the script URL", async () => {
    const { loadGtm } = await loaders();
    // Not a reachable value — the schema rejects it — but the loader must not
    // be the thing standing between a stored value and an injected URL.
    loadGtm('GTM-X"><script>');
    expect(srcs()[0]).not.toContain("<script>");
    expect(srcs()[0]).toContain("%3C");
  });
});

describe("google consent mode", () => {
  it("sends defaults first and updates after", async () => {
    const { applyGoogleConsent } = await loaders();
    const w = globalThis.window as unknown as { dataLayer: unknown[][] };

    applyGoogleConsent({ analytics: false, marketing: false });
    applyGoogleConsent({ analytics: true, marketing: true });

    const consentCalls = w.dataLayer.filter((call) => call[0] === "consent");
    expect(consentCalls.map((call) => call[1])).toEqual(["default", "update"]);
    expect(consentCalls[0]![2]).toMatchObject({
      analytics_storage: "denied",
      ad_storage: "denied",
    });
    expect(consentCalls[1]![2]).toMatchObject({
      analytics_storage: "granted",
      ad_personalization: "granted",
    });
  });
});

describe("the browser copy of a lead", () => {
  it("does nothing when no pixel is loaded", async () => {
    const { trackMetaLead } = await loaders();
    expect(() => trackMetaLead("3f1b0c9a-1d2e-4f3a-8b7c-9d0e1f2a3b4c")).not.toThrow();
  });

  it("fires with the shared event id so the server copy deduplicates", async () => {
    const { loadMetaPixel, trackMetaLead } = await loaders();
    loadMetaPixel("123456789012345");
    trackMetaLead("3f1b0c9a-1d2e-4f3a-8b7c-9d0e1f2a3b4c");

    const w = globalThis.window as unknown as { fbq: { queue: unknown[][] } };
    const lead = w.fbq.queue.find((call) => call[1] === "Lead");
    expect(lead?.[3]).toEqual({ eventID: "3f1b0c9a-1d2e-4f3a-8b7c-9d0e1f2a3b4c" });
  });
});
