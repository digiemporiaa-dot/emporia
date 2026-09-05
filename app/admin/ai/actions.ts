"use server";

import { requireActor } from "@/lib/actor";
import * as assist from "@/lib/services/ai.service";
import {
  contentDraftSchema,
  crmAnalysisSchema,
  proposalDraftSchema,
  scoreLeadSchema,
  seoDraftSchema,
  summarizeLeadSchema,
} from "@/lib/validation/ai";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";
import type { LeadAssessment, LeadSummary, SEODraft } from "@/lib/validation/ai";

const actionLog = log("ai");

/**
 * The assist actions.
 *
 * None of them revalidates a path or writes anything: a draft changes nothing
 * until a person saves it through the ordinary editor for that record.
 */

type Draft<T> = { data: T; generated: true; model: string };

function fail(error: unknown, what: string) {
  actionLog.warn({ err: error }, `${what} refused`);
  return toActionFailure(error);
}

export async function summarizeLeadAction(
  leadId: string,
): Promise<ActionResult<Draft<LeadSummary>>> {
  try {
    const actor = await requireActor();
    const parsed = summarizeLeadSchema.safeParse({ leadId });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a lead." };
    }

    const draft = await assist.summarizeLead(actor, parsed.data.leadId);
    return { ok: true, data: { data: draft.data, generated: true, model: draft.model } };
  } catch (error) {
    return fail(error, "summarizeLead");
  }
}

export async function assessLeadAction(
  leadId: string,
): Promise<ActionResult<Draft<LeadAssessment>>> {
  try {
    const actor = await requireActor();
    const parsed = scoreLeadSchema.safeParse({ leadId });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a lead." };
    }

    const draft = await assist.scoreLead(actor, parsed.data.leadId);
    return { ok: true, data: { data: draft.data, generated: true, model: draft.model } };
  } catch (error) {
    return fail(error, "scoreLead");
  }
}

export async function draftProposalAction(
  proposalId: string,
  brief: string,
): Promise<ActionResult<Draft<string>>> {
  try {
    const actor = await requireActor();
    const parsed = proposalDraftSchema.safeParse({ proposalId, brief: brief || null });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the input." };
    }

    const draft = await assist.generateProposal(actor, parsed.data);
    return { ok: true, data: { data: draft.data, generated: true, model: draft.model } };
  } catch (error) {
    return fail(error, "generateProposal");
  }
}

export async function draftContentAction(
  formData: FormData,
): Promise<ActionResult<Draft<string>>> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());
    const parsed = contentDraftSchema.safeParse({
      ...raw,
      clientId: raw["clientId"] || null,
      notes: raw["notes"] || null,
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    const draft = await assist.generateContent(actor, parsed.data);
    return { ok: true, data: { data: draft.data, generated: true, model: draft.model } };
  } catch (error) {
    return fail(error, "generateContent");
  }
}

export async function draftSEOAction(formData: FormData): Promise<ActionResult<Draft<SEODraft>>> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());
    const parsed = seoDraftSchema.safeParse({
      ...raw,
      cityId: raw["cityId"] || null,
      notes: raw["notes"] || null,
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    const draft = await assist.generateSEOContent(actor, parsed.data);
    return { ok: true, data: { data: draft.data, generated: true, model: draft.model } };
  } catch (error) {
    return fail(error, "generateSEOContent");
  }
}

export async function analyzeCRMAction(
  range: string,
): Promise<ActionResult<Draft<assist.CRMAnalysis>>> {
  try {
    const actor = await requireActor();
    const parsed = crmAnalysisSchema.safeParse({ range });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a reporting period." };
    }

    const draft = await assist.analyzeCRM(actor, parsed.data);
    return { ok: true, data: { data: draft.data, generated: true, model: draft.model } };
  } catch (error) {
    return fail(error, "analyzeCRM");
  }
}
