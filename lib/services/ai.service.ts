import "server-only";
import { db } from "@/lib/db";
import { NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { visibilityFilter } from "@/lib/services/crm.service";
import { overview, breakdowns } from "@/lib/services/analytics.service";
import { resolveRange, RANGE_LABEL } from "@/lib/analytics/range";
import { toMoneyString } from "@/lib/money";
import { ai } from "@/lib/ai";
import { SYSTEM_PROMPTS, factBlock } from "@/lib/ai/prompts";
import {
  LEAD_ASSESSMENT_SCHEMA,
  LEAD_SUMMARY_SCHEMA,
  SEO_DRAFT_SCHEMA,
  leadAssessmentShape,
  leadSummaryShape,
  seoDraftShape,
  type LeadAssessment,
  type LeadSummary,
  type SEODraft,
} from "@/lib/validation/ai";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { AITask } from "@/lib/ai/types";
import type {
  contentDraftSchema,
  crmAnalysisSchema,
  proposalDraftSchema,
  seoDraftSchema,
} from "@/lib/validation/ai";
import type { z } from "zod";

/**
 * The six AI assists (CLAUDE.md 16).
 *
 * Three properties hold across all of them, and they are the point:
 *
 *  1. **Nothing is written.** Every function returns a draft. A person edits it
 *     and saves it through the ordinary service for that record, which applies
 *     the ordinary validation and audit. There is no path by which the model
 *     writes to the database.
 *  2. **Figures come from the database.** Each prompt is handed the facts it
 *     may use, and is told not to produce any other number. Where a screen
 *     shows a figure next to AI prose, the figure is rendered from our data,
 *     not parsed out of the prose.
 *  3. **Every call is audited** — task, actor, subject and token usage — so the
 *     spend and the use are both accountable.
 */

const aiLog = log("ai");

/**
 * A spend guard on every assist.
 *
 * One place, applied by task, rather than a limit bolted onto each admin screen
 * — a caller that forgets is a caller that can run up a provider bill with a
 * held-down key. The window is generous enough that ordinary drafting never
 * notices it and tight enough that a stuck loop stops.
 *
 * Analysis is the expensive one, so it gets its own smaller allowance.
 */
const BUDGET: Record<AITask, { limit: number; windowMs: number }> = {
  summarizeLead: { limit: 30, windowMs: 60_000 },
  scoreLead: { limit: 30, windowMs: 60_000 },
  generateProposal: { limit: 15, windowMs: 60_000 },
  generateContent: { limit: 20, windowMs: 60_000 },
  generateSEOContent: { limit: 20, windowMs: 60_000 },
  analyzeCRM: { limit: 6, windowMs: 60_000 },
};

async function guardBudget(actor: Actor, task: AITask): Promise<void> {
  const budget = BUDGET[task];
  const result = await checkRateLimit(`ai:${task}:${actor.userId}`, budget);
  if (!result.allowed) {
    throw new RateLimitedError(result.retryAfterSeconds);
  }
}

/** Recorded after the call, whether or not the caller keeps the draft. */
async function auditCall(
  actor: Actor,
  task: AITask,
  subject: { type: string; id: string },
  usage: { inputTokens: number; outputTokens: number },
  model: string,
): Promise<void> {
  await record({
    actor,
    action: "CREATE",
    entityType: "AIDraft",
    entityId: `${task}:${subject.id}`,
    after: {
      task,
      model,
      subjectType: subject.type,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  });

  aiLog.info({ task, model, ...usage }, "ai draft produced");
}

/** Every result carries the marker the UI renders. Never optional. */
export type Draft<T> = {
  data: T;
  generated: true;
  model: string;
  task: AITask;
};

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

async function leadFacts(actor: Actor, leadId: string) {
  const lead = await db.lead.findFirst({
    // Scoped by the CRM's own visibility rule: an actor who may not read a
    // lead may not have it summarised either.
    where: { id: leadId, deletedAt: null, AND: [visibilityFilter(actor)] },
    select: {
      name: true,
      company: true,
      email: true,
      phone: true,
      message: true,
      budget: true,
      currency: true,
      status: true,
      priority: true,
      score: true,
      createdAt: true,
      source: { select: { name: true } },
      service: { select: { name: true } },
      city: { select: { name: true, state: true } },
      notes: { orderBy: { createdAt: "desc" }, take: 5, select: { body: true } },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { type: true, summary: true },
      },
    },
  });

  if (!lead) throw new NotFoundError("That lead does not exist.");
  return lead;
}

export async function summarizeLead(actor: Actor, leadId: string): Promise<Draft<LeadSummary>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "leads.view");
  await guardBudget(actor, "summarizeLead");

  const lead = await leadFacts(actor, leadId);

  const prompt = [
    factBlock({
      name: lead.name,
      company: lead.company,
      "has email": lead.email ? "yes" : "no",
      "has phone": lead.phone ? "yes" : "no",
      source: lead.source.name,
      service: lead.service?.name,
      city: lead.city ? `${lead.city.name}, ${lead.city.state}` : null,
      "stated budget": lead.budget ? `${lead.currency} ${toMoneyString(lead.budget)}` : "not stated",
      status: lead.status,
      priority: lead.priority,
      "computed score": lead.score,
      "enquired on": lead.createdAt.toISOString().slice(0, 10),
    }),
    "",
    `What they wrote:\n${lead.message ?? "(nothing)"}`,
    "",
    lead.notes.length > 0
      ? `Internal notes, newest first:\n${lead.notes.map((note) => `- ${note.body}`).join("\n")}`
      : "Internal notes: none.",
    "",
    lead.activities.length > 0
      ? `Recent activity:\n${lead.activities.map((a) => `- ${a.type}: ${a.summary}`).join("\n")}`
      : "Recent activity: none.",
    "",
    "Summarise this enquiry, give the single most useful next step, and list any questions worth asking before quoting.",
  ].join("\n");

  const result = await (await ai()).completeStructured({
    task: "summarizeLead",
    system: SYSTEM_PROMPTS.summarizeLead,
    prompt,
    schema: LEAD_SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => leadSummaryShape.parse(value),
  });

  await auditCall(actor, "summarizeLead", { type: "Lead", id: leadId }, result.usage, result.model);

  return { data: result.data, generated: true, model: result.model, task: "summarizeLead" };
}

