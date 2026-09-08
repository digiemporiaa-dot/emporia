import { z } from "zod";

/**
 * Package CMS validation.
 *
 * Money arrives from a form as a string and stays a string all the way to
 * Prisma's Decimal column — it is never parsed into a JS number, which would
 * reintroduce float error into a price (CLAUDE.md 2 rule 1).
 */

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 45000 or 45000.00");

const rateString = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, "Enter a percentage like 18 or 18.5");

export const packageFeatureSchema = z.object({
  label: z.string().trim().min(2).max(160),
  detail: z.string().trim().max(300).nullable().optional(),
  isIncluded: z.boolean().default(true),
});

export const packageSchema = z.object({
  name: z.string().trim().min(2, "Enter a package name.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only."),
  tagline: z.string().trim().max(300).nullable().optional(),
  serviceId: z.string().trim().max(40).nullable().optional(),
  price: moneyString,
  currency: z.enum(["INR", "USD", "EUR", "GBP", "AED"]).default("INR"),
  billingType: z.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL", "RETAINER"]).default("MONTHLY"),
  taxRate: rateString.default("0"),
  isRecommended: z.boolean().default(false),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  order: z.coerce.number().int().min(0).max(9999).default(0),
  // SEO lives on the shared `Seo` relation, edited by the SEO panel.
  features: z.array(packageFeatureSchema).max(40).default([]),
});

export type PackageInput = z.infer<typeof packageSchema>;
