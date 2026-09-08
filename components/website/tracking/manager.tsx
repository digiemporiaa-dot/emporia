"use client";

import * as React from "react";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  acceptAll,
  choose,
  mayLoad,
  parseConsent,
  rejectAll,
  resolveConsent,
  type ConsentChoice,
  type ResolvedConsent,
} from "@/lib/tracking/consent";
import type { PublicTrackingConfig } from "@/lib/services/tracking.service";
import {
  applyGoogleConsent,
  loadClarity,
  loadGa4,
  loadGoogleAds,
  loadGtm,
  loadHotjar,
  loadMetaPixel,
  loadPinterest,
  loadSnapchat,
  loadTiktok,
} from "./loaders";
import { ConsentBanner } from "./consent-banner";

/**
 * The tracking manager.
 *
 * One place decides what loads. Nothing else in the application injects a
 * tracking script, so "which pixels are on this page" is answered by reading
 * this file rather than by grepping every route.
 *
 * A provider loads only when all four hold:
 *
 *   1. configured   — the server sent an ID
 *   2. enabled      — the server only sends IDs for enabled providers, so an
 *                     off provider is absent from the payload rather than
 *                     present and skipped here
 *   3. permitted    — consent allows its category
 *   4. not already  — the loaders keep their own registry
 *
 * `"use client"` is genuine: this reads a cookie, writes one, and appends
 * script elements. It is a leaf, so nothing above it becomes a client
 * component (CLAUDE.md 2 rule 8).
 */

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function writeConsent(choice: ConsentChoice): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // Not httpOnly on purpose: this component has to read it to decide what to
  // load before any request reaches the server. It holds a version, two
  // booleans and a timestamp — no personal information
  // (docs/ARCHITECTURE.md 14A.4).
  document.cookie =
    `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(choice))}` +
    `; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function TrackingManager({ config }: { config: PublicTrackingConfig }) {
  const version = config.consent.version;

  // Resolved on the client, because the decision depends on a cookie the
  // cached server payload must not vary on.
  const [consent, setConsent] = React.useState<ResolvedConsent | null>(null);
  const [openPreferences, setOpenPreferences] = React.useState(false);

  React.useEffect(() => {
    const stored = parseConsent(readCookie(CONSENT_COOKIE));
    setConsent(resolveConsent(config.consent.mode, version, stored));
  }, [config.consent.mode, version]);

  React.useEffect(() => {
    if (!consent) return;

    /**
     * Tag Manager owns the tags configured inside it. Loading GA4 or Ads
     * separately as well is the classic way to double every page view and
     * every conversion, so when GTM is on this file does not load them —
     * the admin says so too, next to the field.
     */
    const gtmOwnsGoogle = Boolean(config.gtmId);

    // Consent Mode first, and before GTM: a container that arrives without a
    // signal has already decided what its tags may do. The first call sets
    // defaults, later ones are updates, so changing an answer reaches Google
    // rather than only stopping the loaders below.
    applyGoogleConsent(consent);

    if (config.gtmId) loadGtm(config.gtmId);

    if (!gtmOwnsGoogle && config.ga4Id && mayLoad("ga4", consent)) loadGa4(config.ga4Id);
    if (!gtmOwnsGoogle && config.googleAdsId && mayLoad("googleAds", consent)) {
      loadGoogleAds(config.googleAdsId);
    }

    if (config.metaPixelId && mayLoad("metaPixel", consent)) loadMetaPixel(config.metaPixelId);
    if (config.clarityId && mayLoad("clarity", consent)) loadClarity(config.clarityId);
    if (config.hotjarId && mayLoad("hotjar", consent)) loadHotjar(config.hotjarId);
    if (config.pinterestId && mayLoad("pinterest", consent)) loadPinterest(config.pinterestId);
    if (config.tiktokId && mayLoad("tiktok", consent)) loadTiktok(config.tiktokId);
    if (config.snapchatId && mayLoad("snapchat", consent)) loadSnapchat(config.snapchatId);
  }, [config, consent]);

  const decide = React.useCallback((choice: ConsentChoice) => {
    writeConsent(choice);
    setConsent({ analytics: choice.analytics, marketing: choice.marketing, needsDecision: false });
    setOpenPreferences(false);
  }, []);

  const anythingToTrack =
    config.gtmId ??
    config.ga4Id ??
    config.googleAdsId ??
    config.metaPixelId ??
    config.clarityId ??
    config.hotjarId ??
    config.pinterestId ??
    config.tiktokId ??
    config.snapchatId;

  // Nothing configured means nothing to consent to, and a cookie banner on a
  // site that sets no tracking cookies is theatre.
  if (!consent || !anythingToTrack) return null;

  return (
    <ConsentBanner
      mode={config.consent.mode}
      bannerText={config.consent.bannerText}
      consent={consent}
      openPreferences={openPreferences}
      onOpenPreferences={() => setOpenPreferences(true)}
      onClosePreferences={() => setOpenPreferences(false)}
      onAcceptAll={() => decide(acceptAll(version))}
      onRejectAll={() => decide(rejectAll(version))}
      onSave={(analytics, marketing) => decide(choose(version, analytics, marketing))}
    />
  );
}
