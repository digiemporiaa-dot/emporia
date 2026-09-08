import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getAISettings } from "@/lib/services/ai-settings.service";
import { AISettingsForm } from "./ai-form";

export const metadata: Metadata = { title: "AI and LLM" };
export const dynamic = "force-dynamic";

/**
 * Settings → AI and LLM.
 *
 * `getAISettings` re-checks `settings.view` for itself; the check here is what
 * turns a denial into a redirect rather than an error page, and it is not the
 * only one (CLAUDE.md 2 rule 2).
 */
export default async function AISettingsPage() {
  const actor = await requireActorPage("/admin/settings/ai");
  requirePermission(actor, "settings.view");

  const settings = await getAISettings(actor);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/settings" className="hover:text-navy-800">
            Settings
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">AI and LLM</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">AI and LLM</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
          Which model answers the assist features, and with whose account. Everything here takes
          effect on the next request — changing the provider, the model or the key needs no deploy
          and no restart.
        </p>
      </header>

      <AISettingsForm settings={settings} />
    </>
  );
}
