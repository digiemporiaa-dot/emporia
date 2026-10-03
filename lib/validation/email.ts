import { z } from "zod";

/** Email settings input validation. */

const TEMPLATE_KEYS = [
  "NEW_LEAD",
  "LEAD_ASSIGNED",
  "FORM_SUBMISSION",
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

// ---------------------------------------------------------------------------
// SMTP settings (Settings → Email)
// ---------------------------------------------------------------------------

/** No line breaks: a header value with CR/LF in it could add headers of its own. */
const singleLine = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .refine((value) => !/[\r\n]/.test(value), `${label} cannot contain line breaks.`);

const optionalEmail = (label: string) =>
  z
    .string()
    .trim()
    .max(254)
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || z.string().email().safeParse(value).success, `${label} must be an email address.`);

export const smtpSettingsSchema = z
  .object({
    host: z
      .string()
      .trim()
      .max(253, "The host name is too long.")
      .refine((value) => !/\s|:\/\//.test(value), "Enter the host name only, without spaces or smtp://.")
      .transform((value) => (value === "" ? null : value.toLowerCase())),
    port: z.coerce.number({ message: "Enter a port number." }).int("Enter a whole number.").min(1, "Ports run from 1 to 65535.").max(65535, "Ports run from 1 to 65535."),
    username: singleLine("The username", 320).transform((value) => (value === "" ? null : value)),
    /** Blank means "keep the stored password". */
    password: z.string().max(500, "The password is too long.").default(""),
    removePassword: z.boolean().default(false),
    encryption: z.enum(["SSL_TLS", "STARTTLS", "NONE"], { message: "Choose an encryption setting." }),
    fromName: singleLine("From name", 100),
    fromAddress: optionalEmail("From address"),
    replyTo: optionalEmail("Reply-to"),
    enabled: z.boolean().default(false),
    salesAddresses: z.string().max(5_000).default(""),
    notifyLeadCreated: z.boolean().default(false),
    notifyLeadAssigned: z.boolean().default(false),
    notifyFormSubmission: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    // Turning sending on needs somewhere to send from.
    if (value.enabled && !value.host) ctx.addIssue({ code: "custom", path: ["host"], message: "Enter an SMTP host before turning email on." });
    if (value.enabled && !value.fromAddress) ctx.addIssue({ code: "custom", path: ["fromAddress"], message: "Enter a From address before turning email on." });
    if (value.enabled && !value.fromName) ctx.addIssue({ code: "custom", path: ["fromName"], message: "Enter a From name before turning email on." });
  });

export type SmtpSettingsInput = z.infer<typeof smtpSettingsSchema>;

export const smtpTestSendSchema = z.object({
  to: z.string().trim().email("Enter a valid email address.").max(254),
});
