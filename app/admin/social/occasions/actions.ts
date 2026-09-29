"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import {
  addOccasionDate,
  createOccasion,
  removeOccasionDate,
  setOccasionArchived,
  updateOccasion,
} from "@/lib/services/social-occasion.service";
import { isoDay, occasionSchema } from "@/lib/validation/social-occasion";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Occasion writes, for the library and for a client's own occasions alike.
 * `clientId` null means the library; the service decides which permission
 * that needs, and whether the actor may reach the client at all.
 */

const actionLog = log("social");
const id = z.string().min(1).max(40);

function refresh(clientId: string | null) {
  revalidatePath("/admin/social/occasions");
  if (clientId) revalidatePath(`/admin/clients/${clientId}/social/brand`);
}

function invalid(error: z.ZodError): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: error.issues[0]?.message ?? "Check those details." };
}

export async function saveOccasionAction(input: {
  id: string | null;
  clientId: string | null;
  occasion: unknown;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = occasionSchema.safeParse(input.occasion);
    if (!parsed.success) return invalid(parsed.error);
    const clientId = input.clientId ? id.parse(input.clientId) : null;
    const occasion = input.id
      ? await updateOccasion(actor, id.parse(input.id), parsed.data)
      : await createOccasion(actor, clientId, parsed.data);
    refresh(occasion.clientId);
    return { ok: true, data: { id: occasion.id } };
  } catch (error) {
    actionLog.error({ err: error }, "saving an occasion failed");
    return toActionFailure(error);
  }
}

export async function archiveOccasionAction(input: {
  id: string;
  archived: boolean;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ id, archived: z.boolean() }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const occasion = await setOccasionArchived(actor, parsed.data.id, parsed.data.archived);
    refresh(occasion.clientId);
    return { ok: true, data: { id: occasion.id } };
  } catch (error) {
    actionLog.error({ err: error }, "archiving an occasion failed");
    return toActionFailure(error);
  }
}

export async function addOccasionDateAction(input: {
  id: string;
  day: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ id, day: isoDay }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const row = await addOccasionDate(actor, parsed.data.id, parsed.data.day);
    refresh(null);
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    actionLog.error({ err: error }, "adding an occasion date failed");
    return toActionFailure(error);
  }
}

export async function removeOccasionDateAction(input: { dateId: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ dateId: id }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await removeOccasionDate(actor, parsed.data.dateId);
    refresh(null);
    return { ok: true, data: { id: parsed.data.dateId } };
  } catch (error) {
    actionLog.error({ err: error }, "removing an occasion date failed");
    return toActionFailure(error);
  }
}
