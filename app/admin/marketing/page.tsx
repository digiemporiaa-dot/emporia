import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requireStaff } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Card, CardBody } from "@/components/ui";
import { PROVIDERS } from "@/lib/services/tracking.service";

/** The providers that put a script on the page, for the "live" count below. */
const TAG_PROVIDERS = PROVIDERS.filter(
  (provider) => provider !== "consent" && provider !== "googleSiteVerification",
);

export const metadata: Metadata = { title: "Marketing" };

export default async function MarketingPage() {
  const actor = await requireActorPage("/admin/marketing");
  requireStaff(actor);

  // A hub, so each card is gated on its own permission and only its own
  // queries run — the same rule the dashboard follows. Requiring one section's
  // permission for the whole page would lock out a role that holds the other.
  const seesPopups = can(actor, "popups.view");
  const seesCampaigns = can(actor, "campaigns.view");
  // Tracking is settings, not a marketing entity of its own — it reuses the
  // settings permissions rather than inventing a parallel pair.
  const seesTracking = can(actor, "settings.view");

  const [popups, active, submissions, campaigns, activeCampaigns, activeProviders] =
    await Promise.all([
    seesPopups ? db.popup.count() : Promise.resolve(0),
    seesPopups ? db.popup.count({ where: { isActive: true } }) : Promise.resolve(0),
    seesPopups
      ? db.popupAnalytics.count({ where: { event: "SUBMISSION" } })
      : Promise.resolve(0),
    seesCampaigns ? db.campaign.count() : Promise.resolve(0),
    seesCampaigns
      ? db.campaign.count({ where: { status: "ACTIVE" } })
      : Promise.resolve(0),
    // Consent is always a row and is not a tag, so it is excluded from the
    // count — "3 live" should mean three scripts, not two and a policy.
    seesTracking
      ? db.integrationSetting.count({
          where: { isEnabled: true, provider: { in: TAG_PROVIDERS } },
        })
      : Promise.resolve(0),
  ]);

  return (
    <>
      <header className="mb-7">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">Marketing</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Campaigns and capture</h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {seesCampaigns ? (
          <Link href="/admin/marketing/campaigns" className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    Campaigns
                  </h2>
                  <span className="text-xs tabular-nums text-ink-subtle">
                    {activeCampaigns} active of {campaigns}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-subtle">
                  Budgets, daily performance and cost per lead. Numbers are entered or imported by
                  someone — nothing here is estimated.
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}

        {seesPopups ? (
        <Link href="/admin/marketing/popups" className="group">
          <Card className="h-full transition-colors group-hover:border-navy-300">
            <CardBody>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                  Popups
                </h2>
                <span className="text-xs tabular-nums text-ink-subtle">
                  {active} active of {popups}
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                Targeting is resolved on the server; a visitor only ever receives the one popup they
                should see. {submissions} submission{submissions === 1 ? "" : "s"} recorded.
              </p>
            </CardBody>
          </Card>
        </Link>
        ) : null}

        {seesTracking ? (
          <Link href="/admin/marketing/tracking" className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    Tracking &amp; Pixels
                  </h2>
                  <span className="text-xs tabular-nums text-ink-subtle">
                    {activeProviders} live
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-subtle">
                  Tag Manager, GA4, Ads, Meta and the rest, plus the consent rule that decides when
                  any of them may run.
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}
      </div>

      {!seesPopups && !seesCampaigns && !seesTracking ? (
        <p className="text-sm text-ink-subtle">
          Your role does not include campaigns, popups or tracking.
        </p>
      ) : null}
    </>
  );
}
