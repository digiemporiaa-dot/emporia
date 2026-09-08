import "server-only";
import { createHash } from "node:crypto";
import { capiCredentials } from "@/lib/services/tracking.service";
import { log } from "@/lib/logger";

/**
 * Meta Conversions API.
 *
 * The server-side copy of a conversion. It exists because the browser copy is
 * increasingly lost — blockers, ITP, a closed tab before the pixel fires — and
 * because a payment is confirmed by a webhook that no browser is present for.
 *
 * Deduplication is the whole reason this is safe to run alongside the pixel.
 * Meta collapses two events that share `event_name` and `event_id`, so both
 * copies of one conversion count once. The ids here are therefore either
 * deterministic (derived from the payment) or generated once and passed to
 * both sides — never generated independently per copy, which would double
 * every conversion instead of deduplicating it.
 *
 * Personal data is hashed before it leaves this process, as Meta requires:
 * SHA-256 of a normalised value, never the value itself.
 *
 * Nothing in this module logs the access token, and failures never propagate:
 * a conversion that cannot be reported must not fail the payment or the lead
 * that caused it.
 */

const GRAPH_VERSION = "v21.0";
const capiLog = log("capi");

export type CapiEventName = "Lead" | "Purchase";

export type CapiEvent = {
  eventName: CapiEventName;
  /** Shared with the browser copy. See the note above. */
  eventId: string;
  eventTime?: Date;
  /** The page the conversion happened on, when there was one. */
  sourceUrl?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  /** Meta's browser cookies, when the request carried them. */
  fbp?: string | null;
  fbc?: string | null;
  email?: string | null;
  phone?: string | null;
  /** A decimal string. Never a JS number (CLAUDE.md 2 rule 1). */
  value?: string | null;
  currency?: string | null;
};

/** SHA-256 of a normalised value, or undefined when there is nothing to hash. */
function hashed(value: string | null | undefined, normalise: (v: string) => string) {
  if (!value) return undefined;
  const normalised = normalise(value);
  if (!normalised) return undefined;
  return createHash("sha256").update(normalised).digest("hex");
}

const normaliseEmail = (value: string) => value.trim().toLowerCase();
/** Digits only; Meta expects a country code and no punctuation. */
const normalisePhone = (value: string) => value.replace(/\D/g, "");

/**
 * A deterministic event id for a payment.
 *
 * Derived rather than stored so both copies of the event can compute it
 * independently and still agree, and so a webhook retry produces the same id
 * as the first delivery — Meta then treats the retry as the same event rather
 * than a second purchase.
 */
export function purchaseEventId(gatewayPaymentId: string): string {
  return `purchase:${gatewayPaymentId}`;
}

type UserData = Record<string, string>;

/**
 * Send one event.
 *
 * Returns whether it was accepted, for callers that want to log it. Returns
 * false rather than throwing for every failure mode, including "not
 * configured" — a site with no Conversions API set up is the normal case, not
 * an error.
 */
export async function sendCapiEvent(event: CapiEvent): Promise<boolean> {
  const credentials = await capiCredentials();
  if (!credentials) return false;

  const userData: UserData = {};
  const em = hashed(event.email, normaliseEmail);
  const ph = hashed(event.phone, normalisePhone);
  if (em) userData["em"] = em;
  if (ph) userData["ph"] = ph;
  // These two are not hashed — Meta defines them as already-opaque identifiers
  // and rejects hashed values.
  if (event.clientIp) userData["client_ip_address"] = event.clientIp;
  if (event.userAgent) userData["client_user_agent"] = event.userAgent;
  if (event.fbp) userData["fbp"] = event.fbp;
  if (event.fbc) userData["fbc"] = event.fbc;

  const customData: Record<string, string> = {};
  if (event.value) customData["value"] = event.value;
  if (event.currency) customData["currency"] = event.currency;

  const body = {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor((event.eventTime ?? new Date()).getTime() / 1000),
        event_id: event.eventId,
        action_source: "website",
        ...(event.sourceUrl ? { event_source_url: event.sourceUrl } : {}),
        user_data: userData,
        ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
      },
    ],
    access_token: credentials.token,
  };

  try {
    const response = await fetch(
      // The token goes in the body, not the query string: a URL is the part
      // that ends up in proxy logs and error messages.
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(credentials.pixelId)}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // A conversion is worth a moment, not a hung request.
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      // The response body can echo the request, so only the status is logged.
      capiLog.warn(
        { event: event.eventName, eventId: event.eventId, status: response.status },
        "conversions api rejected the event",
      );
      return false;
    }

    capiLog.info({ event: event.eventName, eventId: event.eventId }, "conversions api event sent");
    return true;
  } catch (error) {
    capiLog.warn(
      { event: event.eventName, eventId: event.eventId, err: error },
      "conversions api send failed",
    );
    return false;
  }
}
