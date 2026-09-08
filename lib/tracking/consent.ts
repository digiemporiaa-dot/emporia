import type { ConsentMode } from "@/lib/validation/tracking";

/**
 * Consent resolution.
 *
 * Pure and free of both React and the database, so the rule that decides
 * whether a pixel may fire is unit tested directly rather than inferred from a
 * rendered page.
 *
 * Three modes, and the difference between them is entirely about what happens
 * *before* a visitor has answered:
 *
 *   OPT_IN    nothing non-essential runs until they say yes. The strict
 *             reading of GDPR-style regimes.
 *   OPT_OUT   analytics and marketing run until they say no.
 *   IMPLIED   the same as opt-out at runtime; the banner informs rather than
 *             asks, and is dismissed rather than answered.
 *
 * Necessary is not represented as a flag because nothing here is gated on it —
 * it exists in the UI to tell a visitor the truth about what always runs.
 */

export const CONSENT_COOKIE = "emporia_consent";

/** Six months. Long enough not to nag, short enough to be a fresh decision. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

export type ConsentChoice = {
  /** The settings version the visitor answered. */
  v: number;
  analytics: boolean;
  marketing: boolean;
  /** ISO timestamp of the decision. */
  at: string;
};

export type ResolvedConsent = {
  analytics: boolean;
  marketing: boolean;
  /** Whether to show the banner. */
  needsDecision: boolean;
};

/**
 * Parse the stored cookie.
 *
 * Anything malformed is treated as absent. A visitor with a corrupt cookie is
 * asked again, which is the safe direction — the alternative is guessing that
 * they consented.
 */
export function parseConsent(raw: string | undefined | null): ConsentChoice | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value["v"] !== "number") return null;
    if (typeof value["analytics"] !== "boolean" || typeof value["marketing"] !== "boolean") {
      return null;
    }
    return {
      v: value["v"],
      analytics: value["analytics"],
      marketing: value["marketing"],
      at: typeof value["at"] === "string" ? value["at"] : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * What may run right now.
 *
 * A stored choice from an older settings version does not count: if the
 * categories or the wording changed, the visitor agreed to something else.
 */
export function resolveConsent(
  mode: ConsentMode,
  version: number,
  stored: ConsentChoice | null,
): ResolvedConsent {
  const current = stored && stored.v === version ? stored : null;

  if (current) {
    return { analytics: current.analytics, marketing: current.marketing, needsDecision: false };
  }

  if (mode === "OPT_IN") {
    // Nothing until they say so.
    return { analytics: false, marketing: false, needsDecision: true };
  }

  // IMPLIED and OPT_OUT both run until told otherwise; they differ only in
  // whether the banner asks a question or states a fact.
  return { analytics: true, marketing: true, needsDecision: true };
}

/** The decision recorded when a visitor accepts everything. */
export function acceptAll(version: number): ConsentChoice {
  return { v: version, analytics: true, marketing: true, at: new Date().toISOString() };
}

/** The decision recorded when a visitor rejects everything non-essential. */
export function rejectAll(version: number): ConsentChoice {
  return { v: version, analytics: false, marketing: false, at: new Date().toISOString() };
}

export function choose(version: number, analytics: boolean, marketing: boolean): ConsentChoice {
  return { v: version, analytics, marketing, at: new Date().toISOString() };
}

/**
 * Which consent category each provider belongs to.
 *
 * Named here rather than inline at each loader so the mapping is one list that
 * can be read, reviewed and tested — the question "what does rejecting
 * marketing actually stop?" has one answer.
 */
export const PROVIDER_CATEGORY = {
  gtm: "necessary",
  ga4: "analytics",
  clarity: "analytics",
  hotjar: "analytics",
  googleAds: "marketing",
  metaPixel: "marketing",
  pinterest: "marketing",
  tiktok: "marketing",
  snapchat: "marketing",
} as const;

export type TrackedProvider = keyof typeof PROVIDER_CATEGORY;

export function mayLoad(provider: TrackedProvider, consent: ResolvedConsent): boolean {
  const category = PROVIDER_CATEGORY[provider];
  if (category === "necessary") return true;
  if (category === "analytics") return consent.analytics;
  return consent.marketing;
}
