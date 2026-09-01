import { z } from "zod";

/**
 * Popup submission input.
 *
 * Only the submitter's own details. There are deliberately no attribution
 * fields — no UTM, no referrer, no service or city — because those are derived
 * server-side and accepting them here would let a caller forge the source of
 * their enquiry.
 */
export const popupLeadSchema = z
  .object({
    popupId: z.string().trim().min(1).max(40),
    path: z.string().trim().min(1).max(2048),
    name: z.string().trim().min(2, "Please enter your name.").max(120),
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
    /** Honeypot: must stay empty. */
    website: z.string().max(0).optional().or(z.literal("")),
  })
  .strict();

export type PopupLeadInput = z.infer<typeof popupLeadSchema>;