/**
 * Assessment, not scoring.
 *
 * The numeric score stays the rules engine's. This returns the judgement a
 * rule cannot make, and the caller shows it beside the computed score rather
 * than in place of it — nothing here overwrites `Lead.score`.
 */
export async function scoreLead(actor: Actor, leadId: string): Promise<Draft<LeadAssessment>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "leads.view");
  await guardBudget(actor, "scoreLead");

  const lead = await leadFacts(actor, leadId);

  const prompt = [
    factBlock({
      company: lead.company,
      source: lead.source.name,
      service: lead.service?.name,
      city: lead.city ? `${lead.city.name}, ${lead.city.state}` : null,
      "stated budget": lead.budget ? `${lead.currency} ${toMoneyString(lead.budget)}` : "not stated",
      "contactable by email": lead.email ? "yes" : "no",
      "contactable by phone": lead.phone ? "yes" : "no",
      status: lead.status,
      "score our rules computed": lead.score,
    }),
    "",
    `What they wrote:\n${lead.message ?? "(nothing)"}`,
    "",
    "Assess how promising this looks and why. Do not restate the computed score as your own.",
  ].join("\n");

  const result = await (await ai()).completeStructured({
    task: "scoreLead",
    system: SYSTEM_PROMPTS.scoreLead,
    prompt,
    schema: LEAD_ASSESSMENT_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => leadAssessmentShape.parse(value),
  });

  await auditCall(actor, "scoreLead", { type: "Lead", id: leadId }, result.usage, result.model);

  return { data: result.data, generated: true, model: result.model, task: "scoreLead" };
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/**
 * The narrative sections only.
 *
 * The line items and totals are priced by `lib/money` and are not sent for
 * rewriting — the model is told what is being proposed, not what it costs, so
 * a drafted paragraph cannot contradict the figures on the same page.
 */
