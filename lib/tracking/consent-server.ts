import "server-only";
import { cookies } from "next/headers";
import { publicTrackingConfig } from "@/lib/services/tracking.service";
import {
  CONSENT_COOKIE,
  parseConsent,
  resolveConsent,
  type ResolvedConsent,
} from "@/lib/tracking/consent";

/**
 * The visitor's consent, read on the server.
 *
 * Server-side conversions are still tracking. Sending one for a visitor who
 * refused marketing consent would move the same data through a different pipe
 * and call it compliant, which it is not — so the routes that send them ask
 * here first.
 *
 * The cookie is deliberately not httpOnly (the manager has to read it before
 * any request reaches the server), so it arrives with every request and this
 * needs no separate channel. It is resolved against the current mode and
 * version by the same pure function the browser uses, so the two cannot drift.
 */
export async function serverConsent(): Promise<ResolvedConsent> {
  const store = await cookies();
  const config = await publicTrackingConfig();
  return resolveConsent(
    config.consent.mode,
    config.consent.version,
    parseConsent(store.get(CONSENT_COOKIE)?.value),
  );
}
