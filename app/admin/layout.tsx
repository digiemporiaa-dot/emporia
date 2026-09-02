import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { ToastProvider } from "@/components/ui";
import { AdminNav, type NavItem } from "@/components/admin/nav";
import { SignOutButton } from "@/components/admin/sign-out";
import { signOutAction } from "./actions";
import type { Permission } from "@/lib/auth/permissions";

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

/**
 * Sections and the permission that reveals each one. Items marked `pending`
 * have no route yet and render inert — the phase that builds the section turns
 * it into a link.
 */
const NAV: readonly { item: NavItem; permission: Permission }[] = [
  { item: { kind: "link", href: "/admin", label: "Dashboard", icon: "dashboard" }, permission: "leads.view" },
  { item: { kind: "link", href: "/admin/leads", label: "Leads", icon: "leads" }, permission: "leads.view" },
  { item: { kind: "link", href: "/admin/sales", label: "Sales", icon: "sales" }, permission: "proposals.view" },
  { item: { kind: "link", href: "/admin/clients", label: "Clients", icon: "clients" }, permission: "clients.view" },
  { item: { kind: "link", href: "/admin/projects", label: "Projects", icon: "projects" }, permission: "projects.view" },
  { item: { kind: "link", href: "/admin/catalog", label: "Catalog", icon: "content" }, permission: "catalog.view" },
  { item: { kind: "link", href: "/admin/content", label: "Content", icon: "content" }, permission: "content.view" },
  { item: { kind: "link", href: "/admin/approvals", label: "Approvals", icon: "approvals" }, permission: "approvals.view" },
  { item: { kind: "link", href: "/admin/marketing", label: "Marketing", icon: "marketing" }, permission: "popups.view" },
  { item: { kind: "pending", label: "Finance", icon: "finance", phase: 13 }, permission: "invoices.view" },
  { item: { kind: "pending", label: "Media", icon: "media", phase: 11 }, permission: "media.view" },
  { item: { kind: "pending", label: "Analytics", icon: "analytics", phase: 14 }, permission: "analytics.view" },
  { item: { kind: "pending", label: "Settings", icon: "settings" }, permission: "settings.view" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();

  if (!actor) redirect("/auth/login?redirectTo=/admin");

  // A portal user has no business in admin. Once the client portal exists
  // (Phase 10) this becomes redirect("/portal"); until then it is a terminal
  // message rather than a redirect to a route that does not exist, which would
  // either 404 or loop back through the login page.
  if (actor.type === "CLIENT") {
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-(--container-narrow) flex-col justify-center px-6">
        <h1 className="text-2xl text-navy-800">This area is for staff</h1>
        <p className="mt-3 max-w-prose text-ink-muted">
          Your account is a client account. The client portal is not available yet.
        </p>
      </main>
    );
  }

  const items = NAV.filter(({ permission }) => can(actor, permission)).map(({ item }) => item);

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
