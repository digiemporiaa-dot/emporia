import "server-only";
import { db } from "@/lib/db";
import { NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { visibilityFilter } from "@/lib/services/crm.service";
import { BLOCK_SCHEMAS, blockDefinition, isBlockType } from "@/lib/content/blocks";
import { allowedBlocksOf, templatePermits } from "@/lib/content/templates";
import { sectionText, wordCount } from "@/lib/content/text";
import type {
  GenerateBlocksInput,
  GenerateMetaInput,
  RewriteAction,
  RewriteInput,
} from "@/lib/validation/ai-cms";
import type { SocialProvider } from "@/generated/prisma/enums";
import { overview, breakdowns } from "@/lib/services/analytics.service";
import { resolveRange, RANGE_LABEL } from "@/lib/analytics/range";
import { toMoneyString } from "@/lib/money";
import { ai } from "@/lib/ai";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { resolveClientScope } from "@/lib/social/scope";
import { SYSTEM_PROMPTS, factBlock } from "@/lib/ai/prompts";
import { assertPillarForClient, brandKitForPrompt } from "@/lib/services/social-brand.service";
import { occasionsBetween } from "@/lib/services/social-occasion.service";
import { textLength } from "@/lib/social/text-length";
import { parseBody, postBodySchema } from "@/lib/content/entity-body";
import { inlineToText } from "@/lib/content/inline";
import { siteOrigin } from "@/lib/seo/urls";
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
  // Field rewriting is the one an editor does repeatedly while drafting, so its
  // allowance is the largest — a limit that interrupts ordinary writing is a
  // limit people work around.
  rewriteField: { limit: 60, windowMs: 60_000 },
  generateBlocks: { limit: 10, windowMs: 60_000 },
  generateMeta: { limit: 30, windowMs: 60_000 },
  // Drafting one idea across several platforms is several calls in a row, and
  // trying two or three tones for each is ordinary work, not a stuck loop.
  draftSocialPost: { limit: 40, windowMs: 60_000 },
  // Improving and suggesting are the small, repeated nudges of editing.
  assistSocialCopy: { limit: 60, windowMs: 60_000 },
  // One call writes several platforms' posts, so fewer are needed.
  repurposeContent: { limit: 10, windowMs: 60_000 },
  generateContentIdeas: { limit: 10, windowMs: 60_000 },
  // A whole month in one call — the largest reply, so the smallest allowance.
  planContentMonth: { limit: 5, windowMs: 60_000 },
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

// ---------------------------------------------------------------------------
// The CMS assistant
// ---------------------------------------------------------------------------

/**
 * ## What the assistant may and may not do
 *
 * Everything here returns a `Draft<T>` like the rest of this service:
 * labelled, editable, and **never written anywhere**. These functions read the
 * database and call the model; not one of them updates a row. Applying a draft
 * is a separate, ordinary save the editor makes through the normal service,
 * with the normal permission and the normal audit row. That is the master
 * brief's rule — AI output stays a draft until a person approves it — and
 * making it structural rather than a convention means there is no path where a
 * model writes to the site.
 *
 * The system prompts forbid inventing facts, but a prompt is not a guarantee,
 * so the shape of each task limits the damage: rewriting is given the text it
 * is editing, block generation is validated against the block schemas before
 * an editor ever sees it, and nothing here is allowed to produce a number that
 * lands anywhere near a metric.
 */

const REWRITE_INSTRUCTION: Record<RewriteAction, string> = {
  rewrite: "Rewrite this so it reads better. Keep the same meaning and length.",
  shorten: "Make this shorter without losing anything it actually says.",
  expand:
    "Say more, using only what is already here or what is generally true of the subject. Add no facts, figures or claims.",
  formal: "Make the tone more formal and precise. Keep it readable.",
  plain: "Rewrite this in plainer English. Shorter sentences, fewer abstractions.",
  translate: "Translate this.",
};

/**
 * Rewrite one field.
 *
 * `content.edit` is not the right permission here — this edits website copy —
 * so it is gated on `pages.edit` alongside `ai.use`. Nothing is saved either
 * way; the gate is about who may spend a call and see a suggestion for a page
 * they could not otherwise change.
 */
export async function rewriteField(
  actor: Actor,
  input: RewriteInput,
): Promise<Draft<string>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "pages.edit");
  await guardBudget(actor, "rewriteField");

  const instruction =
    input.action === "translate"
      ? `Translate this into ${input.language}. Keep the meaning exactly; do not localise claims or figures.`
      : REWRITE_INSTRUCTION[input.action];

  const result = await (await ai()).complete({
    task: "rewriteField",
    system: SYSTEM_PROMPTS.rewriteField,
    prompt: `${instruction}\n\nText:\n${input.text}`,
    // Room to expand, but not room to write an essay in place of a heading.
    maxTokens: 1_500,
  });

  await auditCall(
    actor,
    "rewriteField",
    { type: "PageSection", id: input.action },
    result.usage,
    result.model,
  );

  return { data: result.text.trim(), generated: true, model: result.model, task: "rewriteField" };
}

/** One drafted band: a block type and content that has already been validated. */
export type DraftedBlock = { type: string; content: unknown };

export type BlockDraft = {
  blocks: DraftedBlock[];
  /**
   * Bands the model produced that did not survive validation.
   *
   * Reported rather than hidden: an editor who asked for five bands and got
   * three should know the other two were rejected, not wonder whether they
   * asked wrongly.
   */
  rejected: string[];
};

/**
 * Draft the bands of a page.
 *
 * The model's output is parsed against **the real block schemas** before it
 * reaches anyone. A band that does not validate is dropped, not repaired and
 * not shown: the alternative is an editor pasting something the renderer will
 * refuse, and discovering that on the live page.
 *
 * The editor chooses which bands to draft. Letting the model choose its own
 * structure produced pages that ignored the template's allowed blocks, so the
 * shape is the human's decision and the words are the model's.
 */
