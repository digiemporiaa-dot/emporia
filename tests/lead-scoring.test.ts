import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING,
  bandOf,
  mergeScoringConfig,
  scoreLead,
  type ScoringConfig,
} from "@/lib/crm/scoring";
import { canTransition, transitionError } from "@/lib/crm/pipeline";

describe("scoring", () => {
  it("scores an empty enquiry at zero and cold", () => {
    const result = scoreLead({});
    expect(result.score).toBe(0);
    expect(result.band).toBe("COLD");
    expect(result.factors).toEqual([]);
  });

  it("scores budget in bands, taking the highest that applies", () => {
    expect(scoreLead({ budget: "600000" }).score).toBe(35);
    expect(scoreLead({ budget: "250000" }).score).toBe(28);
    expect(scoreLead({ budget: "99999" }).score).toBe(12);
    expect(scoreLead({ budget: "0" }).score).toBe(0);
  });

  it("compares budget as Decimal, so a large value is not floated", () => {
    // 999999999999.99 must land in the top band, not overflow or round.
    expect(scoreLead({ budget: "999999999999.99" }).score).toBe(35);
  });

  it("ignores an unparseable budget rather than throwing", () => {
    expect(() => scoreLead({ budget: "not a number" })).not.toThrow();
    expect(scoreLead({ budget: "not a number" }).score).toBe(0);
  });

  it("adds points for source, phone, company and message detail", () => {
    const result = scoreLead({
      sourceSlug: "referral",
      phone: "+91 98765 43210",
      company: "Acme",
      message: "x".repeat(500),
    });
    // referral 20 + phone 8 + company 6 + long message 12
    expect(result.score).toBe(46);
    expect(result.factors.map((f) => f.label).sort()).toEqual([
      "Company provided",
      "Message detail",
      "Phone provided",
      "Source",
    ]);
  });

  it("uses the longest matching message band only once", () => {
    expect(scoreLead({ message: "x".repeat(500) }).score).toBe(12);
    expect(scoreLead({ message: "x".repeat(200) }).score).toBe(8);
    expect(scoreLead({ message: "x".repeat(50) }).score).toBe(4);
    expect(scoreLead({ message: "hi" }).score).toBe(0);
  });

  it("treats whitespace-only fields as absent", () => {
    expect(scoreLead({ phone: "   ", company: "  ", message: "   " }).score).toBe(0);
  });

  it("rewards naming a package", () => {
    expect(scoreLead({ packageId: "pkg-1" }).score).toBe(10);
  });

  it("clamps to the configured maximum", () => {
    const result = scoreLead({
      budget: "5000000",
      sourceSlug: "referral",
      phone: "+91 1",
      company: "Acme",
      message: "x".repeat(500),
      packageId: "pkg",
    });
    // Raw would be 35+20+8+6+12+10 = 91, under the cap.
    expect(result.score).toBe(91);

    const tight: ScoringConfig = { ...DEFAULT_SCORING, max: 50 };
    expect(
      scoreLead(
        {
          budget: "5000000",
          sourceSlug: "referral",
          phone: "+91 1",
          company: "Acme",
          message: "x".repeat(500),
        },
        tight,
      ).score,
    ).toBe(50);
  });

  it("assigns bands from the score", () => {
    expect(bandOf(0)).toBe("COLD");
    expect(bandOf(29)).toBe("COLD");
    expect(bandOf(30)).toBe("WARM");
    expect(bandOf(59)).toBe("WARM");
    expect(bandOf(60)).toBe("HOT");
  });

  it("explains its score, so a number can be justified", () => {
    const result = scoreLead({ budget: "300000", sourceSlug: "referral" });
    expect(result.factors).toEqual([
      { label: "Budget", points: 28 },
      { label: "Source", points: 20 },
    ]);
    expect(result.factors.reduce((n, f) => n + f.points, 0)).toBe(result.score);
  });
});

describe("configurability", () => {
  it("merges a stored partial config over the defaults", () => {
    const merged = mergeScoringConfig({ bands: { hot: 80, warm: 40 } });
    expect(merged.bands).toEqual({ hot: 80, warm: 40 });
    // Untouched sections keep their defaults.
    expect(merged.source["referral"]).toBe(20);
  });

  it("lets an admin retune weights without code changes", () => {
    const config = mergeScoringConfig({ source: { referral: 50 } });
    expect(scoreLead({ sourceSlug: "referral" }, config).score).toBe(50);
  });

  it("adds service and city weights, which are empty by default", () => {
    expect(scoreLead({ serviceSlug: "seo", citySlug: "gurgaon" }).score).toBe(0);
    const config = mergeScoringConfig({ service: { seo: 15 }, city: { gurgaon: 5 } });
    expect(scoreLead({ serviceSlug: "seo", citySlug: "gurgaon" }, config).score).toBe(20);
  });

  it("falls back to defaults for rubbish stored config", () => {
    expect(mergeScoringConfig(null)).toEqual(DEFAULT_SCORING);
    expect(mergeScoringConfig("nonsense")).toEqual(DEFAULT_SCORING);
    expect(mergeScoringConfig({ budget: [] }).budget).toEqual(DEFAULT_SCORING.budget);
  });
});

describe("pipeline transitions", () => {
  it("allows moving forwards and backwards", () => {
    expect(canTransition("NEW", "CONTACTED")).toBe(true);
    expect(canTransition("PROPOSAL", "CONTACTED")).toBe(true);
    expect(canTransition("NEW", "LOST")).toBe(true);
    expect(canTransition("LOST", "NURTURE")).toBe(true);
  });

  it("refuses a no-op move", () => {
    expect(canTransition("NEW", "NEW")).toBe(false);
    expect(transitionError("NEW", "NEW")).toMatch(/already/);
  });

  it("refuses to move a won lead, since winning creates a client", () => {
    expect(canTransition("WON", "NEGOTIATION")).toBe(false);
    expect(transitionError("WON", "LOST")).toMatch(/cannot be moved back/);
  });
});
