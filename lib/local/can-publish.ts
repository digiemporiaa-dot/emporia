import { isNearDuplicate, similarity, wordCount } from "@/lib/local/similarity";

/**
 * The publishability rule for Service × City pages.
 *
 * CLAUDE.md 9 requires this to be enforced in the service layer, not documented
 * as an intention — so `canPublish` is the only gate to PUBLISHED, and it is
 * also consulted by the sitemap query and by generateMetadata (to force
 * noindex). A thin page cannot become indexable through any path.
 *
 * The thresholds are business rules, proposed in docs/ARCHITECTURE.md 13 as
 * decision D6. They live here as data so they can be changed in one place.
 */

export const PUBLISH_THRESHOLDS = {
  localIntroWords: 120,
  marketContextWords: 100,
  industries: 3,
  faqs: 3,
  localProof: 1,
  metaDescriptionChars: 70,
} as const;

export type PublishCandidate = {
  localIntro: string | null;
  marketContext: string | null;
  industries: unknown;
  positioning: string | null;
  ctaHeading: string | null;
  ctaBody: string | null;
  faqCount: number;
  /** Case studies plus testimonials tied to this city or service. */
  localProofCount: number;
  seo: { metaTitle: string | null; metaDescription: string | null } | null;
  /** City and state names, removed before comparing against sibling pages. */
  localTokens: readonly string[];
};

/** A sibling page for the same service, used for the uniqueness comparison. */
export type SiblingContent = {
  id: string;
  cityName: string;
  localIntro: string | null;
  marketContext: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
};

export type PublishCheck = {
  ok: boolean;
  /** Human-readable reasons the page cannot be published. */
  reasons: string[];
  /** Per-requirement detail, so the admin UI can show progress rather than a wall. */
  checks: { key: string; label: string; passed: boolean; detail?: string }[];
};

function industriesCount(value: unknown): number {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v.trim()).length;
  return 0;
}

export function canPublish(
  page: PublishCandidate,
  siblings: readonly SiblingContent[] = [],
): PublishCheck {
  const checks: PublishCheck["checks"] = [];
  const reasons: string[] = [];

  const add = (key: string, label: string, passed: boolean, detail?: string) => {
    checks.push({ key, label, passed, ...(detail ? { detail } : {}) });
    if (!passed) reasons.push(detail ? `${label} — ${detail}` : label);
  };

  // ── Substance ──────────────────────────────────────────────────────────
  const introWords = wordCount(page.localIntro ?? "");
  add(
    "localIntro",
    "Local introduction",
    introWords >= PUBLISH_THRESHOLDS.localIntroWords,
    `${introWords} of ${PUBLISH_THRESHOLDS.localIntroWords} words`,
  );

  const contextWords = wordCount(page.marketContext ?? "");
  add(
    "marketContext",
    "Local market context",
    contextWords >= PUBLISH_THRESHOLDS.marketContextWords,
    `${contextWords} of ${PUBLISH_THRESHOLDS.marketContextWords} words`,
  );

  const industries = industriesCount(page.industries);
  add(
    "industries",
    "Local industries",
    industries >= PUBLISH_THRESHOLDS.industries,
    `${industries} of ${PUBLISH_THRESHOLDS.industries}`,
  );

  add(
    "faqs",
    "Local FAQs",
    page.faqCount >= PUBLISH_THRESHOLDS.faqs,
    `${page.faqCount} of ${PUBLISH_THRESHOLDS.faqs}`,
  );

  add(
    "localProof",
    "Local proof",
    page.localProofCount >= PUBLISH_THRESHOLDS.localProof,
    page.localProofCount === 0 ? "no case study or testimonial for this city or service" : undefined,
  );

  add("positioning", "Positioning statement", Boolean(page.positioning?.trim()));
  add("ctaHeading", "CTA heading", Boolean(page.ctaHeading?.trim()));
  add("ctaBody", "CTA body", Boolean(page.ctaBody?.trim()));

  // ── Metadata ───────────────────────────────────────────────────────────
  const metaTitle = page.seo?.metaTitle?.trim() ?? "";
  const metaDescription = page.seo?.metaDescription?.trim() ?? "";
  add("metaTitle", "Meta title", metaTitle.length > 0);
  add(
    "metaDescription",
    "Meta description",
    metaDescription.length >= PUBLISH_THRESHOLDS.metaDescriptionChars,
    `${metaDescription.length} of ${PUBLISH_THRESHOLDS.metaDescriptionChars} characters`,
  );

  // ── Uniqueness against siblings for the same service ───────────────────
  // This is the check that actually blocks templated content: word counts
  // alone are satisfied by a find-and-replace on another city's page.
  const tokens = page.localTokens;
  let duplicateOf: string | null = null;
  let worstScore = 0;

  for (const sibling of siblings) {
    const introScore = page.localIntro && sibling.localIntro
      ? similarity(page.localIntro, sibling.localIntro, [...tokens, sibling.cityName])
      : 0;
    const contextScore = page.marketContext && sibling.marketContext
      ? similarity(page.marketContext, sibling.marketContext, [...tokens, sibling.cityName])
      : 0;

    const score = Math.max(introScore, contextScore);
    if (score > worstScore) {
      worstScore = score;
      if (
        (page.localIntro &&
          sibling.localIntro &&
          isNearDuplicate(page.localIntro, sibling.localIntro, [...tokens, sibling.cityName])) ||
        (page.marketContext &&
          sibling.marketContext &&
          isNearDuplicate(page.marketContext, sibling.marketContext, [...tokens, sibling.cityName]))
      ) {
        duplicateOf = sibling.cityName;
      }
    }
  }

  add(
    "unique",
    "Unique local content",
    duplicateOf === null,
    duplicateOf
      ? `too similar to the ${duplicateOf} page (${Math.round(worstScore * 100)}% match with place names removed)`
      : undefined,
  );

  // Meta title and description must not repeat another page's either.
  const metaClash = siblings.find(
    (s) =>
      (metaTitle && s.metaTitle?.trim() === metaTitle) ||
      (metaDescription && s.metaDescription?.trim() === metaDescription),
  );
  add(
    "uniqueMeta",
    "Unique metadata",
    !metaClash,
    metaClash ? `identical to the ${metaClash.cityName} page` : undefined,
  );

  return { ok: reasons.length === 0, reasons, checks };
}
