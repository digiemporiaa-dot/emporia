"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import {
  createPillar,
  movePillar,
  saveBrandProfile,
  saveStrategy,
  setPillarArchived,
  updatePillar,
} from "@/lib/services/social-brand.service";
import { setClientOccasion } from "@/lib/services/social-occasion.service";
import { brandProfileSchema, pillarSchema, strategySchema } from "@/lib/validation/social-brand";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * The brand & strategy screen's writes. Each validates, then hands to the
 * service, which checks permission and client scope itself — the client id
 * here only says which client's kit to open, never grants access to it.
 */

const actionLog = log("social");
const clientRef = z.string().min(1).max(40);

function refresh(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}/social/brand`);
}

function invalid(error: z.ZodError): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: error.issues[0]?.message ?? "Check those details." };
}

export async function saveBrandProfileAction(input: {
  clientId: string;
  profile: unknown;
}): Promise<ActionResult<{ saved: true }>> {
  try {
    const actor = await requireActor();
    const clientId = clientRef.parse(input.clientId);
    const parsed = brandProfileSchema.safeParse(input.profile);
    if (!parsed.success) return invalid(parsed.error);
    await saveBrandProfile(actor, clientId, parsed.data);
    refresh(clientId);
    return { ok: true, data: { saved: true } };
  } catch (error) {
    actionLog.error({ err: error }, "saving a brand profile failed");
    return toActionFailure(error);
  }
}

export async function saveStrategyAction(input: {
  clientId: string;
  strategy: unknown;
}): Promise<ActionResult<{ saved: true }>> {
  try {
    const actor = await requireActor();
    const clientId = clientRef.parse(input.clientId);
    const parsed = strategySchema.safeParse(input.strategy);
    if (!parsed.success) return invalid(parsed.error);
    await saveStrategy(actor, clientId, parsed.data);
    refresh(clientId);
    return { ok: true, data: { saved: true } };
  } catch (error) {
    actionLog.error({ err: error }, "saving a social strategy failed");
    return toActionFailure(error);
  }
}

export async function savePillarAction(input: {
  clientId: string;
  id: string | null;
  pillar: unknown;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const clientId = clientRef.parse(input.clientId);
    const parsed = pillarSchema.safeParse(input.pillar);
    if (!parsed.success) return invalid(parsed.error);
    const pillar = input.id
      ? await updatePillar(actor, clientRef.parse(input.id), parsed.data)
      : await createPillar(actor, clientId, parsed.data);
    refresh(clientId);
    return { ok: true, data: { id: pillar.id } };
  } catch (error) {
    actionLog.error({ err: error }, "saving a content pillar failed");
    return toActionFailure(error);
  }
}

const pillarOp = z.object({
  clientId: clientRef,
  id: clientRef,
});

export async function archivePillarAction(input: {
  clientId: string;
  id: string;
  archived: boolean;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = pillarOp.extend({ archived: z.boolean() }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await setPillarArchived(actor, parsed.data.id, parsed.data.archived);
    refresh(parsed.data.clientId);
    return { ok: true, data: { id: parsed.data.id } };
  } catch (error) {
    actionLog.error({ err: error }, "archiving a content pillar failed");
    return toActionFailure(error);
  }
}

export async function movePillarAction(input: {
  clientId: string;
  id: string;
  direction: "up" | "down";
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = pillarOp.extend({ direction: z.enum(["up", "down"]) }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await movePillar(actor, parsed.data.id, parsed.data.direction);
    refresh(parsed.data.clientId);
    return { ok: true, data: { id: parsed.data.id } };
  } catch (error) {
    actionLog.error({ err: error }, "reordering a content pillar failed");
    return toActionFailure(error);
  }
}

export async function setClientOccasionAction(input: {
  clientId: string;
  occasionId: string;
  optedIn: boolean;
}): Promise<ActionResult<{ optedIn: boolean }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ clientId: clientRef, occasionId: clientRef, optedIn: z.boolean() }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await setClientOccasion(actor, parsed.data.clientId, parsed.data.occasionId, parsed.data.optedIn);
    refresh(parsed.data.clientId);
    return { ok: true, data: { optedIn: parsed.data.optedIn } };
  } catch (error) {
    actionLog.error({ err: error }, "choosing a client occasion failed");
    return toActionFailure(error);
  }
}
