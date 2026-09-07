import { z } from "zod";
import { isReservedSlug } from "@/lib/utils/slug";

/**
 * Shared slug validation.
 *
 * Previously inlined in lib/validation/local.ts. Lifted here when the page CMS
 * became a second consumer, so the pattern is defined once (CLAUDE.md 4).
 */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "A slug needs at least two characters.")
  .max(80)
  .regex(slugPattern, "Use lowercase letters, numbers and hyphens only.");

/**
 * A slug for a top-level CMS page, which additionally may not shadow a real
 * route. See RESERVED_SLUGS for why.
 */
export const pageSlugSchema = slugSchema.refine(
  (value) => !isReservedSlug(value),
  "That address is used by a built-in page. Choose another slug.",
);
