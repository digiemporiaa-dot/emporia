import { z } from "zod";

/** CRM admin input validation. */

export const leadStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
  "NURTURE",
]);

export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const changeStatusSchema = z.object({
  leadId: z.string().min(1).max(40),
  status: leadStatusSchema,
  note: z.string().trim().max(1000).nullable().optional(),
});

export const assignSchema = z.object({
  leadId: z.string().min(1).max(40),
  /** Empty string means unassign. */
  toUserId: z.string().trim().max(40),
  reason: z.string().trim().max(300).nullable().optional(),
});

export const prioritySetSchema = z.object({
  leadId: z.string().min(1).max(40),
  priority: prioritySchema,
});

export const noteSchema = z.object({
  leadId: z.string().min(1).max(40),
  body: z.string().trim().min(2, "Write something worth recording.").max(4000),
});

export const taskSchema = z.object({
  leadId: z.string().min(1).max(40),
  title: z.string().trim().min(3, "Give the follow-up a title.").max(200),
  detail: z.string().trim().max(2000).nullable().optional(),
  dueAt: z.coerce.date(),
  assigneeId: z.string().min(1, "Choose who owns this follow-up.").max(40),
  priority: prioritySchema.default("MEDIUM"),
});

/** List filters, parsed from the query string. */
export const leadListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: leadStatusSchema.optional(),
  priority: prioritySchema.optional(),
  sourceId: z.string().trim().max(40).optional(),
  serviceId: z.string().trim().max(40).optional(),
  cityId: z.string().trim().max(40).optional(),
  assignedToId: z.string().trim().max(40).optional(),
  unassigned: z.coerce.boolean().optional(),
  sort: z.enum(["createdAt", "score", "name", "status"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export type LeadListParamsInput = z.infer<typeof leadListParamsSchema>;
