import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProviderSettings } from "@/lib/services/social-settings.service";
import { providerStatuses } from "@/lib/social";
import { callbackUrl } from "@/lib/social/oauth-state";
import { SocialProviderSettings, type ProviderSettingsView } from "./provider-settings";

export const metadata: Metadata = { title: "Social platforms" };
export const dynamic = "force-dynamic";

/**
 * The agency's own app credentials for each platform.
 *
 * These are not a client's tokens — they are the app registration each
 * platform issues to this agency, and every client's connection is made
 * through them. Kept in Settings rather than under a client for that reason.
 */
export default async function SocialSettingsPage() {
  const actor = await requireActorPage("/admin/settings/social");
  requirePermission(actor, "settings.view");

  const [settings, statuses] = await Promise.all([
    listProviderSettings(actor),
    providerStatuses(),
  ]);
  const implemented = new Map(statuses.map((s) => [s.provider, s.implemented]));

  const rows: ProviderSettingsView[] = settings.map((row) => ({
    provider: row.provider,
    label: row.label,
    isEnabled: row.isEnabled,
    clientId: row.clientId,
    clientSecretMasked: row.clientSecretMasked,
    clientSecretUnreadable: row.clientSecretUnreadable,
    implemented: implemented.get(row.provider) ?? false,
    // Shown so an operator can paste it into the platform's app settings —
    // getting this wrong is the single most common reason an OAuth flow fails.
    redirectUri: callbackUrl(row.provider),
  }));

  return (
    <>
      <header className="mb-7">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/settings" className="hover:text-navy-800">
            Settings
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Social platforms</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Social platforms</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">
          The app credentials each platform issues to this agency. Clients connect their own
          accounts through them — nobody enters a client&rsquo;s password here.
        </p>
      </header>

      <SocialProviderSettings providers={rows} canEdit={can(actor, "settings.edit")} />
    </>
  );
}
