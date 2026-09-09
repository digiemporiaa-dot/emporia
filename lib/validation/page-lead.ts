import { z } from "zod";

/**
 * A submission from a `leadForm` block on a CMS page.
 *
 * Modelled on the popup submission and deliberately as narrow: the body carries
 * the submitter's own details, the id of the section that rendered the form,
 * and the path it was on. Nothing attributive — no UTM, no campaign, no
 * service — because those are derived server-side from cookies and from the
 * *stored* block, and accepting them here would let a caller forge the source
 * of an enquiry and skew the reporting this platform exists to produce
 * (docs/ARCHITECTURE.md 14.2).
 */
export const pageLeadSchema = z
  .object({
    /** The PageSection that rendered this form. Loaded and re-checked server-side. */
    sectionId: z.string().trim().min(1).max(40),
    path: z.string().trim().min(1).max(2048),

    /**
     * Optional for the newsletter variant, which asks for an email and nothing
     * else. The service applies the per-variant rules, because the variant is
     * on the stored block rather than in this body.
     */
    name: z.string().trim().max(120).optional().or(z.literal("")),
    email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
    phone: z
      .string()
      .trim()
      .max(32)
      .regex(/^[+\d][\d\s()-]{6,}$/, "Enter a valid phone number.")
      .optional()
      .or(z.literal("")),
    company: z.string().trim().max(160).optional().or(z.literal("")),
    message: z.string().trim().max(2000).optional().or(z.literal("")),

    /**
     * Shared conversion id so the pixel copy and the Conversions API copy of
     * this one lead carry the same id and Meta counts it once. It identifies an
     * event, never a person or a record.
     */
    eventId: z
      .string()
      .trim()
      .regex(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        "Not an event id.",
      )
      .optional(),

    /** Honeypot: must stay empty. */
    website: z.string().max(0).optional().or(z.literal("")),
  })
  .strict();

export type PageLeadInput = z.infer<typeof pageLeadSchema>;
