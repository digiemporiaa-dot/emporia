import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can, requireStaff } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Card, CardBody } from "@/components/ui";
import type { Permission } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Admin dashboard.
 *
 * The page itself requires only that the caller is staff — it is the landing
 * page, so gating the whole thing on one resource permission would lock out
 * roles that legitimately use the admin (a content manager holds no
 * `leads.view`). Each panel is gated individually instead, and its query only
 * runs when the actor may see it: authorization decides what work happens, not
 * just what renders.
 *
 * Counts are read live from the database. On a fresh install they are zero and
 * the page says so — an empty state beats invented data (CLAUDE.md 2 rule 5).
 * The real analytics dashboard is Phase 14.
 */

type Panel = {
  label: string;
  permission: Permission;
  load: () => Promise<number>;
};

const PANELS: readonly Panel[] = [
  {
    label: "Open leads",
    permission: "leads.view",
    load: () => db.lead.count({ where: { deletedAt: null } }),
  },
  {
    label: "Active clients",
    permission: "clients.view",
    load: () => db.client.count({ where: { deletedAt: null } }),
  },
  {
    label: "Live projects",
    permission: "projects.view",
    load: () => db.project.count({ where: { status: { in: ["PLANNING", "ACTIVE"] } } }),
  },
  {
    label: "Unpaid invoices",
    permission: "invoices.view",
    load: () =>
      db.invoice.count({
        where: { deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      }),
  },
];

export default async function AdminDashboard() {
  const actor = await requireActorPage("/admin");
  requireStaff(actor);

  const permitted = PANELS.filter((panel) => can(actor, panel.permission));
  const stats = await Promise.all(
    permitted.map(async (panel) => ({ label: panel.label, value: await panel.load() })),
  );

  const firstName = actor.name.split(" ")[0] ?? "";
  const allZero = stats.length > 0 && stats.every((s) => s.value === 0);

  return (
    <>
      <header className="mb-7">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Dashboard</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">
          {firstName ? `Welcome, ${firstName}` : "Welcome"}
        </h1>
      </header>

      {stats.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardBody>
                <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                  {stat.label}
                </p>
                <p className="mt-2 font-display text-3xl tabular-nums text-navy-800">{stat.value}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      {stats.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <p className="text-sm font-medium text-navy-800">No dashboard panels for your role</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
              Your role does not include access to leads, clients, projects or invoices. Use the
              sections in the sidebar.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {allZero ? (
        <Card className="mt-4">
          <CardBody className="py-12 text-center">
            <p className="text-sm font-medium text-navy-800">Nothing to show yet</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
              The database is seeded with roles, permissions and your account — and nothing else.
              Leads, clients, projects and invoices appear here as the CRM, sales and finance phases
              are built.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