export async function generateProposal(
  actor: Actor,
  input: z.infer<typeof proposalDraftSchema>,
): Promise<Draft<string>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "proposals.edit");
  await guardBudget(actor, "generateProposal");

  const proposal = await db.proposal.findUnique({
    where: { id: input.proposalId },
    select: {
      title: true,
      client: { select: { name: true, industry: true } },
      lead: {
        select: {
          company: true,
          message: true,
          service: { select: { name: true } },
          city: { select: { name: true } },
        },
      },
      items: { orderBy: { order: "asc" }, select: { name: true, description: true } },
    },
  });

  if (!proposal) throw new NotFoundError("That proposal does not exist.");
  if (proposal.items.length === 0) {
    throw new ValidationError("Add the lines first, so the draft describes what is being proposed.");
  }

  const prompt = [
    factBlock({
      "proposal title": proposal.title,
      client: proposal.client?.name ?? proposal.lead?.company,
      industry: proposal.client?.industry,
      service: proposal.lead?.service?.name,
      city: proposal.lead?.city?.name,
    }),
    "",
    `What is being proposed, by line:\n${proposal.items
      .map((item) => `- ${item.name}${item.description ? `: ${item.description}` : ""}`)
      .join("\n")}`,
    "",
    proposal.lead?.message ? `What the client told us:\n${proposal.lead.message}` : "",
    input.brief ? `\nWhat the salesperson wants emphasised:\n${input.brief}` : "",
    "",
    "Draft the narrative sections: an opening, our understanding of their problem, our approach, and what success looks like. Do not mention prices or totals.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await (await ai()).complete({
    task: "generateProposal",
    system: SYSTEM_PROMPTS.generateProposal,
    prompt,
    maxTokens: 4_000,
  });

  await auditCall(
    actor,
    "generateProposal",
    { type: "Proposal", id: input.proposalId },
    result.usage,
    result.model,
  );

  return { data: result.text, generated: true, model: result.model, task: "generateProposal" };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export async function generateContent(
  actor: Actor,
  input: z.infer<typeof contentDraftSchema>,
): Promise<Draft<string>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "content.create");
  await guardBudget(actor, "generateContent");

  const client = input.clientId
    ? await db.client.findFirst({
        where: { id: input.clientId, deletedAt: null },
        select: { name: true, industry: true },
      })
    : null;

  const prompt = [
    factBlock({
      channel: input.channel,
      client: client?.name,
      industry: client?.industry,
      topic: input.topic,
    }),
    input.notes ? `\nAdditional direction:\n${input.notes}` : "",
    "",
    `Draft one piece of ${input.channel.toLowerCase()} content on this topic.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await (await ai()).complete({
    task: "generateContent",
    system: SYSTEM_PROMPTS.generateContent,
    prompt,
    maxTokens: 3_000,
  });

  await auditCall(
    actor,
    "generateContent",
    { type: "ContentCalendarItem", id: input.clientId ?? "new" },
    result.usage,
    result.model,
  );

  return { data: result.text, generated: true, model: result.model, task: "generateContent" };
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

/**
 * A draft for a service page, or a service-in-a-city page.
 *
 * The model reports whether it had enough to be specific about the city. That
 * flag is surfaced to the editor, because a page without genuine local content
 * is exactly what `canPublish()` refuses (CLAUDE.md 9) — the draft must not be
 * the reason someone tries.
 */
export async function generateSEOContent(
  actor: Actor,
  input: z.infer<typeof seoDraftSchema>,
): Promise<Draft<SEODraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "seo.edit");
  await guardBudget(actor, "generateSEOContent");

  const [service, city] = await Promise.all([
    db.service.findUnique({
      where: { id: input.serviceId },
      select: { name: true, shortDescription: true },
    }),
    input.cityId
      ? db.city.findUnique({
          where: { id: input.cityId },
          select: { name: true, state: true, population: true },
        })
      : Promise.resolve(null),
  ]);

  if (!service) throw new NotFoundError("That service does not exist.");
  if (input.cityId && !city) throw new NotFoundError("That city does not exist.");

  const prompt = [
    factBlock({
      service: service.name,
      "what the service is": service.shortDescription,
      city: city?.name,
      state: city?.state,
      population: city?.population,
    }),
    input.notes ? `\nWhat we know about this market:\n${input.notes}` : "",
    "",
    city
      ? `Draft the meta title, meta description and local intro for ${service.name} in ${city.name}. Say whether you had enough to be genuinely specific about ${city.name}.`
      : `Draft the meta title, meta description and intro for the ${service.name} page. Set enoughLocalDetail to true, since no city is involved.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await (await ai()).completeStructured({
    task: "generateSEOContent",
    system: SYSTEM_PROMPTS.generateSEOContent,
    prompt,
    schema: SEO_DRAFT_SCHEMA as unknown as Record<string, unknown>,
    parse: (value) => seoDraftShape.parse(value),
  });

  await auditCall(
    actor,
    "generateSEOContent",
    { type: "Service", id: input.serviceId },
    result.usage,
    result.model,
  );

  return { data: result.data, generated: true, model: result.model, task: "generateSEOContent" };
}

