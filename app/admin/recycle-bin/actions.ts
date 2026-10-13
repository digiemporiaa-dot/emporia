"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { purgeClient, purgeLead, restoreClient, restoreLead } from "@/lib/services/recycle-bin.service";
import { binItemSchema } from "@/lib/validation/recycle-bin";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";

/**
 * The recycle bin's buttons: restore, and delete permanently. Authenticate,
 * validate, delegate — the permission and every rule live in the service.
 */

const actionLog = log("recycle-bin");

type Op = (actor: Actor, id: string) => Promise<{ id: string }>;

async function run(op: Op, input: unknown, paths: string[], what: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = binItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That item could not be identified." };
    const result = await op(actor, parsed.data.id);
    for (const path of ["/admin/recycle-bin", ...paths]) revalidatePath(path);
    return { ok: true, data: result };
  } catch (error) {
    actionLog.error({ err: error }, `${what} failed`);
    return toActionFailure(error);
  }
}

export async function restoreLeadAction(input: unknown) {
  return run(restoreLead, input, ["/admin/leads", "/admin/leads/pipeline"], "restoring a lead");
}

export async function purgeLeadAction(input: unknown) {
  return run(purgeLead, input, [], "deleting a lead permanently");
}

export async function restoreClientAction(input: unknown) {
  return run(restoreClient, input, ["/admin/clients"], "restoring a client");
}

export async function purgeClientAction(input: unknown) {
  return run(purgeClient, input, [], "deleting a client permanently");
}
