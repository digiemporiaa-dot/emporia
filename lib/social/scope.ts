import "server-only";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * Whose client is this, and may this actor act on it?
 *
 * One function, called by every social service before it reads or writes
 * anything. The brief's hardest requirement is that a `clientId` arriving from
 * a browser must never widen access, and the way to keep that true is to have
 * exactly one place that turns a requested client into an allowed one.
 *
 * Two kinds of caller:
 *
 * - **Staff** name the client they are working on. The id is checked against a
 *   real, undeleted client and nothing more — a staff member with the social
 *   permission works across the agency's clients, which is what an agency is.
 * - **Portal users** never name one. Their client comes from the session, and a
 *   request that names a different one is refused rather than quietly
 *   narrowed, because a portal user asking for another client's data is not a
 *   mistake worth being polite about.
 */
export async function resolveClientScope(
  actor: Actor,
  requested: string | null,
): Promise<string> {
  if (actor.type === "CLIENT") {
    if (!actor.clientId) throw new ForbiddenError("This account is not linked to a client.");
    if (requested && requested !== actor.clientId) {
      throw new ForbiddenError("You do not have access to that client.");
    }
    return actor.clientId;
  }

  if (!requested) throw new NotFoundError("No client was named.");

  const client = await db.client.findFirst({
    where: { id: requested, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError("That client does not exist.");
  return client.id;
}

/**
 * The `where` fragment every social list query starts from.
 *
 * Returned as a fragment rather than applied by each caller so that forgetting
 * it is a type error at the call site rather than a silent cross-client read.
 */
export function clientFilter(clientId: string): { clientId: string } {
  return { clientId };
}

/**
 * Scope for a screen that may legitimately span clients.
 *
 * The queue is the first of these: "what is going out across the agency today,
 * and what broke" is an operational question, and answering it one client at a
 * time is not answering it. So staff may leave the client unnamed and see
 * everything.
 *
 * A portal user never can. They get their own client whatever they ask for,
 * exactly as above — the widening that makes this function useful for staff is
 * the precise thing that must not happen for them, so it is written as two
 * branches rather than an optional filter somebody could forget to apply.
 *
 * Returns a `where` fragment rather than an id, because "every client" has no
 * id to return.
 */
export async function resolveScopeFilter(
  actor: Actor,
  requested: string | null,
): Promise<{ clientId: string } | Record<string, never>> {
  if (actor.type === "CLIENT") {
    return clientFilter(await resolveClientScope(actor, requested));
  }
  if (!requested) return {};
  return clientFilter(await resolveClientScope(actor, requested));
}
