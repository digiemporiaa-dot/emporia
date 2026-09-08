import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getTrackingSettings } from "@/lib/services/tracking.service";
import { TrackingForm } from "./tracking-form";
import { CapiTokenForm } from "./capi-token-form";

export const metadata: Metadata = { title: "Tracking & Pixels" };

/**
 * Marketing → Tracking & Pixels.
 *
 * `getTrackingSettings` re-checks `settings.view` for itself; the check here is
 * what turns a denial into a redirect rather than an error page, and it is not
 * the only one (CLAUDE.md 2 rule 2).
 */
export default async function TrackingPage() {
  const actor = await requireActorPage("/admin/marketing/tracking");
  requirePermission(actor, "settings.view");

  const settings = await getTrackingSettings(actor);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/marketing" className="hover:text-navy-800">
            Marketing
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Tracking &amp; Pixels</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Tracking &amp; Pixels</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
          Every tag on the public site is loaded from here and nowhere else. A provider needs both
          an ID and its toggle before anything is sent, and consent decides when.
        </p>
      </header>

      <div className="max-w-3xl space-y-6">
        <TrackingForm settings={settings} />

        <section aria-labelledby="capi-token" className="space-y-3">
          <h2 id="capi-token" className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
            Secrets
          </h2>
          <CapiTokenForm
            masked={settings.capiTokenMasked}
            unreadable={settings.capiTokenUnreadable}
          />
        </section>
      </div>
    </>
  );
}
