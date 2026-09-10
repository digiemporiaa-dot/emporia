import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { ToastProvider } from "@/components/ui";
import { AdminNav, type NavItem } from "@/components/admin/nav";
import { NAV } from "@/lib/admin/nav-spec";
import { SignOutButton } from "@/components/admin/sign-out";
import { signOutAction } from "./actions";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Emporia admin" },
  // Never indexed, and reinforced by robots.txt and the sitemap, which exclude
  // /admin by construction.
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

/**
 * Admin shell and auth guard.
 *
 * The guard here is a convenience that gets an unauthenticated visitor to the
 * login page. It is NOT the authorization boundary — each action and route
 * checks its own permission server-side, because a layout guard alone would be
 * bypassed by any route that renders without it (CLAUDE.md 2 rule 2).
 */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();

  if (!actor) redirect("/auth/login?redirectTo=/admin");

  // A portal user has no business in admin, and every page below re-checks a
  // permission a CLIENT_USER does not hold anyway. Sending them to their own
  // area beats an error page.
  if (actor.type === "CLIENT") redirect("/portal");

  const items: NavItem[] = NAV.filter(({ permission }) => can(actor, permission)).map(
    ({ item, children }) => {
      if (item.kind !== "link" || !children) return item;
      // Each sub-item is filtered on its own permission, so a link that would
      // 403 on click is never rendered. A module whose sub-items are all
      // hidden simply has none, and its hub still explains what is there.
      const visible = children
        .filter((child) => can(actor, child.permission))
        .map(({ href, label }) => ({ href, label }));
      return visible.length > 0 ? { ...item, children: visible } : item;
    },
  );

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-surface-muted lg:grid lg:grid-cols-[var(--size-admin-sidebar)_1fr]">
        <aside className="flex flex-col bg-navy-800 lg:min-h-dvh">
          <div className="flex h-(--size-admin-header) items-center gap-2 px-4">
            <span className="font-display text-base font-semibold tracking-tighter text-white">
              Emporia
            </span>
            <span className="rounded-xs bg-brand-red px-1 py-px text-2xs font-semibold uppercase tracking-wide text-white">
              Admin
            </span>
          </div>

          <div className="flex-1">
            <AdminNav items={items} />
          </div>

          <div className="border-t border-navy-700 px-2 py-3">
            <p className="truncate px-2.5 pb-1 text-xs font-medium text-white">{actor.name}</p>
            <p className="truncate px-2.5 pb-2 text-2xs uppercase tracking-widest text-navy-300">
              {actor.roleName?.replace(/_/g, " ").toLowerCase()}
            </p>
            <SignOutButton action={signOutAction} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <main id="main" className="min-w-0 flex-1 px-5 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
