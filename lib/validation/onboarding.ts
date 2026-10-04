import { z } from "zod";
import { isCountryCode } from "@/lib/geo/countries";
import { parseSiteInput, UnsafeTargetError } from "@/lib/seo-intel/net/site-input";

/** Client onboarding input validation, shared by the portal forms and the server. */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .refine((value) => !/[\r\n]/.test(value), "Use a single line.")
    .transform((value) => value || null);

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null)
  .refine((value) => value === null || /^https?:\/\/[^\s]+$/i.test(value), "Enter a full address starting with https://.");

export const WEBSITE_PLATFORMS = ["WORDPRESS", "SHOPIFY", "WIX", "SQUARESPACE", "WEBFLOW", "CUSTOM", "OTHER"] as const;
export const WEBSITE_PLATFORM_LABEL: Record<(typeof WEBSITE_PLATFORMS)[number], string> = {
  WORDPRESS: "WordPress",
  SHOPIFY: "Shopify",
  WIX: "Wix",
  SQUARESPACE: "Squarespace",
  WEBFLOW: "Webflow",
  CUSTOM: "Custom-built",
  OTHER: "Something else",
};

export const SOCIAL_PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X", "GOOGLE_BUSINESS_PROFILE"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const SOCIAL_PLATFORM_LABEL: Record<SocialPlatform, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  X: "X",
  GOOGLE_BUSINESS_PROFILE: "Google Business Profile",
};

export const companyStepSchema = z.object({
  legalName: text(160),
  industry: text(120),
  /** Reduced to a host by the same rules as an SEO property. */
  website: z
    .string()
    .trim()
    .max(300)
    .transform((value, ctx) => {
      if (!value) return null;
      try {
        const site = parseSiteInput(value);
        return `${site.protocol === "HTTP" ? "http" : "https"}://${site.domain}`;
      } catch (error) {
        ctx.addIssue({ code: "custom", message: error instanceof UnsafeTargetError ? error.message : "That is not a valid website." });
        return z.NEVER;
      }
    }),
  taxId: text(40),
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(100),
  region: text(100),
  postalCode: text(20),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value || null)
    .refine((value) => value === null || isCountryCode(value), "Choose a country from the list."),
});
export type CompanyStepInput = z.infer<typeof companyStepSchema>;

const HEX = /^#[0-9a-f]{6}$/i;
export const brandColorsSchema = z.object({
  colors: z
    .string()
    .max(500)
    .transform((value) => [...new Set(value.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean).map((c) => (c.startsWith("#") ? c : `#${c}`).toUpperCase()))])
    .refine((list) => list.every((c) => HEX.test(c)), "Use six-digit hex colours, like #DF1F38.")
    .refine((list) => list.length <= 12, "Up to 12 colours."),
});

export const websiteStepSchema = z.object({
  platform: z.enum(WEBSITE_PLATFORMS, { message: "Choose your website's platform." }),
  loginUrl: httpUrl,
  notes: z.string().trim().max(1000).transform((value) => value || null),
  confirmed: z.boolean(),
});
export type WebsiteStepInput = z.infer<typeof websiteStepSchema>;

export const analyticsStepSchema = z.object({
  /** GA4 property IDs are numeric; "properties/123" is accepted and reduced. */
  propertyId: z
    .string()
    .trim()
    .transform((value) => value.replace(/^properties\//, ""))
    .refine((value) => /^\d{6,12}$/.test(value), "A GA4 property ID is a number, found in Admin → Property settings."),
  confirmed: z.boolean(),
});

export const socialStepSchema = z.object({
  profiles: z
    .array(
      z.object({
        platform: z.enum(SOCIAL_PLATFORMS),
        handle: z.string().trim().min(1, "Enter the handle or link.").max(200).refine((value) => !/[\r\n<>]/.test(value), "That handle has characters we cannot use."),
      }),
    )
    .max(12),
});
export type SocialProfileEntry = z.infer<typeof socialStepSchema>["profiles"][number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const span = z
  .object({ open: z.string().regex(TIME, "Use HH:MM."), close: z.string().regex(TIME, "Use HH:MM.") })
  .refine((value) => value.open < value.close, "Closing time must be after opening time.");
export const hoursSchema = z.object(Object.fromEntries(WEEKDAYS.map((day) => [day, z.array(span).max(3)])) as Record<(typeof WEEKDAYS)[number], z.ZodArray<typeof span>>);
export type OpeningHours = z.infer<typeof hoursSchema>;

export const businessStepSchema = z.object({
  publicPhone: z
    .string()
    .trim()
    .max(32)
    .transform((value) => value || null)
    .refine((value) => value === null || /^[+\d][\d\s()-]{6,}$/.test(value), "Enter a valid phone number."),
  publicEmail: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null)
    .refine((value) => value === null || z.string().email().safeParse(value).success, "Enter a valid email address."),
  hours: hoursSchema,
  serviceAreas: z
    .string()
    .max(2000)
    .transform((value) => [...new Set(value.split(/[\n,]/).map((area) => area.trim()).filter(Boolean))])
    .refine((list) => list.length <= 50 && list.every((area) => area.length <= 100), "Up to 50 areas, each under 100 characters."),
  googleBusinessUrl: httpUrl,
});
export type BusinessStepInput = z.infer<typeof businessStepSchema>;

/** Portal brand uploads: images and PDFs only — no SVG from outside the agency. */
export const BRAND_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const brandPresignSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(BRAND_UPLOAD_TYPES, { message: "Upload a JPEG, PNG, WebP or PDF." }),
  size: z.coerce.number().int().positive().max(20 * 1024 * 1024, "That file is too large."),
  kind: z.enum(["LOGO", "GUIDELINES", "OTHER"]),
});
export const brandConfirmSchema = z.object({ uploadId: z.string().trim().min(32).max(2048), kind: z.enum(["LOGO", "GUIDELINES", "OTHER"]) });

export const notApplicableSchema = z.object({
  clientId: z.string().trim().min(1).max(40),
  step: z.enum(["COMPANY", "BRAND", "WEBSITE", "ANALYTICS", "SEARCH_CONSOLE", "SOCIAL", "BUSINESS"]),
  notApplicable: z.boolean(),
});

export const accessEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null)
    .refine((value) => value === null || z.string().email().safeParse(value).success, "Enter a valid email address."),
});
