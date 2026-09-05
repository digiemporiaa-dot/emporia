import { z } from "zod";

/** Inputs to the assist features, and the shapes the model must answer in. */

const id = z.string().trim().min(1).max(40);

export const summarizeLeadSchema = z.object({ leadId: id });

export const scoreLeadSchema = z.object({ leadId: id });

export const proposalDraftSchema = z.object({
  proposalId: id,
  /** What the salesperson wants emphasised. Optional steer, not a prompt. */
  brief: z.string().trim().max(1000).nullable().optional(),
});

export const contentDraftSchema = z.object({
  channel: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "BLOG", "YOUTUBE", "EMAIL", "ADS"]),
  topic: z.string().trim().min(3, "Say what it should be about.").max(300),
  clientId: id.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const seoDraftSchema = z.object({
  serviceId: id,
  cityId: id.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const crmAnalysisSchema = z.object({
  range: z.enum(["7d", "30d", "90d", "mtd", "qtd", "ytd", "all"]).default("30d"),
});

// ── Shapes the model must answer in ────────────────────────────────────────

export const leadSummaryShape = z.object({
  summary: z.string().min(1).max(2000),
  nextStep: z.string().min(1).max(500),
  questions: z.array(z.string().max(300)).max(6),
});

export type LeadSummary = z.infer<typeof leadSummaryShape>;

export const leadAssessmentShape = z.object({
  /** The model's own read, kept separate from the computed score. */
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasoning: z.string().min(1).max(2000),
  strengths: z.array(z.string().max(300)).max(6),
  concerns: z.array(z.string().max(300)).max(6),
  missing: z.array(z.string().max(300)).max(6),
});

export type LeadAssessment = z.infer<typeof leadAssessmentShape>;

export const seoDraftShape = z.object({
  metaTitle: z.string().min(1).max(80),
  metaDescription: z.string().min(1).max(200),
  intro: z.string().min(1).max(4000),
  /** The model's own judgement of whether it had enough to be specific. */
  enoughLocalDetail: z.boolean(),
  note: z.string().max(500).optional().default(""),
});

export type SEODraft = z.infer<typeof seoDraftShape>;

/** JSON Schema equivalents, for the provider's structured-output constraint. */
export const LEAD_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    nextStep: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "nextStep", "questions"],
  additionalProperties: false,
} as const;

export const LEAD_ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    reasoning: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "string" } },
  },
  required: ["confidence", "reasoning", "strengths", "concerns", "missing"],
  additionalProperties: false,
} as const;

export const SEO_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    metaTitle: { type: "string" },
    metaDescription: { type: "string" },
    intro: { type: "string" },
    enoughLocalDetail: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["metaTitle", "metaDescription", "intro", "enoughLocalDetail"],
  additionalProperties: false,
} as const;
