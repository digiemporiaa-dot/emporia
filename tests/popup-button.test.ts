import { describe, expect, it } from "vitest";
import { isPopupTarget, popupTarget, popupTargetId } from "@/lib/popups/button-target";
import { selectPopup, type PopupCandidate } from "@/lib/popups/targeting";
import { BLOCK_SCHEMAS as blockSchemas } from "@/lib/content/blocks";
import { navigationSettingsSchema, navItemSchema } from "@/lib/validation/navigation";
import { popupSchema } from "@/lib/validation/popup";

/**
 * Buttons that open a popup: the stored form (`popup:<id>`), where it is
 * accepted (buttons and the header button, never text or card links), and that
 * button popups never compete in automatic resolution. Rendering is checked in
 * the browser: this suite does not compile TSX.
 */

const ID = "cmabc123def456ghi789jkl0";

describe("the popup button target", () => {
  it("reads and writes popup:<id>, and nothing else", () => {
    expect(popupTarget(ID)).toBe(`popup:${ID}`);
    expect(popupTargetId(`popup:${ID}`)).toBe(ID);
    for (const bad of ["/contact", "popup:", "popup:short", "popup:HAS-CAPS-and-dash", `popup:${ID}/x`, "javascript:alert(1)", "", null, undefined]) {
      expect(popupTargetId(bad)).toBeNull();
    }
    expect(isPopupTarget(`popup:${ID}`)).toBe(true);
    expect(isPopupTarget("/contact")).toBe(false);
  });
});

describe("where it is accepted", () => {
  it("lets block buttons open a popup, but keeps rejecting off-site links", () => {
    const cta = blockSchemas.cta;
    expect(cta.safeParse({ heading: "Talk to us", ctaLabel: "Get a quote", ctaHref: `popup:${ID}` }).success).toBe(true);
    expect(cta.safeParse({ heading: "Talk to us", ctaLabel: "Get a quote", ctaHref: "/contact", secondaryLabel: "Call back", secondaryHref: `popup:${ID}` }).success).toBe(true);
    expect(cta.safeParse({ heading: "Talk to us", ctaLabel: "Get a quote", ctaHref: "https://elsewhere.example" }).success).toBe(false);
    expect(cta.safeParse({ heading: "Talk to us", ctaLabel: "Get a quote", ctaHref: "popup:not valid" }).success).toBe(false);
  });

  it("lets the header button open a popup, but not the menu links", () => {
    const base = navigationSettingsSchema.safeParse({
      brandName: "Emporia",
      headerLinks: [],
      ctaEnabled: true,
      ctaLabel: "Free audit",
      ctaHref: `popup:${ID}`,
      tagline: "",
      contactEmail: "",
      contactPhone: "",
      contactAddress: "",
      footerCompanyLinks: [],
      footerLegalLinks: [],
      socialLinks: [],
      copyrightName: "Emporia",
    });
    expect(base.success).toBe(true);
    expect(navItemSchema.safeParse({ label: "Audit", href: `popup:${ID}`, newTab: false }).success).toBe(false);
  });

  it("lets an active button popup save without targeting, but not an automatic one", () => {
    const input = { name: "Audit", title: "Free SEO audit", trigger: "BUTTON_CLICK", frequency: "EVERY_VISIT", isActive: true, targets: [] };
    expect(popupSchema.safeParse(input).success).toBe(true);
    expect(popupSchema.safeParse({ ...input, trigger: "PAGE_LOAD" }).success).toBe(false);
  });
});

describe("automatic resolution", () => {
  const candidate = (id: string, trigger: string, priority: number): PopupCandidate => ({
    id,
    trigger,
    priority,
    frequency: "EVERY_VISIT",
    isActive: true,
    startsAt: null,
    endsAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    targets: [{ type: "GLOBAL", path: null, serviceId: null, cityId: null, serviceCityPageId: null, packageId: null, visitorType: "ANY", device: "ANY" }],
  });
  const page = { path: "/", serviceId: null, cityId: null, serviceCityPageId: null, packageId: null };
  const visitor = { device: "DESKTOP" as const, isNewVisitor: true, seen: {}, seenThisSession: [], now: new Date("2026-06-15T12:00:00Z") };

  it("never picks a button popup, however high its priority", () => {
    expect(selectPopup([candidate("button", "BUTTON_CLICK", 999), candidate("auto", "TIME_DELAY", 1)], page, visitor)?.id).toBe("auto");
    expect(selectPopup([candidate("button", "BUTTON_CLICK", 999)], page, visitor)).toBeNull();
  });
});