export async function generateBlocks(
  actor: Actor,
  input: GenerateBlocksInput,
): Promise<Draft<BlockDraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "pages.edit");
  await guardBudget(actor, "generateBlocks");

  const page = await db.page.findFirst({
    where: { id: input.pageId, deletedAt: null },
    select: {
      title: true,
      slug: true,
      template: { select: { name: true, allowedBlocks: true } },
    },
  });
  if (!page) throw new NotFoundError("That page does not exist.");

  // A template's restriction applies to a draft too. Offering an editor a band
  // they cannot then add would be a suggestion designed to be refused.
  const allowed = allowedBlocksOf(page.template?.allowedBlocks);
  const wanted = input.blocks.filter((type) => templatePermits(allowed, type));
  if (wanted.length === 0) {
    throw new ValidationError("None of those bands are allowed on this page's template.");
  }

  const prompt = [
    factBlock({ page: page.title, address: `/${page.slug}`, template: page.template?.name }),
    "",
    `Brief:\n${input.brief}`,
    "",
    `Draft these bands, in this order: ${wanted.join(", ")}.`,
    "Return one object per band, with its type and its fields.",
  ].join("\n");

  const result = await (await ai()).completeStructured<{ blocks: DraftedBlock[] }>({
    task: "generateBlocks",
    system: SYSTEM_PROMPTS.generateBlocks,
    prompt,
    maxTokens: 4_000,
    schema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: wanted },
              // The fields differ per block, so the provider's schema cannot
              // pin them; the block schemas below do, which is the check that
              // actually matters.
              content: { type: "object" },
            },
            required: ["type", "content"],
          },
        },
      },
      required: ["blocks"],
    },
    parse: (value) => {
      const shape = value as { blocks?: unknown };
      if (!Array.isArray(shape.blocks)) throw new Error("No blocks returned.");
      return { blocks: shape.blocks as DraftedBlock[] };
    },
  });

  const blocks: DraftedBlock[] = [];
  const rejected: string[] = [];

  for (const block of result.data.blocks) {
    if (!isBlockType(block.type) || !templatePermits(allowed, block.type)) {
      rejected.push(String(block.type));
      continue;
    }
    // The block's own schema, applied to the model's output exactly as it is
    // applied to a human's. Defaults fill what the model left out; anything it
    // invented that the block has no field for is stripped.
    const parsed = BLOCK_SCHEMAS[block.type].safeParse({
      ...blockDefinition(block.type).defaults,
      ...(block.content as Record<string, unknown>),
    });
    if (!parsed.success) {
      rejected.push(block.type);
      continue;
    }
    blocks.push({ type: block.type, content: parsed.data });
  }

  await auditCall(
    actor,
    "generateBlocks",
    { type: "Page", id: input.pageId },
    result.usage,
    result.model,
  );

  return {
    data: { blocks, rejected },
    generated: true,
    model: result.model,
    task: "generateBlocks",
  };
}

export type SocialCaptionDraft = {
  caption: string;
  headline: string | null;
  hashtags: string[];
  /**
   * Words from the client's forbidden list that the draft used anyway. The
   * prompt asks the model not to; this is the check that does not rely on it
   * listening. Shown to the operator, never silently edited out.
   */
  forbiddenUsed: string[];
};

/** Which of `words` appear in `text` as whole words or phrases, ignoring case. */
export function forbiddenWordsIn(text: string, words: readonly string[]): string[] {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return words.filter((word) => {
    const trimmed = word.trim();
    if (!trimmed) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(trimmed)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
  });
}

// ---------------------------------------------------------------------------
// Social: shared context
// ---------------------------------------------------------------------------

/**
 * What every social task is told about the client, from the client's own
 * brand kit. One builder, so a caption, a hashtag suggestion and a
 * repurposed article all hear the same voice and the same forbidden words.
 */
async function socialContext(
  client: { id: string; name: string; industry: string | null },
  pillarId: string | null,
) {
  const { profile: brand, pillar } = await brandKitForPrompt(client.id, pillarId);
  return {
    facts: {
      client: brand?.brandName ?? client.name,
      industry: brand?.industry ?? client.industry,
      "content pillar": pillar ? [pillar.name, pillar.description].filter(Boolean).join(" — ") : null,
      tone: brand?.tone,
      audience: brand?.targetAudience,
      language: brand?.preferredLanguage,
      "call-to-action style": brand?.ctaStyle,
      "emojis the brand uses": brand?.preferredEmojis.length ? brand.preferredEmojis.join(" ") : null,
      "posting rules": brand?.postingRules,
    } as Record<string, string | number | null | undefined>,
    forbidden: brand?.forbiddenWords ?? [],
    brandHashtags: brand?.hashtags ?? [],
  };
}

function forbiddenRule(forbidden: readonly string[]): string {
  return forbidden.length > 0 ? `Never use these words or phrases: ${forbidden.join(", ")}.` : "";
}

/** Normalised the same way the editor normalises typed tags, so they cannot differ. */
function normaliseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter((tag) => tag.length > 0 && /^[\p{L}\p{N}_]+$/u.test(tag))
    .slice(0, 30);
}

