import { z } from "zod";

/** Shared validation for the City and ServiceCityPage CMS. */

// The schema itself now lives in lib/validation/slug.ts, shared with the page
// CMS. Re-exported here so this module's existing importers are unaffected.
import { slugSchema } from "@/lib/validation/slug";

export { slugSchema };

export const citySchema = z.object({
  name: z.string().trim().min(2, "Enter the city name.").max(80),
  slug: slugSchema,
  state: z.string().trim().min(2, "Enter the state.").max(80),
  country: z.string().trim().min(2).max(80).default("India"),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  population: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(9999).default(0),
});

export type CityInput = z.infer<typeof citySchema>;

export const serviceCityPageSchema = z.object({
  serviceId: z.string().min(1, "Choose a service."),
  cityId: z.string().min(1, "Choose a city."),
  localIntro: z.string().trim().max(8000).nullable().optional(),
  marketContext: z.string().trim().max(8000).nullable().optional(),
  /** Free-form list; canPublish requires a minimum count. */
  industries: z.array(z.string().trim().min(1).max(120)).max(24).default([]),
  positioning: z.string().trim().max(2000).nullable().optional(),
  ctaHeading: z.string().trim().max(200).nullable().optional(),
  ctaBody: z.string().trim().max(2000).nullable().optional(),
  // SEO is not here. It lives on the shared `Seo` relation and is edited by the
  // SEO panel on the same screen, which offers the whole record rather than
  // three of its fields. Two forms writing one column silently revert each
  // other (CLAUDE.md 4).
});

export type ServiceCityPageInput = z.infer<typeof serviceCityPageSchema>;

export const localFaqSchema = z.object({
  serviceCityPageId: z.string().min(1),
  question: z.string().trim().min(8, "Write the question out in full.").max(300),
  answer: z.string().trim().min(20, "An answer needs more substance than that.").max(4000),
  order: z.coerce.number().int().min(0).max(999).default(0),
});

export type LocalFaqInput = z.infer<typeof localFaqSchema>;
