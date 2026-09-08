import { publicTrackingConfig } from "@/lib/services/tracking.service";
import { TrackingManager } from "./manager";

/**
 * Tracking entry point for the public site.
 *
 * A server component: it reads the settings — cached, and only ever the public
 * IDs — and hands them to the one client component that does the loading. The
 * secret never enters this path, because `publicTrackingConfig` does not select
 * it (CLAUDE.md 2 rule 6).
 */
export async function Tracking() {
  const config = await publicTrackingConfig();
  return <TrackingManager config={config} />;
}

/**
 * The GTM `<noscript>` iframe.
 *
 * Separate from the manager because it belongs immediately after `<body>` and
 * has to be server-rendered — a script-injected element is by definition absent
 * when scripts do not run.
 */
export async function TrackingNoScript() {
  const config = await publicTrackingConfig();
  if (!config.gtmId) return null;

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(config.gtmId)}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
