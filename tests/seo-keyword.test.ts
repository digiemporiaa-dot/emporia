import { describe, expect, it } from "vitest";
import { containsPhrase, countPhrase, density, normalise } from "@/lib/seo/keyword";

/**
 * Keyword matching: forgiving about form, strict about substance.
 */

describe("normalise", () => {
  it("lower-cases and strips punctuation", () => {
    expect(normalise("Digital Marketing, Agency!")).toBe("digital marketing agency");
  });

  it("reads hyphens and slashes as word separators, so a slug is a phrase", () => {
    expect(normalise("/digital-marketing-agency")).toBe("digital marketing agency");
  });

  it("collapses runs of whitespace", () => {
    expect(normalise("digital   marketing")).toBe("digital marketing");
  });
});

describe("containsPhrase", () => {
  it("finds the phrase inside a longer sentence", () => {
    expect(containsPhrase("We are a digital marketing agency in Gurgaon.", "digital marketing agency")).toBe(true);
  });

  it("ignores case and punctuation", () => {
    expect(containsPhrase("DIGITAL MARKETING AGENCY!", "digital marketing agency")).toBe(true);
  });

  it("matches a phrase written into a slug", () => {
    expect(containsPhrase("/services/digital-marketing-agency", "digital marketing agency")).toBe(true);
  });

  it("does not match a fragment of a longer word", () => {
    // A page about Seoul is not a page about SEO.
    expect(containsPhrase("Our office is in Seoul.", "seo")).toBe(false);
  });

  it("does not match the words out of order or apart", () => {
    expect(containsPhrase("marketing for the digital agency world", "digital marketing agency")).toBe(false);
  });

  it("is false for an empty phrase or empty text", () => {
    expect(containsPhrase("anything", "")).toBe(false);
    expect(containsPhrase("", "seo")).toBe(false);
  });
});

describe("countPhrase", () => {
  it("counts every occurrence", () => {
    expect(countPhrase("seo work, more seo work, still seo", "seo")).toBe(3);
  });

  it("counts two adjacent occurrences, which share a separator", () => {
    expect(countPhrase("local seo local seo", "local seo")).toBe(2);
  });

  it("is zero when the phrase is absent", () => {
    expect(countPhrase("nothing relevant here", "local seo")).toBe(0);
  });
});

describe("density", () => {
  it("measures the words the phrase occupies, not its occurrences", () => {
    // Three-word phrase, five uses, 300 words: fifteen of the words are the
    // phrase, so 5% — which is what the number has to mean to be readable.
    const text = Array(5).fill("digital marketing agency").join(" ");
    expect(density(text, "digital marketing agency", 300)).toBeCloseTo(5, 5);
  });

  it("is zero for a page with no words", () => {
    expect(density("", "seo", 0)).toBe(0);
  });

  it("is zero when the phrase never appears", () => {
    expect(density("a page about something else entirely", "local seo", 100)).toBe(0);
  });
});
