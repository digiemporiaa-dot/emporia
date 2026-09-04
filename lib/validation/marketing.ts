import { z } from "zod";
import { RANGE_PRESETS } from "@/lib/analytics/range";

/** Campaign, metric and reporting input validation. Money is a string. */

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 45000 or 45000.00");

const id = z.string().trim().min(1).max(40);
const optionalId = z.string().trim().max(40).nullable().optional();

export const campaignSchema = z.object({
  name: z.string().trim().min(2, "Name the campaign.").max(160),
  clientId: optionalId,
  platform: z.enum([
    "GOOGLE_ADS",
    "META_ADS",
    "LINKEDIN_ADS",
    "SEO",
    "EMAIL",
    "SOCIAL_ORGANIC",
    "OTHER",
  ]),
  objective: z.string().trim().max(200).nullable().optional(),
  budget: moneyString.default("0"),
  currency: z.enum(["INR", "USD", "EUR", "GBP", "AED"]).default("INR"),
  ownerId: id,
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]).default("DRAFT"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional(),
});

export type CampaignInput = z.infer<typeof campaignSchema>;

/**
 * One day of campaign performance.
 *
 * Counts are integers and spend is a money string. Revenue is optional because
 * a campaign that cannot attribute revenue should record nothing there rather
 * than a zero that reads like a measurement (CLAUDE.md 2 rule 5).
 */
export const campaignMetricSchema = z.object({
  campaignId: id,
  date: z.coerce.date(),
  impressions: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  clicks: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  conversions: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  spend: moneyString.default("0"),
  revenue: moneyString.nullable().optional(),
});

export type CampaignMetricInput = z.infer<typeof campaignMetricSchema>;

/** A pasted or uploaded CSV of daily rows. Parsed and validated server-side. */
export const metricImportSchema = z.object({
  campaignId: id,
  csv: z.string().trim().min(1, "Paste at least one row.").max(200_000),
});

export const analyticsParamsSchema = z.object({
  range: z.enum(RANGE_PRESETS).default("30d"),
});

export type AnalyticsParams = z.infer<typeof analyticsParamsSchema>;

export const campaignListParamsSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]).optional(),
  platform: z
    .enum(["GOOGLE_ADS", "META_ADS", "LINKEDIN_ADS", "SEO", "EMAIL", "SOCIAL_ORGANIC", "OTHER"])
    .optional(),
  clientId: z.string().trim().max(40).optional(),
});

export type CampaignListParams = z.infer<typeof campaignListParamsSchema>;
