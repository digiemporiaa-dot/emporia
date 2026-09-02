import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { db } from "@/lib/db";
import { ToastProvider } from "@/components/ui";
import { PortalNav, type PortalNavItem } from "@/components/portal/nav";
import { SignOutButton } from "@/components/admin/sign-out";
import { signOutAction } from "@/app/admin/actions";

export const metadata: Metadata = {
  title: { default: "Portal", template: "%s · Emporia portal" },
  // Never indexed, and excluded from robots.txt and the sitemap by
  // construction.
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

/**
 * Portal shell and guard.
 *
 * The guard gets the wrong kind of account out of the way; it is not the
 * isolation boundary. Every query below runs through lib/services/portal.service,
 * which scopes by the session's own clientId and never accepts one from the
 * caller (CLAUDE.md 2 rule 3).
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();

  if (!actor) redirect("/auth/login?redirectTo=/portal");
  if (actor.type !== "CLIENT" || !actor.clientId) redirect("/admin");

  const [client, pendingApprovals, unreadMessages] = await Promise.all([
    db.client.findFirst({
      where: { id: actor.clientId, deletedAt: null },
      select: { name: true },
    }),
    db.approval.count({ where: { clientId: actor.clientId, status: "PENDING" } }),
    db.clientMessage.count({
      where: { clientId: actor.clientId, fromClient: false, readAt: null },
    }),
  ]);

  // A portal account whose client has been removed has nothing to show.
  if (!client) redirect("/auth/login");

  const items: PortalNavItem[] = [
    { href: "/portal", label: "Overview", icon: "dashboard" },
    { href: "/portal/projects", label: "Projects", icon: "projects" },
    { href: "/portal/content", label: "Content", icon: "content" },
    {
      href: "/portal/approvals",
      label: "Approvals",
      icon: "approvals",
      ...(pendingApprovals > 0 ? { badge: pendingApprovals } : {}),
    },
    { href: "/portal/documents", label: "Documents", icon: "documents" },
    { href: "/portal/invoices", label: "Invoices", icon: "invoices" },
    { href: "/portal/campaigns", label: "Campaigns", icon: "campaigns" },
    { href: "/portal/files", label: "Files", icon: "files" },
    {
      href: "/portal/messages",
      label: "Messages",
      icon: "messages",
      ...(unreadMessages > 0 ? { badge: unreadMessages } : {}),
    },
    { href: "/portal/profile", label: "Profile", icon: "profile" },
  ];

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-surface-muted">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex h-(--size-admin-header) max-w-(--container-wide) items-center justify-between gap-4 px-5 lg:px-8">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-base font-semibold tracking-tighter text-navy-800">
                Emporia
              </span>
              <span className="text-2xs uppercase tracking-widest text-ink-subtle">
                Client portal
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="truncate text-xs font-medium text-navy-800">{client.name}</p>
                <p className="truncate text-2xs text-ink-subtle">{actor.name}</p>
              </div>
              <SignOutButton action={signOutAction} />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-(--container-wide) gap-8 px-5 py-6 lg:grid lg:grid-cols-[14rem_1fr] lg:px-8 lg:py-8">
          <div className="mb-5 lg:mb-0">
            <PortalNav items={items} />
          </div>

          <main id="main" className="min-w-0">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
