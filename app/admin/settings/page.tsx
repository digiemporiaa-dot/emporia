import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requireStaff } from "@/lib/auth/rbac";
import { Card, CardBody } from "@/components/ui";
import { aiStatus } from "@/lib/services/ai-settings.service";
import { providerLabel } from "@/lib/ai/catalog";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings hub.
 *
 * A hub, so each card is gated on its own permission and only its own queries
 * run — the same rule the dashboard and the marketing hub follow. Requiring one
 * section's permission for the whole page would lock out a role that holds the
 * other.
 */
export default async function SettingsPage() {
  const actor = await requireActorPage("/admin/settings");
  requireStaff(actor);

  const seesEmail = can(actor, "emails.view");
  const seesAI = can(actor, "settings.view");
  const ai = seesAI ? await aiStatus() : null;

  return (
    <>
      <header className="mb-7">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">
          Settings
        </p>
        <h1 className="mt-1.5 text-2xl text-navy-800">How the system is configured</h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {seesEmail ? (
          <Link href="/admin/settings/email" className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                  Email templates
                </h2>
                <p className="mt-2 text-xs text-ink-subtle">
                  What the system sends, and when. Every send is logged.
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}

        {seesAI ? (
          <Link href="/admin/settings/ai" className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    AI and LLM
                  </h2>
                  <span className="text-xs text-ink-subtle">
                    {ai?.enabled ? providerLabel(ai.provider ?? "") : "Off"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-subtle">
                  Provider, model, endpoint and API key for the drafting features. Changes apply
                  without a deploy.
                </p>
              </CardBody>
            </Card>
          </Link>
        ) : null}
      </div>

      {!seesEmail && !seesAI ? (
        <p className="text-sm text-ink-subtle">Your role does not include any settings.</p>
      ) : null}
    </>
  );
}
