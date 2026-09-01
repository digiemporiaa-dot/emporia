import { describe, expect, it } from "vitest";
import { canPublish, PUBLISH_THRESHOLDS, type PublishCandidate, type SiblingContent } from "@/lib/local/can-publish";
import { isNearDuplicate, similarity, stripLocalTokens, wordCount } from "@/lib/local/similarity";

/**
 * The rule this phase turns on: a Service x City page without genuine local
 * substance cannot leave DRAFT (CLAUDE.md 9).
 */

function words(n: number, seed = "genuine local detail about this market"): string {
  const base = seed.split(" ");
  const out: string[] = [];
  while (out.length < n) out.push(base[out.length % base.length] as string);
  return out.join(" ");
}

const complete: PublishCandidate = {
  localIntro: words(130),
  marketContext: words(110, "distinct commentary on regional demand and buyer behaviour"),
  industries: ["Hospitality", "Real estate", "Healthcare"],
  positioning: "The local positioning statement.",
  ctaHeading: "Work with us here",
  ctaBody: "Tell us what you need.",
  faqCount: 3,
  localProofCount: 1,
  seo: {
    metaTitle: "SEO services in Gurgaon",
    metaDescription: "A description that is comfortably long enough to be useful in search results.",
  },
  localTokens: ["Gurgaon", "Haryana"],
};

describe("text utilities", () => {
  it("counts words after normalisation", () => {
    expect(wordCount("Hello,   world!  ")).toBe(2);
    expect(wordCount("")).toBe(0);
  });

  it("strips the place names that are meant to differ", () => {
    expect(stripLocalTokens("SEO services in Gurgaon, Haryana", ["Gurgaon", "Haryana"])).toBe(
      "seo services in",
    );
  });

  it("scores identical text as fully similar", () => {
    expect(similarity("the quick brown fox jumps", "the quick brown fox jumps")).toBe(1);
  });

  it("scores unrelated text as dissimilar", () => {
    expect(
      similarity(
        "we rebuilt the technical foundations of the site and consolidated its architecture",
        "hospitality clients here care most about seasonal demand and last minute bookings",
      ),
    ).toBeLessThan(0.2);
  });
});

describe("templated content detection", () => {
  it("catches an intro reused with only the city name swapped", () => {
    const gurgaon =
      "Businesses in Gurgaon face a crowded search landscape, and most of them are competing for the same handful of commercial terms without the technical foundations to hold a position once they win it.";
    const mumbai = gurgaon.replaceAll("Gurgaon", "Mumbai");

    expect(isNearDuplicate(gurgaon, mumbai, ["Gurgaon", "Mumbai"])).toBe(true);
  });

  it("accepts two intros that genuinely differ", () => {
    const gurgaon =
      "Businesses in Gurgaon face a crowded search landscape dominated by a handful of national brands with large content budgets and long-standing domain authority.";
    const mumbai =
      "Retail and hospitality dominate the Mumbai market, so seasonality matters far more here than it does elsewhere, and the calendar drives most of what we publish.";

    expect(isNearDuplicate(gurgaon, mumbai, ["Gurgaon", "Mumbai"])).toBe(false);
  });
});

describe("canPublish", () => {
  it("passes a complete page", () => {
    const result = canPublish(complete);
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("refuses a completely empty page and says why", () => {
    const empty: PublishCandidate = {
      localIntro: null,
      marketContext: null,
      industries: null,
      positioning: null,
      ctaHeading: null,
      ctaBody: null,
      faqCount: 0,
      localProofCount: 0,
      seo: null,
      localTokens: [],
    };

    const result = canPublish(empty);
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(8);

    // Every substance and metadata check fails. The two uniqueness checks pass
    // trivially — with no sibling pages there is nothing to duplicate — which
    // is correct: emptiness is caught by the substance rules, not by these.
    const substance = result.checks.filter((c) => c.key !== "unique" && c.key !== "uniqueMeta");
    expect(substance.every((c) => !c.passed)).toBe(true);
    expect(substance.length).toBe(10);
  });

  it("refuses a thin intro just under the threshold", () => {
    const result = canPublish({
      ...complete,
      localIntro: words(PUBLISH_THRESHOLDS.localIntroWords - 1),
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.key === "localIntro")?.passed).toBe(false);
  });

  it("refuses fewer industries than required", () => {
    const result = canPublish({ ...complete, industries: ["Retail", "Hospitality"] });
    expect(result.checks.find((c) => c.key === "industries")?.passed).toBe(false);
  });

  it("refuses a page with no local proof", () => {
    const result = canPublish({ ...complete, localProofCount: 0 });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("case study or testimonial");
  });

  it("refuses too few local FAQs", () => {
    expect(canPublish({ ...complete, faqCount: 2 }).ok).toBe(false);
  });

  it("refuses a missing or short meta description", () => {
    const result = canPublish({
      ...complete,
      seo: { metaTitle: "Title", metaDescription: "Too short" },
    });
    expect(result.checks.find((c) => c.key === "metaDescription")?.passed).toBe(false);
  });

  it("refuses content templated from a sibling city, even when long enough", () => {
    const sharedIntro = words(130, "Gurgaon businesses need local search visibility to compete");
    const siblings: SiblingContent[] = [
      {
        id: "sib",
        cityName: "Mumbai",
        localIntro: sharedIntro.replaceAll("Gurgaon", "Mumbai"),
        marketContext: words(110, "distinct commentary on regional demand and buyer behaviour"),
        metaTitle: "SEO services in Mumbai",
        metaDescription: "Another description entirely, different from the Gurgaon one.",
      },
    ];

    const result = canPublish({ ...complete, localIntro: sharedIntro }, siblings);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.key === "unique")?.passed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Mumbai");
  });

  it("allows genuinely different content alongside a sibling", () => {
    const siblings: SiblingContent[] = [
      {
        id: "sib",
        cityName: "Mumbai",
        localIntro: words(130, "Retail and hospitality dominate here so seasonality drives publishing"),
        marketContext: words(110, "Coastal logistics and monsoon planning shape quarterly demand"),
        metaTitle: "SEO services in Mumbai",
        metaDescription: "A Mumbai-specific description, unlike the Gurgaon one entirely.",
      },
    ];

    expect(canPublish(complete, siblings).ok).toBe(true);
  });

  it("refuses metadata copied verbatim from a sibling", () => {
    const siblings: SiblingContent[] = [
      {
        id: "sib",
        cityName: "Mumbai",
        localIntro: words(130, "Retail and hospitality dominate here so seasonality drives publishing"),
        marketContext: words(110, "Coastal logistics and monsoon planning shape quarterly demand"),
        metaTitle: "SEO services in Gurgaon",
        metaDescription: "A description that is comfortably long enough to be useful in search results.",
      },
    ];

    const result = canPublish(complete, siblings);
    expect(result.checks.find((c) => c.key === "uniqueMeta")?.passed).toBe(false);
  });
});
