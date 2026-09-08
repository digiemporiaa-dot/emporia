import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getNavigationSettings } from "@/lib/services/navigation.service";
import { NavigationForm } from "./navigation-form";

export const metadata: Metadata = { title: "Navigation" };
export const dynamic = "force-dynamic";

/**
 * Settings → Navigation.
 *
 * `getNavigationSettings` re-checks `settings.view` for itself; the check here
 * is what turns a denial into a redirect rather than an error page, and it is
 * not the only one (CLAUDE.md 2 rule 2).
 */
export default async function NavigationSettingsPage() {
  const actor = await requireActorPage("/admin/settings/navigation");
  requirePermission(actor, "settings.view");

  const navigation = await getNavigationSettings(actor);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/settings" className="hover:text-navy-800">
            Settings
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Navigation</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Header and footer</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
          The menu, the call-to-action button, the footer columns and the contact details, on every
          page of the public site. Saving takes effect immediately — there is nothing to redeploy.
        </p>
      </header>

      <NavigationForm navigation={navigation} />
    </>
  );
}
