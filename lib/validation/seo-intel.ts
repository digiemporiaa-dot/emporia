import { z } from "zod";
import { isCountryCode } from "@/lib/geo/countries";
import { parseSiteInput, UnsafeTargetError } from "@/lib/seo-intel/net/site-input";

/** SEO Intelligence input validation. Shared by the forms and the server actions. */

/** The agency's own website, as a choice in the "Whose website" select. */
export const INTERNAL_OWNER = "INTERNAL";

const id = z.string().trim().min(1).max(40);

const optionalId = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((value) => (value ? value : null));

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validLanguage(value: string): boolean {
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/** The fields both create and edit take. */
const propertyFields = {
  /** What was typed into "Website"; reduced to a host by `parseSiteInput`. */
  website: z
    .string()
    .trim()
    .max(300, "That address is too long.")
    .transform((value, ctx) => {
      try {
        return parseSiteInput(value);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: error instanceof UnsafeTargetError ? error.message : "That is not a valid domain." });
        return z.NEVER;
      }
    }),
  /** Used when the website was typed without a scheme. */
  protocol: z.enum(["HTTPS", "HTTP"]).default("HTTPS"),
  displayName: z.string().trim().min(2, "Give the property a name.").max(120, "That name is too long."),
  projectId: optionalId,
  defaultCountry: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || isCountryCode(value), "Choose a country from the list."),
  defaultLanguage: z
    .string()
    .trim()
    .min(2, "Enter a language code, such as en or en-IN.")
    .max(35)
    .refine(validLanguage, "Enter a language code, such as en, en-IN or ar."),
  timezone: z.string().trim().min(1, "Choose a time zone.").max(64).refine(validTimeZone, "Choose a time zone from the list."),
  isActive: z.boolean().default(true),
  crawlMaxPages: z.coerce
    .number({ message: "Enter a number of pages." })
    .int("Enter a whole number of pages.")
    .min(10, "Crawl at least 10 pages.")
    .max(5_000, "At most 5,000 pages per crawl.")
    .default(500),
  crawlFrequency: z.enum(["WEEKLY", "MANUAL"], { message: "Choose how often to crawl." }).default("WEEKLY"),
};

export const seoPropertyCreateSchema = z.object({
  /** A client id, or `INTERNAL` for the agency's own website. */
  owner: z.union([z.literal(INTERNAL_OWNER), id], { message: "Choose whose website this is." }),
  ...propertyFields,
});

/** The owner is fixed after creation: moving a property would move its history to another client. */
export const seoPropertyUpdateSchema = z.object(propertyFields);

export type SeoPropertyCreateInput = z.infer<typeof seoPropertyCreateSchema>;
export type SeoPropertyUpdateInput = z.infer<typeof seoPropertyUpdateSchema>;

export const seoPropertyListSchema = z.object({
  client: z.string().trim().max(40).optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  q: z.string().trim().max(100).optional(),
});

/**
 * Settings → the agency's Google credentials for SEO. Secrets are write-only:
 * blank keeps what is stored, the `remove…` flags clear it.
 */
export const seoGoogleSettingsSchema = z.object({
  oauthClientId: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null)
    .refine((value) => value === null || /^[\w.-]+\.apps\.googleusercontent\.com$/.test(value), "That is not a Google OAuth client ID (it ends in .apps.googleusercontent.com)."),
  oauthClientSecret: z.string().trim().max(200).default(""),
  removeOAuth: z.boolean().default(false),
  /** The whole service-account key file, pasted. */
  serviceAccountJson: z.string().trim().max(10_000, "That key file is too large.").default(""),
  removeServiceAccount: z.boolean().default(false),
});

export type SeoGoogleSettingsInput = z.infer<typeof seoGoogleSettingsSchema>;

/** Choosing the Search Console site for a property after signing in. */
export const gscSiteChoiceSchema = z.object({
  propertyId: id,
  siteUrl: z.string().trim().min(1).max(400),
});

/** Starting a crawl of one website. */
export const crawlStartSchema = z.object({ propertyId: id });

/** Cancelling a running crawl. */
export const crawlCancelSchema = z.object({ propertyId: id, runId: id });

/** Asking Google about one crawled URL. */
export const urlInspectSchema = z.object({
  propertyId: id,
  url: z.string().trim().url("That is not a web address.").max(2_000),
});
