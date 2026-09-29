"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { planContentMonth, type MonthPlanDraft } from "@/lib/services/ai.service";
import { createPlannedContent } from "@/lib/services/social-planner.service";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { isoDay, isoMonth } from "@/lib/validation/social-occasion";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * The month planner: a draft plan from the AI, then — after a person has read
 * it and kept what they want — the kept items as draft content. Nothing is
 * written by the first call; the second writes only what came back ticked.
 */

const actionLog = log("social");
const id = z.string().min(1).max(40);
const PROVIDER = z.enum(SOCIAL_PROVIDERS);

const planSchema = z.object({
  clientId: id,
  month: isoMonth,
  frequency: z.partialRecord(PROVIDER, z.coerce.number().int().min(0).max(21)),
  pillarIds: z.array(id).max(20).default([]),
  campaignIds: z.array(id).max(20).default([]),
  occasionIds: z.array(id).max(40).default([]),
  instruction: z.string().trim().max(500).nullable().default(null),
});

export async function planMonthAction(input: unknown): Promise<ActionResult<MonthPlanDraft & { model: string }>> {
  try {
    const actor = await requireActor();
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check those details." };
    }
    const draft = await planContentMonth(actor, { ...parsed.data, instruction: parsed.data.instruction || null });
    return { ok: true, data: { ...draft.data, model: draft.model } };
  } catch (error) {
    actionLog.warn({ err: error }, "planning a month failed");
    return toActionFailure(error);
  }
}

const createSchema = z.object({
  clientId: id,
  projectId: z.string().min(1, "Choose a project.").max(40),
  month: isoMonth,
  items: z
    .array(
      z.object({
        day: isoDay,
        title: z.string().trim().min(2).max(200),
        brief: z.string().trim().max(2_000).nullable().default(null),
        pillarId: id.nullable().default(null),
        campaignId: id.nullable().default(null),
        occasionId: id.nullable().default(null),
        versions: z
          .array(z.object({ provider: PROVIDER, type: z.string().min(1).max(40) }))
          .min(1)
          .max(SOCIAL_PROVIDERS.length),
      }),
    )
    .min(1, "Keep at least one item from the plan.")
    .max(90),
});

export async function createPlanAction(input: unknown): Promise<ActionResult<{ created: number }>> {
  try {
    const actor = await requireActor();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check those details." };
    }
    const result = await createPlannedContent(actor, parsed.data);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/calendar`);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/content`);
    return { ok: true, data: result };
  } catch (error) {
    actionLog.error({ err: error }, "creating a planned month failed");
    return toActionFailure(error);
  }
}
