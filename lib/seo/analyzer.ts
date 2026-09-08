import { blockWarnings, mediaIdsIn } from "@/lib/content/blocks";
import { inlineLinks, sectionText, wordCount } from "@/lib/content/text";

/**
 * The SEO analyzer.
 *
 * A pure function over a snapshot of a page: no database, no request context,
 * so it can be unit tested directly and run identically in the editor and in
 * any future publish check.
 *
 * It reports, it does not block. Deciding a page is unpublishable is a
 * different judgement from noticing its description is short, and conflating
 * them produces an editor who learns to ignore both. The one place this
 * project *does* block — `canPublish` for service-city pages — exists because
 * CLAUDE.md 9 forbids thin local pages specifically.
 *
 * Every threshold below is a documented convention rather than a rule search
 * engines publish. They are the ones worth arguing with; change them here and
 * the whole product changes with them.
 */

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;
/** Below this a landing page is thin, whatever else is right about it. */
const THIN_WORDS = 150;
const HEALTHY_WORDS = 300;

export type CheckStatus = "pass" | "warn" | "fail";

export type SeoCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** What is wrong and what to do about it. Empty when the check passes. */
  detail: string;
  /** Contribution to the score. Failing a heavier check costs more. */
  weight: number;
};

export type SeoReport = {
  /** 0–100. Weighted proportion of checks passed; a warning scores half. */
  score: number;
  checks: SeoCheck[];
  counts: { pass: number; warn: number; fail: number };
  /** Facts the panel shows alongside the checks. */
  stats: { words: number; internalLinks: number; images: number; imagesWithAlt: number };
};

export type AnalyzerSection = {
  type: string;
  content: unknown;
  isVisible: boolean;
};

export type AnalyzerInput = {
  title: string;
  slug: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  sections: readonly AnalyzerSection[];
  seo: {
    metaTitle: string | null;
    metaDescription: string | null;
    canonical: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImageId: string | null;
    ogImageAlt: string | null;
    robotsIndex: boolean;
    robotsFollow: boolean;
    schemaType: string;
  } | null;
  /** Whether the site has a global OG image to fall back on. */
  hasGlobalOgImage: boolean;
};

function check(
  id: string,
  label: string,
  weight: number,
  status: CheckStatus,
  detail = "",
): SeoCheck {
  return { id, label, status, detail, weight };
}