/** The brand's always-on hashtags, added where missing. Deterministic, so not asked for. */
function withBrandTags(tags: readonly string[], brandTags: readonly string[]): string[] {
  const merged = [...tags];
  for (const tag of brandTags) {
    if (!merged.some((existing) => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag);
  }
  return merged.slice(0, 30);
}

/**
 * Trim a caption until the whole post fits the platform, counted the way the
 * editor's validation counts it — hashtags, mentions and an in-text link
 * included, X's weighting applied. A draft that fits the model's idea of the
 * limit but fails the editor's is a draft nobody can save.
 */
function fitCaption(
  provider: SocialProvider,
  caption: string,
  hashtags: readonly string[],
  linkUrl: string | null,
): string {
  const capability = CAPABILITIES[provider];
  if (capability.captionLimit === null) return caption;
  const extras = [
    ...hashtags.map((tag) => `#${tag}`),
    ...(capability.linkInText && linkUrl ? [linkUrl] : []),
  ];
  const measure = (text: string) => textLength([text, ...extras].join(" "), capability.lengthRule);
  let fitted = caption;
  while (fitted && measure(fitted) > capability.captionLimit) {
    const over = measure(fitted) - capability.captionLimit;
    fitted = [...fitted].slice(0, Math.max(0, [...fitted].length - Math.max(1, over))).join("").trimEnd();
  }
  return fitted;
}

/** The idea, its client and campaign, proven visible to the actor. */
async function socialItem(actor: Actor, contentItemId: string) {
  const item = await db.contentCalendarItem.findUnique({
    where: { id: contentItemId },
    select: {
      id: true,
      title: true,
      brief: true,
      clientId: true,
      pillarId: true,
      client: { select: { id: true, name: true, industry: true } },
      campaign: { select: { name: true } },
    },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  // Same isolation as every other social read: an actor who may not see the
  // client may not have its content drafted either.
  await resolveClientScope(actor, item.clientId);
  return item;
}

// ---------------------------------------------------------------------------
// Social: drafting a version
// ---------------------------------------------------------------------------

/**
 * Draft one platform's version of an idea — from its brief, or adapted from
 * another platform's version of the same idea ("Create LinkedIn version").
 *
 * Bounded by the platform's declared capabilities and written in the client's
 * brand voice. The result is a `Draft`, written nowhere until a person saves
 * it. Nothing here can publish (CLAUDE.md 16).
 */
export async function draftSocialPost(
  actor: Actor,
  input: {
    contentItemId: string;
    provider: SocialProvider;
    type: string;
    instruction: string | null;
    /** Another version of the same idea to adapt, rather than the brief. */
    fromPostId?: string | null;
  },
): Promise<Draft<SocialCaptionDraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "social.edit");
  await guardBudget(actor, "draftSocialPost");

  const item = await socialItem(actor, input.contentItemId);

  // Adapting is from a sibling version only: an id from the browser is not a
  // way to read another idea's — or another client's — copy.
  const source = input.fromPostId
    ? await db.socialPost.findFirst({
        where: { id: input.fromPostId, contentItemId: item.id },
        select: { provider: true, caption: true, headline: true, hashtags: true },
      })
    : null;
  if (input.fromPostId && !source) throw new NotFoundError("That version is not part of this idea.");
  if (source && !source.caption?.trim()) {
    throw new ValidationError("That version has no caption yet, so there is nothing to adapt.");
  }

  // A caption drafted from nothing is a guess dressed as a draft.
  if (!source && !item.brief?.trim() && !item.title.trim()) {
    throw new ValidationError(
      "Write the brief first. A caption drafted from an empty idea is invention, not assistance.",
    );
  }

  const context = await socialContext(item.client, item.pillarId);
  const capability = CAPABILITIES[input.provider];
  const wantsHeadline = capability.fields.includes("headline");
  const wantsHashtags = capability.fields.includes("hashtags");
  const limit = capability.captionLimit ?? 2_000;

  const result = await (await ai()).completeStructured<SocialCaptionDraft>({
    task: "draftSocialPost",
    system: SYSTEM_PROMPTS.draftSocialPost,
    prompt: [
      factBlock({
        ...context.facts,
        campaign: item.campaign?.name,
        platform: PROVIDER_LABEL[input.provider],
        format: input.type.toLowerCase().replace(/_/g, " "),
        "caption limit": limit,
      }),
      forbiddenRule(context.forbidden),
      "",
      `The idea: ${item.title}`,
      item.brief?.trim() ? `The brief: ${item.brief.trim()}` : "",
      source
        ? [
            "",
            `Adapt the existing ${PROVIDER_LABEL[source.provider]} version below for ${PROVIDER_LABEL[input.provider]}.`,
            "Keep what it says; rewrite how it says it for the new platform and its audience. Do not copy it word for word.",
            source.headline ? `Its headline: ${source.headline}` : "",
            `Its caption: ${source.caption!.trim()}`,
            source.hashtags.length ? `Its hashtags: ${source.hashtags.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "",
      input.instruction?.trim() ? `Also: ${input.instruction.trim()}` : "",
      "",
      `Write the ${PROVIDER_LABEL[input.provider]} version. Stay under ${limit} characters.`,
      wantsHashtags ? "" : "This platform does not use hashtags — return an empty array.",
      wantsHeadline ? "" : "This platform has no headline — return null for it.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 900,
    schema: {
      type: "object",
      properties: {
        caption: { type: "string" },
        headline: { type: ["string", "null"] },
        hashtags: { type: "array", items: { type: "string" } },
      },
      required: ["caption", "headline", "hashtags"],
    },
    parse: (value) => {
      const shape = value as { caption?: unknown; headline?: unknown; hashtags?: unknown };
      if (typeof shape.caption !== "string" || !shape.caption.trim()) {
        throw new Error("The draft had no caption.");
      }
      const hashtags = wantsHashtags ? withBrandTags(normaliseTags(shape.hashtags), context.brandHashtags) : [];
      const headline =
        wantsHeadline && typeof shape.headline === "string" && shape.headline.trim()
          ? shape.headline.trim()
          : null;
      // Truncation is the platform's rule, not a preference. A caption over
      // the limit is unusable, and silently keeping it would push the failure
      // to 7:30pm.
      const caption = shape.caption.trim().slice(0, limit);

      return {
        caption,
        headline,
        hashtags,
        forbiddenUsed: forbiddenWordsIn([caption, headline ?? "", hashtags.join(" ")].join("\n"), context.forbidden),
      };
    },
  });

  await auditCall(
    actor,
    "draftSocialPost",
    { type: "ContentCalendarItem", id: input.contentItemId },
    result.usage,
    result.model,
  );

  return { data: result.data, generated: true, model: result.model, task: "draftSocialPost" };
}

// ---------------------------------------------------------------------------
// Social: polishing part of a version
// ---------------------------------------------------------------------------

export type SocialAssistMode = "improve" | "hashtags" | "cta";

export type SocialAssistDraft = {
  /** `improve`: the rewritten caption. */
  caption?: string;
  /** `hashtags`: suggested tags, bare, brand tags included. */
  hashtags?: string[];
  /** `cta` on a platform with fixed buttons: one of its button values. */
  callToAction?: string;
  /** `cta` elsewhere: a closing line to add to the caption. */
  ctaLine?: string;
  forbiddenUsed: string[];
};

/**
 * Improve a caption, suggest hashtags, or suggest a call to action — for the
 * text a person is editing right now, which may not be saved yet.
 *
 * The call to action follows the platform: where it has fixed buttons
 * (Google Business Profile) the model may only pick one of them; elsewhere it
 * writes a closing line the editor adds to the caption.
 */
export async function assistSocialCopy(
  actor: Actor,
  input: {
    contentItemId: string;
    provider: SocialProvider;
    mode: SocialAssistMode;
    /** The caption as it currently stands in the editor. */
    text: string;
    instruction: string | null;
  },
): Promise<Draft<SocialAssistDraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "social.edit");

  const capability = CAPABILITIES[input.provider];
  const text = input.text.trim();
  if (input.mode === "improve" && !text) {
    throw new ValidationError("Write a caption first; there is nothing to improve yet.");
  }
  if (input.mode === "hashtags" && !capability.fields.includes("hashtags")) {
    throw new ValidationError(`${PROVIDER_LABEL[input.provider]} does not use hashtags.`);
  }
  await guardBudget(actor, "assistSocialCopy");

  const item = await socialItem(actor, input.contentItemId);
  if (input.mode !== "improve" && !text && !item.brief?.trim() && !item.title.trim()) {
    throw new ValidationError("Write the brief or a caption first — a suggestion needs something to go on.");
  }

  const context = await socialContext(item.client, item.pillarId);
  const limit = capability.captionLimit ?? 2_000;
  const buttons = capability.callToActionOptions ?? null;

  const ask =
    input.mode === "improve"
      ? `Improve this ${PROVIDER_LABEL[input.provider]} caption. Stay under ${limit} characters, keep its facts, add none.`
      : input.mode === "hashtags"
        ? `Suggest up to 12 hashtags for this ${PROVIDER_LABEL[input.provider]} post.`
        : buttons
          ? `Choose the one button that best fits this post, from: ${buttons.map((b) => `${b.value} (${b.label})`).join(", ")}.`
          : `Write one closing call-to-action line for this ${PROVIDER_LABEL[input.provider]} post, under 150 characters, in the brand's call-to-action style.`;

  const schema =
    input.mode === "improve"
      ? { type: "object", properties: { caption: { type: "string" } }, required: ["caption"] }
      : input.mode === "hashtags"
        ? { type: "object", properties: { hashtags: { type: "array", items: { type: "string" } } }, required: ["hashtags"] }
        : buttons
          ? { type: "object", properties: { callToAction: { type: "string", enum: buttons.map((b) => b.value) } }, required: ["callToAction"] }
          : { type: "object", properties: { ctaLine: { type: "string" } }, required: ["ctaLine"] };

  const result = await (await ai()).completeStructured<SocialAssistDraft>({
    task: "assistSocialCopy",
    system: SYSTEM_PROMPTS.assistSocialCopy,
    prompt: [
      factBlock({ ...context.facts, campaign: item.campaign?.name, platform: PROVIDER_LABEL[input.provider] }),
      forbiddenRule(context.forbidden),
      "",
      `The idea: ${item.title}`,
      item.brief?.trim() ? `The brief: ${item.brief.trim()}` : "",
      text ? `The caption so far:\n${text}` : "",
      input.instruction?.trim() ? `Also: ${input.instruction.trim()}` : "",
      "",
      ask,
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: input.mode === "improve" ? 900 : 300,
    schema,
    parse: (value) => {
      const shape = value as { caption?: unknown; hashtags?: unknown; callToAction?: unknown; ctaLine?: unknown };
      if (input.mode === "improve") {
        if (typeof shape.caption !== "string" || !shape.caption.trim()) throw new Error("No caption came back.");
        const caption = shape.caption.trim().slice(0, limit);
        return { caption, forbiddenUsed: forbiddenWordsIn(caption, context.forbidden) };
      }
      if (input.mode === "hashtags") {
        const hashtags = withBrandTags(normaliseTags(shape.hashtags), context.brandHashtags);
        return { hashtags, forbiddenUsed: forbiddenWordsIn(hashtags.join(" "), context.forbidden) };
      }
      if (buttons) {
        // Only one of the platform's own buttons, whatever came back.
        const chosen = buttons.find((b) => b.value === shape.callToAction);
        if (!chosen) throw new Error("No valid button came back.");
        return { callToAction: chosen.value, forbiddenUsed: [] };
      }
      if (typeof shape.ctaLine !== "string" || !shape.ctaLine.trim()) throw new Error("No line came back.");
      const ctaLine = shape.ctaLine.trim().slice(0, 200);
      return { ctaLine, forbiddenUsed: forbiddenWordsIn(ctaLine, context.forbidden) };
    },
  });

  await auditCall(
    actor,
    "assistSocialCopy",
    { type: "ContentCalendarItem", id: input.contentItemId },
    result.usage,
    result.model,
  );
  return { data: result.data, generated: true, model: result.model, task: "assistSocialCopy" };
}

// ---------------------------------------------------------------------------
// Social: repurposing an article
// ---------------------------------------------------------------------------

export type RepurposeSource =
  | { kind: "blog"; blogPostId: string }
  | { kind: "text"; title: string; text: string; url: string | null };

export type RepurposedVersion = {
  provider: SocialProvider;
  type: string;
  caption: string;
  headline: string | null;
  hashtags: string[];
  linkUrl: string | null;
  forbiddenUsed: string[];
};

export type RepurposeDraft = {
  title: string;
  sourceUrl: string | null;
  sourceBlogPostId: string | null;
  versions: RepurposedVersion[];
  carouselSlides: string[] | null;
  videoScript: string | null;
};

const ARTICLE_MIN_CHARS = 200;
const ARTICLE_MAX_CHARS = 20_000;

/** A published article's own words, as plain text. Drafts and unknown ids are refused. */
async function articleFrom(source: RepurposeSource) {
  if (source.kind === "text") {
    return {
      title: source.title.trim(),
      text: source.text.trim().slice(0, ARTICLE_MAX_CHARS),
      url: source.url,
      blogPostId: null as string | null,
    };
  }
  const post = await db.blogPost.findFirst({
    where: { id: source.blogPostId, status: "PUBLISHED" },
    select: { id: true, slug: true, title: true, excerpt: true, body: true },
  });
  if (!post) throw new NotFoundError("That article is not published.");
  const body = parseBody(postBodySchema, post.body);
  const text = [
    post.excerpt,
    body.lead,
    ...(body.sections ?? []).map((section) => `${section.heading}\n${inlineToText(section.text)}`),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    title: post.title,
    text: text.slice(0, ARTICLE_MAX_CHARS),
    url: `${siteOrigin()}/blog/${post.slug}`,
    blogPostId: post.id,
  };
}

/**
 * One article into a post for each chosen platform — plus, if asked, carousel
 * slide copy and a short video script.
 *
 * Every word comes from the article; the prompt says so and the rules that
 * forbid invented numbers apply. Each platform gets its own post, bounded by
 * that platform's capabilities and fitted to its limit the way the editor
 * counts it. Returns a draft: the caller decides whether it becomes content,
 * and if it does, each version is marked as an AI draft until a person saves
 * it.
 */
export async function repurposeContent(
  actor: Actor,
  input: {
    clientId: string;
    pillarId: string | null;
    source: RepurposeSource;
    targets: { provider: SocialProvider; type: string }[];
    carousel: boolean;
    videoScript: boolean;
    instruction: string | null;
  },
): Promise<Draft<RepurposeDraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "social.create");
  const scope = await resolveClientScope(actor, input.clientId);

  const targets = input.targets.filter(
    (target, index, all) => all.findIndex((t) => t.provider === target.provider) === index,
  );
  if (targets.length === 0) throw new ValidationError("Choose at least one platform.");
  for (const target of targets) {
    if (!(CAPABILITIES[target.provider].postTypes as readonly string[]).includes(target.type)) {
      throw new ValidationError(`${PROVIDER_LABEL[target.provider]} cannot publish that format.`);
    }
  }

  const article = await articleFrom(input.source);
  if (!article.title) throw new ValidationError("The article needs a title.");
  if (article.text.length < ARTICLE_MIN_CHARS) {
    throw new ValidationError("That article is too short to repurpose — paste the full text.");
  }
  await guardBudget(actor, "repurposeContent");

  const client = await db.client.findUniqueOrThrow({
    where: { id: scope },
    select: { id: true, name: true, industry: true },
  });
  if (input.pillarId) await assertPillarForClient(input.pillarId, scope);
  const context = await socialContext(client, input.pillarId);

  const platformLines = targets.map((target) => {
    const capability = CAPABILITIES[target.provider];
    return `- ${target.provider} (${PROVIDER_LABEL[target.provider]}), ${target.type.toLowerCase().replace(/_/g, " ")}: caption under ${capability.captionLimit ?? 2000} characters${capability.fields.includes("headline") ? ", with a headline" : ", headline null"}${capability.fields.includes("hashtags") ? ", with hashtags" : ", no hashtags"}.`;
  });

  const result = await (await ai()).completeStructured<{
    versions: { provider: string; caption: string; headline: string | null; hashtags: string[] }[];
    carouselSlides: string[] | null;
    videoScript: string | null;
  }>({
    task: "repurposeContent",
    system: SYSTEM_PROMPTS.repurposeContent,
    prompt: [
      factBlock(context.facts),
      forbiddenRule(context.forbidden),
      "",
      `The article: ${article.title}`,
      article.text,
      "",
      "Write one post for each of these platforms:",
      ...platformLines,
      input.carousel ? "Also write carouselSlides: 4 to 8 short slide texts that walk through the article's main points." : "Return carouselSlides as null.",
      input.videoScript ? "Also write videoScript: a 30 to 60 second script for a short vertical video, in plain lines." : "Return videoScript as null.",
      input.instruction?.trim() ? `Also: ${input.instruction.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 3_000,
    schema: {
      type: "object",
      properties: {
        versions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              provider: { type: "string", enum: targets.map((t) => t.provider) },
              caption: { type: "string" },
              headline: { type: ["string", "null"] },
              hashtags: { type: "array", items: { type: "string" } },
            },
            required: ["provider", "caption", "headline", "hashtags"],
          },
        },
        carouselSlides: { type: ["array", "null"], items: { type: "string" } },
        videoScript: { type: ["string", "null"] },
      },
      required: ["versions", "carouselSlides", "videoScript"],
    },
    parse: (value) => {
      const shape = value as { versions?: unknown; carouselSlides?: unknown; videoScript?: unknown };
      if (!Array.isArray(shape.versions)) throw new Error("No versions came back.");
      return {
        versions: shape.versions as { provider: string; caption: string; headline: string | null; hashtags: string[] }[],
        carouselSlides: Array.isArray(shape.carouselSlides)
          ? (shape.carouselSlides as unknown[]).filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().slice(0, 300)).slice(0, 10)
          : null,
        videoScript: typeof shape.videoScript === "string" && shape.videoScript.trim() ? shape.videoScript.trim().slice(0, 3_000) : null,
      };
    },
  });

  // Each version bounded by its own platform, whatever came back: fields the
  // platform lacks are dropped, the caption is fitted the way the editor
  // counts, and a platform the model skipped is simply missing — not invented.
  const versions: RepurposedVersion[] = [];
  for (const target of targets) {
    const raw = result.data.versions.find((v) => v.provider === target.provider);
    if (!raw || typeof raw.caption !== "string" || !raw.caption.trim()) continue;
    const capability = CAPABILITIES[target.provider];
    const hashtags = capability.fields.includes("hashtags")
      ? withBrandTags(normaliseTags(raw.hashtags), context.brandHashtags)
      : [];
    const linkUrl = capability.fields.includes("linkUrl") ? article.url : null;
    const headline =
      capability.fields.includes("headline") && typeof raw.headline === "string" && raw.headline.trim()
        ? raw.headline.trim().slice(0, 100)
        : null;
    const caption = fitCaption(target.provider, raw.caption.trim(), hashtags, linkUrl);
    versions.push({
      provider: target.provider,
      type: target.type,
      caption,
      headline,
      hashtags,
      linkUrl,
      forbiddenUsed: forbiddenWordsIn([caption, headline ?? "", hashtags.join(" ")].join("\n"), context.forbidden),
    });
  }
  if (versions.length === 0) throw new ValidationError("The assistant returned nothing usable. Try again.");

  await auditCall(actor, "repurposeContent", { type: "Client", id: scope }, result.usage, result.model);

  return {
    data: {
      title: article.title,
      sourceUrl: article.url,
      sourceBlogPostId: article.blogPostId,
      versions,
      carouselSlides: input.carousel ? result.data.carouselSlides : null,
      videoScript: input.videoScript ? result.data.videoScript : null,
    },
    generated: true,
    model: result.model,
    task: "repurposeContent",
  };
}

// ---------------------------------------------------------------------------
// Social: content ideas
// ---------------------------------------------------------------------------

export type ContentIdeaDraft = {
  ideas: { title: string; brief: string; pillarId: string | null; pillarName: string | null }[];
};

/**
 * Suggest ideas for a client's calendar, optionally for one campaign or
 * pillar. Told what the client does, their strategy's objectives, their
 * pillars and their recent ideas (so it does not repeat them). Creates
 * nothing: a person picks which ideas become content.
 */
export async function generateContentIdeas(
  actor: Actor,
  input: {
    clientId: string;
    campaignId: string | null;
    pillarId: string | null;
    count: number;
    instruction: string | null;
  },
): Promise<Draft<ContentIdeaDraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "social.create");
  const scope = await resolveClientScope(actor, input.clientId);
  const count = Math.min(10, Math.max(3, Math.round(input.count)));

  const [client, campaign, pillars, strategy, recent] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: scope }, select: { id: true, name: true, industry: true } }),
    input.campaignId
      ? db.campaign.findFirst({
          where: { id: input.campaignId, clientId: scope },
          select: { name: true, objective: true, startsAt: true, endsAt: true },
        })
      : null,
    db.contentPillar.findMany({
      where: { clientId: scope, archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, name: true, description: true },
    }),
    db.socialStrategy.findUnique({ where: { clientId: scope }, select: { objectives: true, campaignGoals: true } }),
    db.contentCalendarItem.findMany({
      where: { clientId: scope },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { title: true },
    }),
  ]);
  if (input.campaignId && !campaign) throw new ValidationError("That campaign does not belong to this client.");
  if (input.pillarId && !pillars.some((p) => p.id === input.pillarId)) {
    throw new ValidationError("That content pillar does not belong to this client.");
  }
  await guardBudget(actor, "generateContentIdeas");

  const context = await socialContext(client, input.pillarId);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const result = await (await ai()).completeStructured<{ ideas: { title: string; brief: string; pillar: string | null }[] }>({
    task: "generateContentIdeas",
    system: SYSTEM_PROMPTS.generateContentIdeas,
    prompt: [
      factBlock({
        ...context.facts,
        campaign: campaign ? `${campaign.name}${campaign.objective ? ` — ${campaign.objective}` : ""}` : null,
        "campaign dates": campaign ? `${day(campaign.startsAt)} to ${campaign.endsAt ? day(campaign.endsAt) : "open"}` : null,
        objectives: strategy?.objectives,
        "campaign goals": strategy?.campaignGoals,
      }),
      forbiddenRule(context.forbidden),
      pillars.length > 0
        ? `The client's content pillars:\n${pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n")}`
        : "",
      recent.length > 0 ? `Recent ideas, not to repeat:\n${recent.map((r) => `- ${r.title}`).join("\n")}` : "",
      input.instruction?.trim() ? `Also: ${input.instruction.trim()}` : "",
      "",
      `Suggest ${count} ideas.${pillars.length > 0 ? " Give each the name of the pillar it serves, or null." : " Return pillar as null."}`,
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 2_000,
    schema: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              brief: { type: "string" },
              pillar: { type: ["string", "null"] },
            },
            required: ["title", "brief", "pillar"],
          },
        },
      },
      required: ["ideas"],
    },
    parse: (value) => {
      const shape = value as { ideas?: unknown };
      if (!Array.isArray(shape.ideas)) throw new Error("No ideas came back.");
      return { ideas: shape.ideas as { title: string; brief: string; pillar: string | null }[] };
    },
  });

  const seen = new Set(recent.map((r) => r.title.trim().toLowerCase()));
  const ideas: ContentIdeaDraft["ideas"] = [];
  for (const raw of result.data.ideas) {
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
    const brief = typeof raw.brief === "string" ? raw.brief.trim().slice(0, 2_000) : "";
    if (title.length < 2 || !brief || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    // A pillar only by exact name, from this client's own list — never one
    // the model made up. The requested pillar wins when one was asked for.
    const pillar = input.pillarId
      ? pillars.find((p) => p.id === input.pillarId)
      : pillars.find((p) => typeof raw.pillar === "string" && p.name.toLowerCase() === raw.pillar.trim().toLowerCase());
    ideas.push({ title, brief, pillarId: pillar?.id ?? null, pillarName: pillar?.name ?? null });
    if (ideas.length === count) break;
  }

  await auditCall(actor, "generateContentIdeas", { type: "Client", id: scope }, result.usage, result.model);
  return { data: { ideas }, generated: true, model: result.model, task: "generateContentIdeas" };
}

export type MetaDraft = { metaTitle: string; metaDescription: string };

/**
 * Draft the search-result title and description from what the page says.
 *
 * Built from the page's own visible text, so the description describes the
 * page rather than the brief somebody wrote about it. A page with nothing on it
 * is refused rather than described: there is nothing to summarise, and a
 * plausible summary of an empty page is the worst possible output.
 */
export async function generateMeta(
  actor: Actor,
  input: GenerateMetaInput,
): Promise<Draft<MetaDraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "seo.edit");
  await guardBudget(actor, "generateMeta");

  const page = await db.page.findFirst({
    where: { id: input.pageId, deletedAt: null },
    select: {
      title: true,
      slug: true,
      sections: {
        where: { isVisible: true },
        orderBy: { order: "asc" },
        select: { type: true, content: true },
      },
    },
  });
  if (!page) throw new NotFoundError("That page does not exist.");

  const body = page.sections
    .map((section) => sectionText(section.type, section.content).text)
    .join(" ")
    .trim();

  if (wordCount(body) < 20) {
    throw new ValidationError(
      "This page has too little on it to describe. Write the page first — a description of an empty page is a guess.",
    );
  }

  const result = await (await ai()).completeStructured<MetaDraft>({
    task: "generateMeta",
    system: SYSTEM_PROMPTS.generateMeta,
    prompt: [
      factBlock({ page: page.title, address: `/${page.slug}` }),
      "",
      // Bounded: a very long page costs a very long call, and the first few
      // hundred words are what a description is drawn from anyway.
      `What the page says:\n${body.slice(0, 4_000)}`,
    ].join("\n"),
    maxTokens: 500,
    schema: {
      type: "object",
      properties: {
        metaTitle: { type: "string" },
        metaDescription: { type: "string" },
      },
      required: ["metaTitle", "metaDescription"],
    },
    parse: (value) => {
      const shape = value as { metaTitle?: unknown; metaDescription?: unknown };
      if (typeof shape.metaTitle !== "string" || typeof shape.metaDescription !== "string") {
        throw new Error("Incomplete meta draft.");
      }
      return { metaTitle: shape.metaTitle.trim(), metaDescription: shape.metaDescription.trim() };
    },
  });

  await auditCall(
    actor,
    "generateMeta",
    { type: "Page", id: input.pageId },
    result.usage,
    result.model,
  );

  return { data: result.data, generated: true, model: result.model, task: "generateMeta" };
}

