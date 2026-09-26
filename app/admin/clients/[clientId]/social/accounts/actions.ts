"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { disconnectAccount, syncAccount } from "@/lib/services/social-account.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * The buttons on the accounts screen.
 *
 * Connecting is not here: it is a redirect to the provider and therefore a
 * route handler. These are the two things that act on an account we already
 * hold.
 */

const actionLog = log("social");

const idSchema = z.object({
  accountId: z.string().min(1).max(40),
  clientId: z.string().min(1).max(40),
});

export async function syncAccountAction(
  input: unknown,
): Promise<ActionResult<{ synced: boolean; message: string | null }>> {
  try {
    const actor = await requireActor();
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That account could not be identified." };
    }

    const result = await syncAccount(actor, parsed.data.accountId);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/accounts`);

    // A failed sync is a successful action with an unhappy answer: the account
    // now records why, and the screen should show that rather than a toast
    // that disappears.
    return {
      ok: true,
      data: { synced: result.ok, message: result.ok ? null : result.message },
    };
  } catch (error) {
    actionLog.error({ err: error }, "social account sync failed");
    return toActionFailure(error);
  }
}

export async function disconnectAccountAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That account could not be identified." };
    }

    const account = await disconnectAccount(actor, parsed.data.accountId);
    revalidatePath(`/admin/clients/${parsed.data.clientId}/social/accounts`);
    return { ok: true, data: { id: account.id } };
  } catch (error) {
    actionLog.error({ err: error }, "social account disconnect failed");
    return toActionFailure(error);
  }
}
