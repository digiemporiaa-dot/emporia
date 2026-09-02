import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { OpportunityForm } from "../opportunity-form";

export const metadata: Metadata = { title: "New opportunity" };
export const dynamic = "force-dynamic";

export default async function NewOpportunityPage() {
  const actor = await requireActorPage("/admin/sales/opportunities/new");
  requirePermission(actor, "opportunities.create");

  const [owners, leads, clients] = await Promise.all([
    db.user.findMany({
      where: { type: "STAFF", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.lead.findMany({
      where: { deletedAt: null, status: { notIn: ["WON", "LOST"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true },
    }),
    db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/sales/opportunities" className="hover:text-navy-800">
            Opportunities
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New opportunity</h1>
      </header>

      <OpportunityForm owners={owners} leads={leads} clients={clients} />
    </>
  );
}