// ---------------------------------------------------------------------------
// Social: planning a month
// ---------------------------------------------------------------------------

/** Most posts one plan may hold: enough for a busy month, bounded for the model. */
export const PLAN_MAX_POSTS = 90;

export type PlannedItem = {
  /** `YYYY-MM-DD`, within the month. */
  day: string;
  title: string;
  brief: string;
  pillarId: string | null;
  pillarName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  occasionId: string | null;
  occasionName: string | null;
  versions: { provider: SocialProvider; type: string }[];
};

export type MonthPlanDraft = {
  month: string;
  items: PlannedItem[];
  /** Posts asked for per platform — computed from the weekly frequency, not by the model. */
  targets: Partial<Record<SocialProvider, number>>;
  /** Posts the plan actually holds per platform. Short of a target is shown as short. */
  planned: Partial<Record<SocialProvider, number>>;
};

/**
 * Plan a month: which idea goes out when, where, and in what format.
 *
 * The **counts are arithmetic, not the model's**: posts per week times the
 * days in the month over seven, per platform. The model is given those counts,
 * the client's pillars, the campaigns running that month and the occasions
 * the client opted in to (with their real dates), and fills the slots. What
 * comes back is checked item by item — dates inside the month, only the
 * platforms and formats asked for, never more posts than the target, pillars,
 * campaigns and occasions only by exact name from what it was given — and a
 * shortfall is reported, not padded.
 *
 * A draft: nothing is created until a person reviews the plan and chooses
 * which items to keep (`createPlannedContent`).
 */
