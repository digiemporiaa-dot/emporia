import { z } from "zod";

/** Email settings input validation. */

const TEMPLATE_KEYS = [
  "NEW_LEAD",
  "LEAD_ASSIGNED",
  "FOLLOW_UP",
  "STAFF_INVITATION",
  "PASSWORD_RESET",
  "PROPOSAL_SENT",
  "PROPOSAL_ACCEPTED",
  "INVOICE_SENT",
  "PAYMENT_RECEIVED",
  "PAYMENT_REMINDER",
  "CLIENT_NOTIFICATION",
] as const;

export const templateKeySchema = z.enum(TEMPLATE_KEYS);

export const templateUpdateSchema = z.object({
  key: templateKeySchema,
  name: z.string().trim().min(2, "Name the template.").max(120),
  subject: z.string().trim().min(2, "Give it a subject.").max(300),
  html: z.string().trim().min(20, "The message body is too short.").max(50_000),
  text: z.string().trim().max(20_000).nullable().optional(),
  isActive: z.boolean().default(true),
});

export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;

export const testSendSchema = z.object({
  key: templateKeySchema,
  to: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
});

export const emailLogParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(10).max(100).default(50),
  status: z.enum(["QUEUED", "SENT", "FAILED", "BOUNCED"]).optional(),
  templateKey: templateKeySchema.optional(),
  search: z.string().trim().max(200).optional(),
});

export type EmailLogParamsInput = z.infer<typeof emailLogParamsSchema>;
