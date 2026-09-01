import { describe, expect, it } from "vitest";
import { faqSchema } from "@/lib/seo/schema";
import { breadcrumbSchema } from "@/lib/seo/breadcrumbs";

/**
 * The point of these emitters is what they REFUSE to emit. Structured data
 * asserting content a page does not contain is what gets a site flagged
 * (CLAUDE.md 9).
 */

describe("FAQPage", () => {
  it("emits questions when the page has them", () => {
    const schema = faqSchema([
      { question: "How long does SEO take?", answer: "Usually four to nine months." },
    ]) as { "@type": string; mainEntity: unknown[] } | null;

    expect(schema?.["@type"]).toBe("FAQPage");
    expect(schema?.mainEntity).toHaveLength(1);
  });

  it("emits nothing at all when the page renders no FAQs", () => {
    expect(faqSchema([])).toBeNull();
  });
});

describe("BreadcrumbList", () => {
  it("numbers positions from one, in order", () => {
    process.env["SITE_URL"] = "https://emporia.example";
    const schema = breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Services", path: "/services" },
      { name: "SEO", path: "/services/seo" },
    ]) as { itemListElement: { position: number; name: string; item: string }[] } | null;

    expect(schema?.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(schema?.itemListElement.map((i) => i.name)).toEqual(["Home", "Services", "SEO"]);
    expect(schema?.itemListElement[2]?.item).toContain("/services/seo");
  });

  it("emits nothing for a trail with no actual hierarchy", () => {
    expect(breadcrumbSchema([{ name: "Home", path: "/" }])).toBeNull();
    expect(breadcrumbSchema([])).toBeNull();
  });
});
