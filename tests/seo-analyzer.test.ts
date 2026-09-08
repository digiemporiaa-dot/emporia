import { describe, expect, it } from "vitest";
import { analysePage, type AnalyzerInput } from "@/lib/seo/analyzer";
import { sectionText, wordCount } from "@/lib/content/text";

/**
 * The analyzer is a pure function, so it is tested directly rather than
 * through a page. What matters is that each check fires on the condition it
 * claims to describe, and that the score moves in the right direction.
 */

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

function input(overrides: Partial<AnalyzerInput> = {}): AnalyzerInput {
  return {
    title: "Digital marketing that compounds for growing brands",
    slug: "growth-marketing",
    status: "DRAFT",
    sections: [
      { type: "heading", isVisible: true, content: { text: "How we work", level: 2 } },
      { type: "richText", isVisible: true, content: { body: words(400) } },
    ],
    seo: {
      metaTitle: null,
      metaDescription:
        "We run paid, organic and lifecycle marketing against one scorecard, so every recommendation traces back to a number you can check yourself.",
      canonical: null,
      ogTitle: null,
      ogDescription: null,
      ogImageId: "img1",
      ogImageAlt: null,
      robotsIndex: true,
      robotsFollow: true,
      schemaType: "NONE",
    },
    hasGlobalOgImage: true,
    ...overrides,
  };
}

const find = (report: ReturnType<typeof analysePage>, id: string) =>
  report.checks.find((c) => c.id === id);

describe("analysePage", () => {
  it("scores a well-formed page highly", () => {
    const report = analysePage(input());
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.counts.fail).toBe(0);
  });

  it("fails a page with no description", () => {
    const report = analysePage(input({ seo: { ...input().seo!, metaDescription: null } }));
    expect(find(report, "description")?.status).toBe("fail");
  });

  it("warns when the description is the wrong length", () => {
    const short = analysePage(input({ seo: { ...input().seo!, metaDescription: "Too short." } }));
    expect(find(short, "description")?.status).toBe("warn");
  });

  it("treats a thin page as a failure, not a warning", () => {
    const report = analysePage(
      input({ sections: [{ type: "richText", isVisible: true, content: { body: words(40) } }] }),
    );
    expect(find(report, "content")?.status).toBe("fail");
    expect(find(report, "content")?.detail).toMatch(/thin/i);
  });

  it("does not count hidden sections towards the word count", () => {
    const report = analysePage(
      input({
        sections: [
          { type: "richText", isVisible: true, content: { body: words(20) } },
          { type: "richText", isVisible: false, content: { body: words(500) } },
        ],
      }),
    );
    expect(report.stats.words).toBeLessThan(150);
    expect(find(report, "content")?.status).toBe("fail");
  });

  it("fails a live page that is set to noindex, and only warns for a draft", () => {
    const live = analysePage(
      input({ status: "PUBLISHED", seo: { ...input().seo!, robotsIndex: false } }),
    );
    expect(find(live, "robots")?.status).toBe("fail");

    const draft = analysePage(
      input({ status: "DRAFT", seo: { ...input().seo!, robotsIndex: false } }),
    );
    expect(find(draft, "robots")?.status).toBe("warn");
  });

  it("treats an absent canonical as correct, not missing", () => {
    expect(find(analysePage(input()), "canonical")?.status).toBe("pass");
  });

  it("rejects a canonical that is neither a path nor a URL", () => {
    const report = analysePage(input({ seo: { ...input().seo!, canonical: "growth-marketing" } }));
    expect(find(report, "canonical")?.status).toBe("fail");
  });

  it("notices an FAQ block with no FAQ schema, and the reverse", () => {
    const withFaq = analysePage(
      input({
        sections: [
          ...input().sections,
          { type: "faq", isVisible: true, content: { items: [{ question: "Q?", answer: "A." }] } },
        ],
      }),
    );
    expect(find(withFaq, "schema")?.status).toBe("warn");

    const claimsFaq = analysePage(input({ seo: { ...input().seo!, schemaType: "FAQ_PAGE" } }));
    expect(find(claimsFaq, "schema")?.status).toBe("fail");
  });

  it("fails an image with no alt text and passes one described as decorative", () => {
    const missing = analysePage(
      input({
        sections: [
          ...input().sections,
          { type: "image", isVisible: true, content: { mediaId: "m1", width: "container" } },
        ],
      }),
    );
    expect(find(missing, "images")?.status).toBe("fail");

    const decorative = analysePage(
      input({
        sections: [
          ...input().sections,
          { type: "image", isVisible: true, content: { mediaId: "m1", alt: "", width: "container" } },
        ],
      }),
    );
    expect(find(decorative, "images")?.status).toBe("pass");
  });

  it("counts internal links, including ones written inline in rich text", () => {
    const report = analysePage(
      input({
        sections: [
          {
            type: "richText",
            isVisible: true,
            content: { body: `${words(300)} see [services](/services) and [work](/case-studies)` },
          },
        ],
      }),
    );
    expect(report.stats.internalLinks).toBe(2);
    expect(find(report, "links")?.status).toBe("pass");
  });

  it("scores an empty page near zero and never below it", () => {
    const report = analysePage(
      input({ title: "", sections: [], seo: null, hasGlobalOgImage: false }),
    );
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThan(40);
    expect(report.counts.fail).toBeGreaterThan(0);
  });

  it("keeps the score within bounds whatever it is given", () => {
    for (const report of [analysePage(input()), analysePage(input({ sections: [], seo: null }))]) {
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("sectionText", () => {
  it("pulls words out of nested repeating shapes", () => {
    const { text } = sectionText("iconCards", {
      heading: "How we work",
      items: [
        { icon: "search", title: "Audit", text: "We measure first." },
        { icon: "target", title: "Build", text: "Then we build." },
      ],
    });
    expect(text).toContain("How we work");
    expect(text).toContain("Audit");
    expect(text).toContain("We measure first.");
    expect(wordCount(text)).toBeGreaterThan(6);
  });

  it("strips markdown so formatting is not counted as words", () => {
    const { text } = sectionText("richText", { body: "**Bold** and [a link](/x)." });
    expect(text).toBe("Bold and a link.");
  });

  it("collects hrefs as links rather than words", () => {
    const { links } = sectionText("cta", {
      heading: "Talk to us",
      ctaLabel: "Contact",
      ctaHref: "/contact",
    });
    expect(links).toContain("/contact");
  });
});
