import { z } from "zod";
import { OPERATORS } from "@/lib/automation/conditions";
import { WIRED_TRIGGERS } from "@/lib/automation/types";

/**
 * What an admin may build.
 *
 * Action configs are a discriminated union, so an action can never be saved
 * with a shape its handler does not understand — a rule that fails at fire time
 * is worse than one that cannot be saved.
 */

const id = z.string().trim().min(1).max(40);
const shortText = z.string().trim().min(1).max(200);

export const assignLeadConfig = z.object({
  type: z.literal("ASSIGN_LEAD"),
  strategy: z.enum(["SPECIFIC", "ROUND_ROBIN"]).default("ROUND_ROBIN"),
  userId: id.nullable().optional(),
  /**
   * Capture already round-robins a new lead, so a rule that fires on
   * LEAD_CREATED normally finds one assigned. Default true means "fill the gap,
   * do not fight the CRM"; false is for a rule that deliberately reassigns.
   */
  onlyIfUnassigned: z.boolean().default(true),
});

export const createLeadTaskConfig = z.object({
  type: z.literal("CREATE_LEAD_TASK"),
  title: shortText,
  detail: z.string().trim().max(1000).nullable().optional(),
  dueInDays: z.coerce.number().int().min(0).max(365).default(1),
  assignTo: z.enum(["LEAD_OWNER", "SPECIFIC"]).default("LEAD_OWNER"),
  userId: id.nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export const sendEmailConfig = z.object({
  type: z.literal("SEND_EMAIL"),
  templateKey: z.enum([
    "NEW_LEAD",
    "LEAD_ASSIGNED",
    "FOLLOW_UP",
    "PROPOSAL_SENT",
    "PROPOSAL_ACCEPTED",
    "INVOICE_SENT",
    "PAYMENT_RECEIVED",
    "PAYMENT_REMINDER",
    "CLIENT_NOTIFICATION",
  ]),
  to: z.enum(["LEAD", "LEAD_OWNER", "CLIENT_PRIMARY", "SPECIFIC"]).default("LEAD_OWNER"),
  email: z.string().trim().email().max(200).nullable().optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().max(2000).nullable().optional(),
});

export const notifyUserConfig = z.object({
  type: z.literal("NOTIFY_USER"),
  to: z.enum(["LEAD_OWNER", "PROJECT_MANAGER", "ROLE", "SPECIFIC"]).default("LEAD_OWNER"),
  userId: id.nullable().optional(),
  roleName: z.string().trim().max(40).nullable().optional(),
  title: shortText,
  body: z.string().trim().max(1000).nullable().optional(),
});

export const createClientConfig = z.object({
  type: z.literal("CREATE_CLIENT"),
});

export const createProjectConfig = z.object({
  type: z.literal("CREATE_PROJECT"),
  /** `{{client.name}}` and `{{proposal.title}}` are substituted from the facts. */
  nameTemplate: z.string().trim().min(1).max(160).default("{{client.name}} onboarding"),
  managerId: id.nullable().optional(),
  startInDays: z.coerce.number().int().min(0).max(365).default(0),
  dueInDays: z.coerce.number().int().min(1).max(730).nullable().optional(),
});

export const createProjectTasksConfig = z.object({
  type: z.literal("CREATE_PROJECT_TASKS"),
  /** One title per line in the editor. */
  titles: z.array(shortText).min(1, "List at least one task.").max(50),
  dueInDays: z.coerce.number().int().min(0).max(365).default(7),
});

export const setLeadStatusConfig = z.object({
  type: z.literal("SET_LEAD_STATUS"),
  status: z.enum([
    "NEW",
    "CONTACTED",
    "QUALIFIED",
    "PROPOSAL",
    "NEGOTIATION",
    "WON",
    "LOST",
    "NURTURE",
  ]),
});

export const addTagConfig = z.object({
  type: z.literal("ADD_TAG"),
  tagName: z.string().trim().min(1).max(60),
});

export const actionConfigSchema = z.discriminatedUnion("type", [
  assignLeadConfig,
  createLeadTaskConfig,
  sendEmailConfig,
  notifyUserConfig,
  createClientConfig,
  createProjectConfig,
  createProjectTasksConfig,
  setLeadStatusConfig,
  addTagConfig,
]);

export type ActionConfig = z.infer<typeof actionConfigSchema>;

export const conditionSchema = z.object({
  field: z.string().trim().min(1).max(80),
  operator: z.enum(OPERATORS),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional(),
});

export const automationSchema = z.object({
  name: z.string().trim().min(2, "Name the rule.").max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().default(false),
  order: z.coerce.number().int().min(0).max(9999).default(0),
  trigger: z.enum(WIRED_TRIGGERS),
  conditions: z.array(conditionSchema).max(20).default([]),
  actions: z.array(actionConfigSchema).min(1, "A rule needs at least one action.").max(20),
});

export type AutomationInput = z.infer<typeof automationSchema>;