export function analysePage(input: AnalyzerInput): SeoReport {
  const checks: SeoCheck[] = [];

  // Only what the public page actually renders is analysed. A hidden section's
  // words are not on the page, so counting them would flatter a thin one.
  const visible = input.sections.filter((section) => section.isVisible);

  let text = "";
  const links: string[] = [];
  let images = 0;
  let imagesWithAlt = 0;
  let hasHeadingBlock = false;
  let hasFaq = false;
  const warnings: string[] = [];

  for (const section of visible) {
    const extracted = sectionText(section.type, section.content);
    text += ` ${extracted.text}`;
    links.push(...extracted.links.filter(Boolean));

    const content = (section.content ?? {}) as Record<string, unknown>;
    if (typeof content["body"] === "string") links.push(...inlineLinks(content["body"]));
    if (Array.isArray(content["items"])) {
      for (const item of content["items"]) {
        const answer = (item as Record<string, unknown> | null)?.["answer"];
        if (typeof answer === "string") links.push(...inlineLinks(answer));
      }
    }

    if (section.type === "heading") hasHeadingBlock = true;
    if (section.type === "faq") hasFaq = true;

    for (const id of mediaIdsIn(section.type, section.content)) {
      images += 1;
      // Alt lives beside the id: on the block for a single image, on the item
      // for a card. An empty string is a deliberate "decorative", not a gap.
      const alt = content["alt"];
      if (typeof alt === "string") {
        imagesWithAlt += 1;
        continue;
      }
      if (Array.isArray(content["items"])) {
        const match = content["items"].find(
          (item) => (item as Record<string, unknown> | null)?.["mediaId"] === id,
        ) as Record<string, unknown> | undefined;
        if (match && typeof match["alt"] === "string") imagesWithAlt += 1;
      }
    }

    warnings.push(...blockWarnings(section.type, section.content));
  }

  const words = wordCount(text);
  const internalLinks = new Set(links.filter((href) => href.startsWith("/"))).size;

  /**
   * A page with nothing on it must not collect passes for the checks that have
   * nothing to look at. "No unfinished blocks" is true of a page with no
   * blocks, and counting that as a pass scored an entirely empty page at 42 —
   * telling an editor it was nearly halfway there. Vacuous checks fail instead.
   */
  const isEmpty = visible.length === 0;
  const vacuous = (id: string, label: string, weight: number) =>
    check(id, label, weight, "fail", "This page has no sections yet.");

  // --- title ---------------------------------------------------------------
  const title = input.seo?.metaTitle?.trim() || input.title.trim();
  if (!title) {
    checks.push(check("title", "Meta title", 3, "fail", "This page has no title at all."));
  } else if (title.length < TITLE_MIN) {
    checks.push(
      check(
        "title",
        "Meta title",
        3,
        "warn",
        `${title.length} characters. Under ${TITLE_MIN} usually wastes space in the result.`,
      ),
    );
  } else if (title.length > TITLE_MAX) {
    checks.push(
      check(
        "title",
        "Meta title",
        3,
        "warn",
        `${title.length} characters. Over ${TITLE_MAX} is normally truncated.`,
      ),
    );
  } else {
    checks.push(check("title", "Meta title", 3, "pass"));
  }

  // --- description ---------------------------------------------------------
  const description = input.seo?.metaDescription?.trim() ?? "";
  if (!description) {
    checks.push(
      check(
        "description",
        "Meta description",
        3,
        "fail",
        "Without one, the search result quotes whatever text it finds first.",
      ),
    );
  } else if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    checks.push(
      check(
        "description",
        "Meta description",
        3,
        "warn",
        `${description.length} characters. Aim for ${DESCRIPTION_MIN}–${DESCRIPTION_MAX}.`,
      ),
    );
  } else {
    checks.push(check("description", "Meta description", 3, "pass"));
  }

  // --- content depth -------------------------------------------------------
  if (words === 0) {
    checks.push(check("content", "Page content", 4, "fail", "This page has no visible words."));
  } else if (words < THIN_WORDS) {
    checks.push(
      check(
        "content",
        "Page content",
        4,
        "fail",
        `${words} words. Under ${THIN_WORDS} reads as a thin page.`,
      ),
    );
  } else if (words < HEALTHY_WORDS) {
    checks.push(
      check("content", "Page content", 4, "warn", `${words} words. ${HEALTHY_WORDS}+ is healthier.`),
    );
  } else {
    checks.push(check("content", "Page content", 4, "pass", `${words} words.`));
  }

  // --- structure -----------------------------------------------------------
  checks.push(
    visible.length === 0
      ? check("sections", "Page structure", 2, "fail", "This page has no visible sections.")
      : hasHeadingBlock
        ? check("sections", "Page structure", 2, "pass")
        : check(
            "sections",
            "Page structure",
            2,
            "warn",
            "No heading block. Sub-headings help a long page be scanned and understood.",
          ),
  );

  // --- images --------------------------------------------------------------
  if (isEmpty) {
    checks.push(vacuous("images", "Image alt text", 1));
  } else if (images === 0) {
    checks.push(check("images", "Images", 1, "warn", "No images on this page."));
  } else if (imagesWithAlt < images) {
    checks.push(
      check(
        "images",
        "Image alt text",
        3,
        "fail",
        `${images - imagesWithAlt} of ${images} images have no alt text. Use an empty one deliberately if the image is decorative.`,
      ),
    );
  } else {
    checks.push(check("images", "Image alt text", 3, "pass", `${images} images, all described.`));
  }

  // --- internal linking ----------------------------------------------------
  checks.push(
    isEmpty
      ? vacuous("links", "Internal links", 2)
      : internalLinks === 0
      ? check(
          "links",
          "Internal links",
          2,
          "warn",
          "No links to other pages. Contextual links help both readers and crawlers (CLAUDE.md 9).",
        )
      : check("links", "Internal links", 2, "pass", `${internalLinks} internal links.`),
  );

  // --- indexability --------------------------------------------------------
  if (!input.seo || input.seo.robotsIndex) {
    checks.push(check("robots", "Indexable", 3, "pass"));
  } else {
    checks.push(
      check(
        "robots",
        "Indexable",
        3,
        input.status === "PUBLISHED" ? "fail" : "warn",
        input.status === "PUBLISHED"
          ? "This page is live but set to noindex, so it will not appear in search."
          : "Set to noindex. Remember to allow indexing before publishing.",
      ),
    );
  }

  // --- canonical -----------------------------------------------------------
  const canonical = input.seo?.canonical?.trim() ?? "";
  if (!canonical) {
    // Not a gap: an absent override means the canonical is derived from the
    // page's own URL, which is the correct answer almost always.
    checks.push(check("canonical", "Canonical", 1, "pass", "Derived from the page's own address."));
  } else if (canonical.startsWith("/") || canonical.startsWith("http")) {
    checks.push(check("canonical", "Canonical", 1, "warn", `Overridden to ${canonical}.`));
  } else {
    checks.push(
      check("canonical", "Canonical", 1, "fail", "Must be a path starting with / or a full URL."),
    );
  }

  // --- social card ---------------------------------------------------------
  const hasOgImage = Boolean(input.seo?.ogImageId) || input.hasGlobalOgImage;
  checks.push(
    hasOgImage
      ? check("social", "Social image", 2, "pass")
      : check(
          "social",
          "Social image",
          2,
          "warn",
          "No image for this page and no site-wide default, so shared links will look bare.",
        ),
  );

  // --- structured data -----------------------------------------------------
  if (isEmpty) {
    checks.push(vacuous("schema", "Structured data", 2));
  } else if (hasFaq && input.seo?.schemaType !== "FAQ_PAGE") {
    checks.push(
      check(
        "schema",
        "Structured data",
        2,
        "warn",
        "This page has an FAQ. Setting the schema type to FAQ page publishes it as structured data.",
      ),
    );
  } else if (!hasFaq && input.seo?.schemaType === "FAQ_PAGE") {
    checks.push(
      check(
        "schema",
        "Structured data",
        2,
        "fail",
        "Marked as an FAQ page but there is no FAQ block, so nothing would be emitted.",
      ),
    );
  } else {
    checks.push(check("schema", "Structured data", 2, "pass"));
  }

  // --- unfinished blocks ---------------------------------------------------
  checks.push(
    isEmpty
      ? vacuous("blocks", "Finished blocks", 2)
      : warnings.length === 0
      ? check("blocks", "Finished blocks", 2, "pass")
      : check("blocks", "Finished blocks", 2, "warn", warnings.join(" · ")),
  );

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce(
    (sum, c) => sum + (c.status === "pass" ? c.weight : c.status === "warn" ? c.weight / 2 : 0),
    0,
  );

  return {
    score: total === 0 ? 0 : Math.round((earned / total) * 100),
    checks,
    counts: {
      pass: checks.filter((c) => c.status === "pass").length,
      warn: checks.filter((c) => c.status === "warn").length,
      fail: checks.filter((c) => c.status === "fail").length,
    },
    stats: { words, internalLinks, images, imagesWithAlt },
  };
}
