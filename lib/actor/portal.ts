import "server-only";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import type { PortalActor } from "@/lib/actor/types";

/**
 * The portal page guard.
 *
 * Returns a `PortalActor`, whose `clientId` is non-nullable, so a page cannot
 * call a client-scoped service without one. Pages redirect rather than throw:
 * a layout and its page render in parallel, and a thrown error would reach the
 * error boundary first and answer 200 (docs/ARCHITECTURE.md 12.4).
 */
export async function requirePortalActorPage(): Promise<PortalActor> {
  const actor = await currentActor();

  if (!actor) redirect("/auth/login?redirectTo=/portal");
  if (actor.type !== "CLIENT" || !actor.clientId) redirect("/admin");

  return actor as PortalActor;
}
