import { z } from "zod";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * A client's brand profile, content pillars and social strategy.
 *
 * Lists arrive as arrays; the forms split what a person types. Every list is
 * normalised here — trimmed, de-duplicated, capped — so the AI prompt and the
 * editor read the same clean values whoever typed them.
 */

const PROVIDERS = [
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "X",
  "GOOGLE_BUSINESS_PROFILE",
] as const satisfies readonly SocialProvider[];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .nullable()
    .or(z.literal(""))
    .transform((value) => (value ? value : null))
    .default(null);

/** A list of short strings: trimmed, blanks dropped, duplicates (any case) removed. */
const list = (item: z.ZodType<string, unknown>, max: number) =>
  z
    .array(item)
    .max(max, `At most ${max}.`)
    .default([])
    .transform((values) => {
      const seen = new Set<string>();
      return values.filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });

/** Hashtags stored bare: `#Festive` and `Festive` are one tag. */
const hashtag = z
  .string()
  .trim()
  .transform((tag) => tag.replace(/^#+/, ""))
  .pipe(z.string().max(60).regex(/^[\p{L}\p{N}_]*$/u, "Hashtags are letters, numbers and underscores."));

export const brandProfileSchema = z.object({
  brandName: optionalText(120),
  tone: optionalText(500),
  industry: optionalText(120),
  targetAudience: optionalText(1_000),
  preferredLanguage: optionalText(60),
  ctaStyle: optionalText(300),
  brandColors: list(
    z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Colours are hex values like #DF1F38."),
    12,
  ),
  hashtags: list(hashtag, 30),
  forbiddenWords: list(z.string().trim().max(60), 100),
  preferredEmojis: list(z.string().trim().max(16), 20),
  postingRules: optionalText(2_000),
});

export type BrandProfileInput = z.infer<typeof brandProfileSchema>;

export const pillarSchema = z.object({
  name: z.string().trim().min(1, "Name the pillar.").max(80),
  description: optionalText(500),
});

export type PillarInput = z.infer<typeof pillarSchema>;

/** Targets a client can agree to. Each maps to a stored number, or says it has none. */
export const KPI_METRICS = [
  "postsPublished",
  "reach",
  "impressions",
  "engagements",
  "followersGained",
  "clicks",
  "videoViews",
] as const;
export type KpiMetric = (typeof KPI_METRICS)[number];

export const KPI_PERIODS = ["MONTH", "QUARTER", "CAMPAIGN"] as const;

export const strategySchema = z
  .object({
    objectives: optionalText(2_000),
    platforms: z
      .array(z.enum(PROVIDERS))
      .max(PROVIDERS.length)
      .default([])
      .transform((values) => [...new Set(values)]),
    /** Planned posts per week, per platform. */
    postingFrequency: z.record(z.string(), z.coerce.number().int().min(0).max(50)).default({}),
    campaignGoals: optionalText(2_000),
    kpiTargets: z
      .array(
        z.object({
          metric: z.enum(KPI_METRICS),
          target: z.coerce.number().min(0).max(1_000_000_000),
          period: z.enum(KPI_PERIODS),
        }),
      )
      .max(12)
      .default([]),
  })
  .transform((value) => ({
    ...value,
    // A frequency for a platform the strategy does not use is noise, and a
    // key that is not a platform is a typo; both are dropped rather than kept.
    postingFrequency: Object.fromEntries(
      Object.entries(value.postingFrequency).filter(
        ([provider, count]) => value.platforms.includes(provider as SocialProvider) && count > 0,
      ),
    ) as Partial<Record<SocialProvider, number>>,
  }));

export type StrategyInput = z.infer<typeof strategySchema>;