// ---------------------------------------------------------------------------
// CRM insights
// ---------------------------------------------------------------------------

export type CRMAnalysis = {
  prose: string;
  /** The figures the model was given, so the screen can show them itself. */
  facts: [string, string][];
};

/**
 * Commentary on figures the analytics service measured.
 *
 * The numbers are read from `analytics.service`, handed to the model, and
 * returned alongside its prose so the page renders them from our data rather
 * than from the model's sentences. If there is nothing to analyse, this refuses
 * rather than asking for commentary on an empty period — an empty state beats
 * invented insight.
 */
export async function analyzeCRM(
  actor: Actor,
  input: z.infer<typeof crmAnalysisSchema>,
): Promise<Draft<CRMAnalysis>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "analytics.view");
  await guardBudget(actor, "analyzeCRM");

  const range = resolveRange(input.range);
  const [summary, dims] = await Promise.all([overview(actor, range), breakdowns(actor, range)]);

  if (summary.leads === 0) {
    throw new ValidationError(
      `No leads were captured in ${RANGE_LABEL[input.range].toLowerCase()}, so there is nothing to analyse.`,
    );
  }

  const facts: [string, string][] = [
    ["period", RANGE_LABEL[input.range]],
    ["leads", String(summary.leads)],
    ["qualified", String(summary.qualified)],
    ["won", String(summary.won)],
    ["lost", String(summary.lost)],
    ["conversion rate", summary.conversionRate ? `${summary.conversionRate}%` : "not calculable"],
    ["pipeline value (stated budgets)", `INR ${summary.pipelineValue}`],
    ["active clients", String(summary.activeClients)],
    ["live projects", String(summary.activeProjects)],
    ["tasks overdue", String(summary.tasksOverdue)],
  ];

  // Revenue is only in the facts when this actor may see finance figures. A
  // marketing manager gets an analysis of the pipeline, not of the money.
  if (summary.revenue !== null) facts.push(["revenue received", `INR ${summary.revenue}`]);
  if (summary.outstanding !== null) facts.push(["outstanding", `INR ${summary.outstanding}`]);

  for (const row of dims.source.slice(0, 6)) {
    facts.push([
      `source: ${row.label}`,
      [
        `${row.leads} leads`,
        `${row.won} won`,
        `pipeline INR ${row.pipelineValue}`,
        row.revenue === null ? null : `revenue INR ${row.revenue}`,
      ]
        .filter(Boolean)
        .join(", "),
    ]);
  }

  for (const row of dims.service.slice(0, 5)) {
    facts.push([`service: ${row.label}`, `${row.leads} leads, ${row.won} won`]);
  }

  const prompt = [
    factBlock(Object.fromEntries(facts)),
    "",
    dims.revenueWithheld
      ? "You have not been given revenue figures. Do not speculate about money."
      : "",
    "",
    "What is worth acting on here? Be specific about which of these numbers you are drawing on, and say where the data is too thin to conclude anything.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await (await ai()).complete({
    task: "analyzeCRM",
    system: SYSTEM_PROMPTS.analyzeCRM,
    prompt,
    maxTokens: 3_000,
  });

  await auditCall(actor, "analyzeCRM", { type: "Analytics", id: input.range }, result.usage, result.model);

  return {
    data: { prose: result.text, facts },
    generated: true,
    model: result.model,
    task: "analyzeCRM",
  };
}
