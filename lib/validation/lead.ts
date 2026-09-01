import { z } from "zod";

/**
 * Public lead capture input.
 *
 * Shared between the client form and the server action, so the two cannot
 * disagree about what is valid (CLAUDE.md 5).
 *
 * Attribution fields are deliberately absent: UTM data, referrer, landing path
 * and device are read server-side from cookies and headers, never accepted from
 * the request body, so a caller cannot forge their own attribution
 * (docs/ARCHITECTURE.md 14.2).
 */
export const contactFormSchema = z
  .object({
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
    serviceId: z.string().trim().max(40).optional().or(z.literal("")),
    message: z
      .string()
      .trim()
      .min(10, "Tell us a little about what you need.")
      .max(4000, "That message is too long."),
    // Honeypot. Must stay empty; bots fill it in.
    website: z.string().max(0).optional().or(z.literal("")),
  })
  .strict();

export type ContactFormInput = z.infer<typeof contactFormSchema>;
