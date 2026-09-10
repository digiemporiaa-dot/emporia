import { z } from "zod";
import { CONTENT_TYPES } from "@/lib/cms/registry";

/** The content library: search parameters and bulk requests. */

export const contentSearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.enum(CONTENT_TYPES).optional(),
  state: z.enum(["PUBLISHED", "DRAFT", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(10).max(100).default(25),
});

export type ContentSearchInput = z.infer<typeof contentSearchSchema>;

/**
 * A bulk request.
 *
 * Each target carries its own type: a selection spans content types, and
 * trusting one type for the whole batch would let a page id be acted on as
 * though it were a city.
 */
export const bulkRequestSchema = z.object({
  action: z.enum(["publish", "unpublish", "archive"]),
  targets: z
    .array(z.object({ type: z.enum(CONTENT_TYPES), id: z.string().min(1).max(40) }))
    .min(1, "Select something first.")
    .max(100, "One hundred at a time."),
});

export type BulkRequestInput = z.infer<typeof bulkRequestSchema>;
