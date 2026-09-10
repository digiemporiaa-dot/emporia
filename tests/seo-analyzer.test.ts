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
      targetKeyword: null,
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

/**
 * SEO 2.0: the target keyword, the heading outline, and links that go nowhere.
 */

const withKeyword = (keyword: string, overrides: Partial<AnalyzerInput> = {}) =>
  input({
    ...overrides,
    // An overridden `seo` still gets the keyword, rather than being discarded
    // by it.
    seo: {
      ...(input().seo as NonNullable<AnalyzerInput["seo"]>),
      ...(overrides.seo ?? {}),
      targetKeyword: keyword,
    },
  });

describe("target keyword", () => {
  it("runs no keyword checks when none is set", () => {
    const report = analysePage(input());
    expect(find(report, "keywordPlacement")).toBeUndefined();
    expect(find(report, "keywordDensity")).toBeUndefined();
    expect(report.stats.keywordDensity).toBeNull();
  });

  it("passes placement when the phrase is in the title, description and a heading", () => {
    const report = analysePage(
      withKeyword("growth marketing", {
        title: "Growth marketing that compounds for brands",
        sections: [
          { type: "heading", isVisible: true, content: { text: "Our growth marketing", level: 2 } },
          { type: "richText", isVisible: true, content: { body: `growth marketing ${words(200)}` } },
        ],
        seo: {
          ...(input().seo as NonNullable<AnalyzerInput["seo"]>),
          targetKeyword: "growth marketing",
          metaDescription:
            "Growth marketing run against one scorecard, so every recommendation traces back to a number you can check yourself today.",
        },
      }),
    );
    expect(find(report, "keywordPlacement")?.status).toBe("pass");
  });

  it("fails placement when the phrase is nowhere that matters", () => {
    const report = analysePage(withKeyword("local seo"));
    const check = find(report, "keywordPlacement");
    expect(check?.status).toBe("fail");
    // Names all three places, so the editor knows what to change.
    expect(check?.detail).toMatch(/title.*description.*sub-heading/);
  });

  it("warns rather than fails when only one place is missing", () => {
    const report = analysePage(
      withKeyword("digital marketing", {
        title: "Digital marketing that compounds",
        sections: [
          { type: "heading", isVisible: true, content: { text: "Digital marketing", level: 2 } },
        ],
      }),
    );
    expect(find(report, "keywordPlacement")?.status).toBe("warn");
  });

  it("notices the phrase in the address, reading the slug as words", () => {
    expect(find(analysePage(withKeyword("growth marketing")), "keywordSlug")?.status).toBe("pass");
    expect(find(analysePage(withKeyword("local seo")), "keywordSlug")?.status).toBe("warn");
  });

  it("fails density when the phrase is not in the body at all", () => {
    const report = analysePage(withKeyword("local seo"));
    expect(find(report, "keywordDensity")?.status).toBe("fail");
  });

  it("fails density when the phrase is stuffed", () => {
    // Stuffing is penalised rather than ignored, so this is a failure, not a
    // warning like being merely thin.
    const body = `${Array(30).fill("growth marketing").join(" ")} ${words(40)}`;
    const report = analysePage(
      withKeyword("growth marketing", {
        sections: [{ type: "richText", isVisible: true, content: { body } }],
      }),
    );
    const check = find(report, "keywordDensity");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toMatch(/stuffing/);
  });

  it("warns when the phrase is present but thin", () => {
    const body = `growth marketing ${words(600)}`;
    const report = analysePage(
      withKeyword("growth marketing", {
        sections: [{ type: "richText", isVisible: true, content: { body } }],
      }),
    );
    expect(find(report, "keywordDensity")?.status).toBe("warn");
  });

  it("reports the density and count as facts, not only as a verdict", () => {
    const body = `${Array(4).fill("growth marketing").join(" ")} ${words(92)}`;
    const report = analysePage(
      withKeyword("growth marketing", {
        sections: [{ type: "richText", isVisible: true, content: { body } }],
      }),
    );
    expect(report.stats.keywordCount).toBe(4);
    expect(report.stats.keywordDensity).toBeGreaterThan(0);
  });
});

describe("heading outline", () => {
  it("passes a page whose sub-headings start at level 2", () => {
    expect(find(analysePage(input()), "outline")?.status).toBe("pass");
  });

  it("warns when the first sub-heading is a level 3", () => {
    const report = analysePage({
      ...input(),
      sections: [
        { type: "heading", isVisible: true, content: { text: "A sub-point", level: 3 } },
        { type: "richText", isVisible: true, content: { body: words(400) } },
      ],
    });
    expect(find(report, "outline")?.status).toBe("warn");
  });

  it("warns when a page has no sub-headings at all", () => {
    const report = analysePage({
      ...input(),
      sections: [{ type: "richText", isVisible: true, content: { body: words(400) } }],
    });
    expect(find(report, "outline")?.status).toBe("warn");
  });

  it("counts a band's own heading towards the outline", () => {
    const report = analysePage({
      ...input(),
      sections: [
        { type: "imageText", isVisible: true, content: { heading: "What we do", body: words(400) } },
      ],
    });
    expect(find(report, "outline")?.status).toBe("pass");
  });
});

describe("links that go nowhere", () => {
  const linking = (hrefs: string[]) => ({
    ...input(),
    sections: [
      {
        type: "richText",
        isVisible: true,
        content: { body: `${hrefs.map((h) => `[a](${h})`).join(" ")} ${words(400)}` },
      },
    ],
  });

  it("is not checked at all when the caller supplied no paths", () => {
    // A caller that could not do the lookup has not discovered bad links.
    const report = analysePage(linking(["/nowhere"]));
    expect(find(report, "brokenLinks")).toBeUndefined();
    expect(report.stats.brokenLinks).toEqual([]);
  });

  it("passes when every internal link resolves", () => {
    const report = analysePage({
      ...linking(["/services/seo", "/contact"]),
      knownPaths: new Set(["/services/seo", "/contact"]),
    });
    expect(find(report, "brokenLinks")?.status).toBe("pass");
  });

  it("fails and names the links that go nowhere", () => {
    const report = analysePage({
      ...linking(["/services/seo", "/gone"]),
      knownPaths: new Set(["/services/seo"]),
    });
    const check = find(report, "brokenLinks");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toMatch(/\/gone/);
    expect(report.stats.brokenLinks).toEqual(["/gone"]);
  });

  it("ignores a query string when matching, because the page is the same page", () => {
    const report = analysePage({
      ...linking(["/contact?utm_source=x"]),
      knownPaths: new Set(["/contact"]),
    });
    expect(find(report, "brokenLinks")?.status).toBe("pass");
  });

  it("counts external links separately and never calls them broken", () => {
    const report = analysePage({
      ...linking(["https://example.com/a"]),
      knownPaths: new Set<string>(),
    });
    expect(report.stats.externalLinks).toBe(1);
    expect(report.stats.brokenLinks).toEqual([]);
  });
});
