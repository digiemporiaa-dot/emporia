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
  /** Chrome UX Report API key, for Core Web Vitals. Blank keeps what is stored. */
  cruxApiKey: z
    .string()
    .trim()
    .max(200)
    .default("")
    .refine((value) => value === "" || /^[\w-]{20,200}$/.test(value), "That does not look like a Google API key."),
  removeCruxKey: z.boolean().default(false),
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

/** Tracking keywords: one per line, or comma separated. */
export const keywordAddSchema = z.object({
  propertyId: id,
  keywords: z.string().max(20_000, "Paste at most 20,000 characters at once."),
  tags: z.string().max(500).default(""),
  source: z.enum(["MANUAL", "SEARCH_CONSOLE"]).default("MANUAL"),
});

/** Untracking keywords. */
export const keywordRemoveSchema = z.object({
  propertyId: id,
  keywordIds: z.array(id).min(1, "Choose at least one keyword.").max(500),
});

/** Replacing one keyword's tags. */
export const keywordTagsSchema = z.object({
  propertyId: id,
  keywordId: id,
  tags: z.string().max(500).default(""),
});

/** Command Center actions. */
export const opportunityIdSchema = z.object({ opportunityId: id });
export const opportunityDismissSchema = z.object({ opportunityId: id, reason: z.string().trim().max(500).default("") });
export const opportunityAssignSchema = z.object({ opportunityId: id, assigneeId: optionalId });
export const opportunityTaskSchema = z.object({
  opportunityId: id,
  projectId: id,
  assigneeId: optionalId,
  dueAt: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(`${value}T00:00:00Z`) : null))
    .refine((value) => value === null || !Number.isNaN(value.getTime()), "Enter a valid date."),
});
export const detectNowSchema = z.object({ propertyId: id });

// Local SEO (Phase 8)
export const localServiceSchema = z.object({
  propertyId: id,
  id: optionalId,
  name: z.string().trim().min(1, "Enter a service name.").max(100, "Up to 100 characters."),
  terms: z.string().max(1_000, "Up to 1,000 characters.").default(""),
});
export const localServiceRemoveSchema = z.object({ propertyId: id, id });
export const localCitiesAddSchema = z.object({ propertyId: id, cityIds: z.array(id).min(1, "Choose at least one city.").max(200, "Up to 200 cities at a time.") });
export const localCityAliasesSchema = z.object({ propertyId: id, localCityId: id, aliases: z.string().max(500, "Up to 500 characters.").default("") });
export const localCityRemoveSchema = z.object({ propertyId: id, localCityId: id });
export const localPageSchema = z.object({
  propertyId: id,
  localServiceId: id,
  cityId: id,
  url: z
    .string()
    .trim()
    .max(2_000, "Up to 2,000 characters.")
    .optional()
    .transform((value) => (value ? value : null)),
});
export const localPropertySchema = z.object({ propertyId: id });

// Google Analytics 4 (Phase 9)
export const ga4PropertyChoiceSchema = z.object({
  propertyId: id,
  ga4Property: z.string().trim().regex(/^properties\/\d+$/, "Choose a GA4 property."),
});

// Phase 11 — monthly SEO reports.
export const seoReportGenerateSchema = z.object({ propertyId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.") });
export const seoReportNotesSchema = z.object({ reportId: id, notes: z.string().max(5_000, "Up to 5,000 characters.").default("") });
export const seoReportPublishSchema = z.object({ reportId: id, published: z.enum(["true", "false"]).transform((value) => value === "true") });
