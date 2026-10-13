"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { requirePortalActor } from "@/lib/auth/rbac";
import {
  cancelPendingConnection,
  completePendingConnection,
} from "@/lib/services/social-pending.service";
import { PORTAL_ACCOUNTS_PATH } from "@/lib/social/oauth-state";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * The portal picker's two buttons — the admin picker's, for a client choosing
 * among their own Pages or locations. No client id is posted: the grant
 * already names the client, and the service checks it is the session's.
 *
 * `redirect()` throws, so it is called after the try/catch.
 */

const actionLog = log("social");

const chooseSchema = z.object({
  pendingId: z.string().min(1).max(40),
  externalId: z.string().min(1).max(200),
});

const cancelSchema = chooseSchema.omit({ externalId: true });

const accountsPath = (outcome: string) => `${PORTAL_ACCOUNTS_PATH}?connection=${outcome}`;

export async function choosePortalAccountAction(form: FormData): Promise<void> {
  const parsed = chooseSchema.safeParse({
    pendingId: form.get("pendingId"),
    externalId: form.get("externalId"),
  });
  if (!parsed.success) {
    const pendingId = String(form.get("pendingId") ?? "");
    redirect(`${PORTAL_ACCOUNTS_PATH}/choose/${encodeURIComponent(pendingId)}?error=pick` as Route);
  }

  const { pendingId, externalId } = parsed.data;
  let target: string;
  try {
    const actor = requirePortalActor(await requireActor());
    await completePendingConnection(actor, pendingId, externalId);
    target = accountsPath("connected");
  } catch (error) {
    if (isAppError(error) && error.code === "CONFLICT") {
      target = accountsPath("already-connected");
    } else if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) {
      target = accountsPath("expired");
    } else {
      actionLog.error({ err: error }, "a client choosing a social account failed");
      target = `${PORTAL_ACCOUNTS_PATH}/choose/${encodeURIComponent(pendingId)}?error=failed`;
    }
  }

  revalidatePath(PORTAL_ACCOUNTS_PATH);
  redirect(target as Route);
}

export async function cancelPortalChoiceAction(form: FormData): Promise<void> {
  const parsed = cancelSchema.safeParse({ pendingId: form.get("pendingId") });
  if (parsed.success) {
    try {
      const actor = requirePortalActor(await requireActor());
      await cancelPendingConnection(actor, parsed.data.pendingId);
    } catch (error) {
      // Already gone is the outcome that was wanted.
      if (!(isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN"))) {
        actionLog.error({ err: error }, "a client cancelling a social account choice failed");
      }
    }
  }
  redirect(accountsPath("cancelled") as Route);
}
