import { Decimal } from "decimal.js";

/**
 * Lead scoring.
 *
 * Configurable rather than hardcoded (docs/BUILD-PLAN.md, Phase 7): the weights
 * live in SiteSetting so sales can retune them without a deploy, and the
 * defaults below are the starting point rather than the authority.
 *
 * Pure and synchronous — the caller supplies the facts. That keeps scoring
 * testable and means the same function scores a website form, a popup and a
 * manually entered lead identically (CLAUDE.md 4: one implementation).
 */

export type ScoreBand = "HOT" | "WARM" | "COLD";

export type ScoringConfig = {
  /** Budget bands, highest first. Amounts are strings — budget is money. */
  budget: { min: string; points: number }[];
  /** Points by lead source slug. */
  source: Record<string, number>;
  /** Points by service slug. */
  service: Record<string, number>;
  /** Points by city slug. */
  city: Record<string, number>;
  engagement: {
    hasPhone: number;
    hasCompany: number;
    /** Message length bands, longest first. */
    messageLength: { min: number; points: number }[];
    /** A named package implies a researched enquiry. */
    hasPackage: number;
  };
  /** Score at or above which a lead is HOT / WARM. */
  bands: { hot: number; warm: number };
  /** Scores are clamped to this. */
  max: number;
};

export const DEFAULT_SCORING: ScoringConfig = {
  budget: [
    { min: "500000", points: 35 },
    { min: "250000", points: 28 },
    { min: "100000", points: 20 },
    { min: "50000", points: 12 },
    { min: "1", points: 5 },
  ],
  source: {
    referral: 20,
    "paid-ads": 14,
    "website-form": 10,
    popup: 8,
    phone: 12,
    email: 8,
    social: 6,
    import: 0,
    other: 2,
  },
  service: {},
  city: {},
  engagement: {
    hasPhone: 8,
    hasCompany: 6,
    messageLength: [
      { min: 400, points: 12 },
      { min: 150, points: 8 },
      { min: 40, points: 4 },
    ],
    hasPackage: 10,
  },
  bands: { hot: 60, warm: 30 },
  max: 100,
};

export type ScoreInput = {
  budget?: string | null;
  sourceSlug?: string | null;
  serviceSlug?: string | null;
  citySlug?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  packageId?: string | null;
};

export type ScoreFactor = { label: string; points: number };

export type ScoreResult = {
  score: number;
  band: ScoreBand;
  /** What contributed, so the admin can explain a score rather than guess. */
  factors: ScoreFactor[];
};

function bandPoints(bands: { min: string; points: number }[], value: Decimal): number {
  // Highest matching band wins; the list is sorted defensively rather than
  // trusting the stored order, since it is admin-editable.
  const sorted = [...bands].sort((a, b) => new Decimal(b.min).comparedTo(new Decimal(a.min)));
  for (const band of sorted) {
    if (value.greaterThanOrEqualTo(new Decimal(band.min))) return band.points;
  }
  return 0;
}

export function scoreLead(input: ScoreInput, config: ScoringConfig = DEFAULT_SCORING): ScoreResult {
  const factors: ScoreFactor[] = [];

  // Budget is money and is compared as Decimal, never parsed to a float.
  if (input.budget) {
    try {
      const value = new Decimal(input.budget);
      const points = bandPoints(config.budget, value);
      if (points > 0) factors.push({ label: "Budget", points });
    } catch {
      // An unparseable budget scores nothing rather than throwing.
    }
  }

  if (input.sourceSlug) {
    const points = config.source[input.sourceSlug];
    if (typeof points === "number" && points !== 0) {
      factors.push({ label: "Source", points });
    }
  }

  if (input.serviceSlug) {
    const points = config.service[input.serviceSlug];
    if (typeof points === "number" && points !== 0) {
      factors.push({ label: "Service", points });
    }
  }

  if (input.citySlug) {
    const points = config.city[input.citySlug];
    if (typeof points === "number" && points !== 0) {
      factors.push({ label: "City", points });
    }
  }

  if (input.phone?.trim()) {
    factors.push({ label: "Phone provided", points: config.engagement.hasPhone });
  }

  if (input.company?.trim()) {
    factors.push({ label: "Company provided", points: config.engagement.hasCompany });
  }

  if (input.packageId) {
    factors.push({ label: "Named a package", points: config.engagement.hasPackage });
  }

  const messageLength = input.message?.trim().length ?? 0;
  if (messageLength > 0) {
    const sorted = [...config.engagement.messageLength].sort((a, b) => b.min - a.min);
    const matched = sorted.find((band) => messageLength >= band.min);
    if (matched && matched.points > 0) {
      factors.push({ label: "Message detail", points: matched.points });
    }
  }

  const raw = factors.reduce((total, factor) => total + factor.points, 0);
  const score = Math.max(0, Math.min(config.max, raw));

  const band: ScoreBand =
    score >= config.bands.hot ? "HOT" : score >= config.bands.warm ? "WARM" : "COLD";

  return { score, band, factors };
}

/** Merge a stored partial config over the defaults, field by field. */
export function mergeScoringConfig(stored: unknown): ScoringConfig {
  if (typeof stored !== "object" || stored === null) return DEFAULT_SCORING;
  const partial = stored as Partial<ScoringConfig>;

  return {
    budget: Array.isArray(partial.budget) && partial.budget.length > 0
      ? partial.budget
      : DEFAULT_SCORING.budget,
    source: { ...DEFAULT_SCORING.source, ...(partial.source ?? {}) },
    service: { ...DEFAULT_SCORING.service, ...(partial.service ?? {}) },
    city: { ...DEFAULT_SCORING.city, ...(partial.city ?? {}) },
    engagement: { ...DEFAULT_SCORING.engagement, ...(partial.engagement ?? {}) },
    bands: { ...DEFAULT_SCORING.bands, ...(partial.bands ?? {}) },
    max: typeof partial.max === "number" ? partial.max : DEFAULT_SCORING.max,
  };
}

export function bandOf(score: number, config: ScoringConfig = DEFAULT_SCORING): ScoreBand {
  return score >= config.bands.hot ? "HOT" : score >= config.bands.warm ? "WARM" : "COLD";
}
