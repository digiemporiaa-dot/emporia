import { z } from "zod";

/** Delivery input validation: projects, tasks, time, content and approvals. */

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 250000 or 250000.00");

const hoursString = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,2})?$/, "Enter hours like 8 or 7.5");

const id = z.string().trim().min(1).max(40);
const optionalId = z.string().trim().max(40).nullable().optional();

export const currencySchema = z.enum(["INR", "USD", "EUR", "GBP", "AED"]);

export const projectSchema = z
  .object({
    name: z.string().trim().min(3, "Give the project a name.").max(200),
    clientId: id,
    serviceId: optionalId,
    managerId: id,
    contractId: optionalId,
    status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).default("PLANNING"),
    budget: moneyString.default("0"),
    currency: currencySchema.default("INR"),
    startsAt: z.coerce.date(),
    dueAt: z.coerce.date().nullable().optional(),
  })
  .refine((value) => !value.dueAt || value.dueAt >= value.startsAt, {
    message: "The due date must be on or after the start date.",
    path: ["dueAt"],
  });

export type ProjectInput = z.infer<typeof projectSchema>;

/** Project list filters, parsed from the query string. */
export const projectListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).optional(),
  clientId: z.string().trim().max(40).optional(),
  managerId: z.string().trim().max(40).optional(),
  sort: z.enum(["createdAt", "name", "dueAt", "status"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export type ProjectListParamsInput = z.infer<typeof projectListParamsSchema>;

/** Content calendar filters, parsed from the query string. */
export const contentListParamsSchema = z.object({
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  channel: z
    .enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "BLOG", "YOUTUBE", "EMAIL", "ADS"])
    .optional(),
  stage: z
    .enum([
      "IDEA",
      "DRAFT",
      "INTERNAL_REVIEW",
      "CLIENT_REVIEW",
      "APPROVED",
      "SCHEDULED",
      "PUBLISHED",
    ])
    .optional(),
  projectId: z.string().trim().max(40).optional(),
  view: z.enum(["calendar", "board"]).default("calendar"),
});

export type ContentListParamsInput = z.infer<typeof contentListParamsSchema>;

export const projectStatusSchema = z.object({
  projectId: id,
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]),
});

export const taskSchema = z.object({
  projectId: id,
  parentId: optionalId,
  milestoneId: optionalId,
  title: z.string().trim().min(2, "Give the task a title.").max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  assigneeId: optionalId,
  status: z
    .enum(["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"])
    .default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueAt: z.coerce.date().nullable().optional(),
  estimateHours: hoursString.nullable().optional(),
});

export type TaskInput = z.infer<typeof taskSchema>;

export const taskStatusSchema = z.object({
  taskId: id,
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"]),
});

export const dependencySchema = z.object({
  taskId: id,
  dependsOnId: id,
});

export const milestoneSchema = z.object({
  projectId: id,
  title: z.string().trim().min(2, "Give the milestone a title.").max(200),
  dueAt: z.coerce.date(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).default("PENDING"),
  order: z.coerce.number().int().min(0).max(9999).default(0),
});

export type MilestoneInput = z.infer<typeof milestoneSchema>;

export const commentSchema = z.object({
  projectId: id,
  taskId: optionalId,
  body: z.string().trim().min(1, "Write something first.").max(5000),
});

export type CommentInput = z.infer<typeof commentSchema>;

export const timeEntrySchema = z.object({
  projectId: id,
  taskId: optionalId,
  /**
   * Time is entered in hours and stored in whole minutes: an integer count of
   * minutes has no rounding error to accumulate across a month of entries.
   */
  hours: hoursString,
  note: z.string().trim().max(500).nullable().optional(),
  startedAt: z.coerce.date(),
});

export type TimeEntryInput = z.infer<typeof timeEntrySchema>;

export const contentItemSchema = z.object({
  projectId: id,
  channel: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "BLOG", "YOUTUBE", "EMAIL", "ADS"]),
  title: z.string().trim().min(2, "Give the item a title.").max(200),
  brief: z.string().trim().max(5000).nullable().optional(),
  ownerId: optionalId,
  scheduledFor: z.coerce.date().nullable().optional(),
  mediaId: optionalId,
});

export type ContentItemInput = z.infer<typeof contentItemSchema>;

export const contentStageSchema = z.object({
  itemId: id,
  stage: z.enum([
    "IDEA",
    "DRAFT",
    "INTERNAL_REVIEW",
    "CLIENT_REVIEW",
    "APPROVED",
    "SCHEDULED",
    "PUBLISHED",
  ]),
});

export const approvalSchema = z.object({
  title: z.string().trim().min(2, "Give the approval a title.").max(200),
  projectId: optionalId,
  contentItemId: optionalId,
  notes: z.string().trim().max(5000).nullable().optional(),
  /** The creative being approved, from the media library. */
  mediaId: optionalId,
});

export type ApprovalInput = z.infer<typeof approvalSchema>;

export const approvalVersionSchema = z.object({
  approvalId: id,
  notes: z.string().trim().max(5000).nullable().optional(),
  mediaId: optionalId,
});

export const approvalDecisionSchema = z.object({
  approvalId: id,
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
  feedback: z.string().trim().max(5000).nullable().optional(),
});

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
