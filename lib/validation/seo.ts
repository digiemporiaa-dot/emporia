import { z } from "zod";

/**
 * SEO panel validation.
 *
 * Every field is optional: an empty Seo record is valid and means "derive
 * everything", which is the correct default for most pages. The builder's job
 * is to let an editor override, not to demand they fill in fifteen boxes.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

/**
 * A canonical override is either a site path or a full URL. Anything else —
 * `growth-marketing`, say — silently produces a broken canonical, which is
 * worse than no override at all.
 */
export const canonicalSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || value.startsWith("/") || /^https?:\/\//.test(value),
    "Enter a path starting with / or a full URL.",
  );

export const schemaTypeSchema = z.enum([
  "NONE",
  "ORGANIZATION",
  "WEBSITE",
  "SERVICE",
  "LOCAL_BUSINESS",
  "ARTICLE",
  "FAQ_PAGE",
]);

export const pageSeoSchema = z.object({
  metaTitle: optional(200),
  metaDescription: optional(500),
  canonical: canonicalSchema,

  ogTitle: optional(200),
  ogDescription: optional(500),
  ogImageId: z
    .string()
    .cuid()
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((value) => value ?? null),
  ogImageAlt: optional(300),

  twitterTitle: optional(200),
  twitterDescription: optional(500),
  twitterImageId: z
    .string()
    .cuid()
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((value) => value ?? null),

  robotsIndex: z.boolean().default(true),
  robotsFollow: z.boolean().default(true),
  schemaType: schemaTypeSchema.default("NONE"),
});

export type PageSeoInput = z.infer<typeof pageSeoSchema>;
