import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";

/**
 * Where sign-in lands when no explicit destination was asked for.
 *
 * Staff and client accounts share one login form, so the destination cannot be
 * decided until the session exists. This reads it once and forwards.
 */
export const dynamic = "force-dynamic";

export default async function ContinuePage() {
  const actor = await currentActor();

  if (!actor) redirect("/auth/login");
  redirect(actor.type === "CLIENT" ? "/portal" : "/admin");
}