export async function planContentMonth(
  actor: Actor,
  input: {
    clientId: string;
    month: string;
    /** Posts per week, per platform. */
    frequency: Partial<Record<SocialProvider, number>>;
    pillarIds: string[];
    campaignIds: string[];
    occasionIds: string[];
    instruction: string | null;
  },
): Promise<Draft<MonthPlanDraft>> {
  requirePermission(actor, "ai.use");
  requirePermission(actor, "social.create");
  const scope = await resolveClientScope(actor, input.clientId);

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new ValidationError("Choose a month to plan.");
  const [year, monthNumber] = input.month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const firstDay = `${input.month}-01`;
  const lastDay = `${input.month}-${String(daysInMonth).padStart(2, "0")}`;

  // The counts: arithmetic, so "16 Instagram posts" means 16, whatever the model thinks.
  const targets: Partial<Record<SocialProvider, number>> = {};
  for (const [provider, perWeek] of Object.entries(input.frequency) as [SocialProvider, number][]) {
    if (!CAPABILITIES[provider] || !Number.isFinite(perWeek) || perWeek <= 0) continue;
    const count = Math.round((perWeek * daysInMonth) / 7);
    if (count > 0) targets[provider] = count;
  }
  const providers = Object.keys(targets) as SocialProvider[];
  if (providers.length === 0) throw new ValidationError("Set how often to post on at least one platform.");
  const total = providers.reduce((sum, p) => sum + targets[p]!, 0);
  if (total > PLAN_MAX_POSTS) {
    throw new ValidationError(`That is ${total} posts; plan at most ${PLAN_MAX_POSTS} in one go.`);
  }

  const monthStart = new Date(`${firstDay}T00:00:00Z`);
  const [client, pillars, campaigns, strategy, recent, occasionDays] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: scope }, select: { id: true, name: true, industry: true } }),
    db.contentPillar.findMany({
      where: { clientId: scope, archivedAt: null, ...(input.pillarIds.length ? { id: { in: input.pillarIds } } : {}) },
      orderBy: { position: "asc" },
      select: { id: true, name: true, description: true },
    }),
    input.campaignIds.length
      ? db.campaign.findMany({
          where: { id: { in: input.campaignIds }, clientId: scope },
          select: { id: true, name: true, objective: true, startsAt: true, endsAt: true },
        })
      : Promise.resolve([]),
    db.socialStrategy.findUnique({ where: { clientId: scope }, select: { objectives: true, campaignGoals: true } }),
    db.contentCalendarItem.findMany({
      where: { clientId: scope, createdAt: { gte: new Date(monthStart.getTime() - 90 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { title: true },
    }),
    occasionsBetween(actor, scope, firstDay, lastDay),
  ]);
  if (campaigns.length !== new Set(input.campaignIds).size) {
    throw new ValidationError("A campaign chosen does not belong to this client.");
  }
  // Only occasions this client really has in this month, and only those chosen.
  const occasions = occasionDays.filter((o) => input.occasionIds.includes(o.occasionId));
  await guardBudget(actor, "planContentMonth");

  const context = await socialContext(client, null);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const formats = (provider: SocialProvider) => CAPABILITIES[provider].postTypes as readonly string[];

  const result = await (await ai()).completeStructured<{
    items: { date: string; title: string; brief: string; pillar: string | null; campaign: string | null; occasion: string | null; versions: { provider: string; type: string }[] }[];
  }>({
    task: "planContentMonth",
    system: SYSTEM_PROMPTS.planContentMonth,
    prompt: [
      factBlock({ ...context.facts, objectives: strategy?.objectives, "campaign goals": strategy?.campaignGoals }),
      forbiddenRule(context.forbidden),
      "",
      `Plan ${input.month} (${firstDay} to ${lastDay}).`,
      "Posts per platform, exactly:",
      ...providers.map((p) => `- ${p} (${PROVIDER_LABEL[p]}): ${targets[p]} posts; formats: ${formats(p).join(", ")}`),
      pillars.length ? `Content pillars:\n${pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n")}` : "",
      campaigns.length
        ? `Campaigns running:\n${campaigns.map((c) => `- ${c.name} (${day(c.startsAt)} to ${c.endsAt ? day(c.endsAt) : "open"})${c.objective ? `: ${c.objective}` : ""}`).join("\n")}`
        : "",
      occasions.length
        ? `Occasions the client marks, on these dates only:\n${occasions.map((o) => `- ${o.name}: ${o.day}`).join("\n")}`
        : "No occasions this month — do not add any.",
      recent.length ? `Recent ideas, not to repeat:\n${recent.map((r) => `- ${r.title}`).join("\n")}` : "",
      input.instruction?.trim() ? `Also: ${input.instruction.trim()}` : "",
      "",
      "Each item: a date, a title, a brief, the pillar, campaign and occasion it serves by name (or null), and its platform versions with formats.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 8_000,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string" },
              title: { type: "string" },
              brief: { type: "string" },
              pillar: { type: ["string", "null"] },
              campaign: { type: ["string", "null"] },
              occasion: { type: ["string", "null"] },
              versions: {
                type: "array",
                items: {
                  type: "object",
                  properties: { provider: { type: "string", enum: providers }, type: { type: "string" } },
                  required: ["provider", "type"],
                },
              },
            },
            required: ["date", "title", "brief", "pillar", "campaign", "occasion", "versions"],
          },
        },
      },
      required: ["items"],
    },
    parse: (value) => {
      const shape = value as { items?: unknown };
      if (!Array.isArray(shape.items)) throw new Error("No plan came back.");
      return { items: shape.items as never };
    },
  });

  // Checked item by item. Nothing the model says is kept unless it fits what
  // was asked: the month, the platforms, the formats, the counts, and names
  // from the lists it was given.
  const byName = <T extends { name: string }>(list: readonly T[], name: unknown) =>
    typeof name === "string" ? list.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase()) : undefined;
  const used: Partial<Record<SocialProvider, number>> = {};
  const seen = new Set(recent.map((r) => r.title.trim().toLowerCase()));
  const items: PlannedItem[] = [];

  for (const raw of result.data.items) {
    const date = typeof raw.date === "string" ? raw.date.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < firstDay || date > lastDay) continue;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
    const brief = typeof raw.brief === "string" ? raw.brief.trim().slice(0, 2_000) : "";
    if (title.length < 2 || !brief || seen.has(title.toLowerCase())) continue;

    const versions: PlannedItem["versions"] = [];
    for (const version of Array.isArray(raw.versions) ? raw.versions : []) {
      const provider = version?.provider as SocialProvider;
      if (!providers.includes(provider) || versions.some((v) => v.provider === provider)) continue;
      if (!formats(provider).includes(version.type)) continue;
      if ((used[provider] ?? 0) >= targets[provider]!) continue;
      used[provider] = (used[provider] ?? 0) + 1;
      versions.push({ provider, type: version.type });
    }
    if (versions.length === 0) continue;

    // An occasion is kept only on its own date: a Diwali post on the 2nd of
    // the month is a Diwali post on the wrong day.
    const occasion = occasions.find((o) => byName([o], raw.occasion) && o.day === date);
    const pillar = byName(pillars, raw.pillar);
    const campaign = byName(campaigns, raw.campaign);
    seen.add(title.toLowerCase());
    items.push({
      day: date,
      title,
      brief,
      pillarId: pillar?.id ?? null,
      pillarName: pillar?.name ?? null,
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
      occasionId: occasion?.occasionId ?? null,
      occasionName: occasion?.name ?? null,
      versions,
    });
  }
  items.sort((a, b) => a.day.localeCompare(b.day));

  await auditCall(actor, "planContentMonth", { type: "Client", id: scope }, result.usage, result.model);
  return {
    data: { month: input.month, items, targets, planned: used },
    generated: true,
    model: result.model,
    task: "planContentMonth",
  };
}
