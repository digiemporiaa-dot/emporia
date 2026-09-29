"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import {
  cancelPendingConnection,
  completePendingConnection,
} from "@/lib/services/social-pending.service";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * The picker's two buttons. Plain form posts, so the screen needs no client
 * JavaScript at all.
 *
 * `redirect()` works by throwing, so it is called after the try/catch rather
 * than inside it — otherwise the catch would swallow the navigation.
 */

const actionLog = log("social");

const chooseSchema = z.object({
  pendingId: z.string().min(1).max(40),
  clientId: z.string().min(1).max(40),
  externalId: z.string().min(1).max(200),
});

const cancelSchema = chooseSchema.omit({ externalId: true });

function accountsPath(clientId: string, outcome: string): string {
  return `/admin/clients/${encodeURIComponent(clientId)}/social/accounts?connection=${outcome}`;
}

export async function chooseAccountAction(form: FormData): Promise<void> {
  const parsed = chooseSchema.safeParse({
    pendingId: form.get("pendingId"),
    clientId: form.get("clientId"),
    externalId: form.get("externalId"),
  });
  if (!parsed.success) {
    // Almost always "pressed Connect without picking one".
    const pendingId = String(form.get("pendingId") ?? "");
    const clientId = String(form.get("clientId") ?? "");
    redirect(
      `/admin/clients/${encodeURIComponent(clientId)}/social/accounts/choose/${encodeURIComponent(pendingId)}?error=pick` as Route,
    );
  }

  const { pendingId, clientId, externalId } = parsed.data;
  let target: string;
  try {
    const actor = await requireActor();
    await completePendingConnection(actor, pendingId, externalId);
    target = accountsPath(clientId, "connected");
  } catch (error) {
    if (isAppError(error) && error.code === "CONFLICT") {
      target = accountsPath(clientId, "already-connected");
    } else if (isAppError(error) && error.code === "NOT_FOUND") {
      target = accountsPath(clientId, "expired");
    } else {
      actionLog.error({ err: error }, "choosing a social account failed");
      target = `/admin/clients/${encodeURIComponent(clientId)}/social/accounts/choose/${encodeURIComponent(pendingId)}?error=failed`;
    }
  }

  revalidatePath(`/admin/clients/${clientId}/social/accounts`);
  redirect(target as Route);
}

export async function cancelChoiceAction(form: FormData): Promise<void> {
  const parsed = cancelSchema.safeParse({
    pendingId: form.get("pendingId"),
    clientId: form.get("clientId"),
  });
  if (!parsed.success) redirect("/admin/clients");

  try {
    const actor = await requireActor();
    await cancelPendingConnection(actor, parsed.data.pendingId);
  } catch (error) {
    // Already gone is the outcome that was wanted.
    if (!(isAppError(error) && error.code === "NOT_FOUND")) {
      actionLog.error({ err: error }, "cancelling a social account choice failed");
    }
  }
  redirect(accountsPath(parsed.data.clientId, "cancelled") as Route);
}
