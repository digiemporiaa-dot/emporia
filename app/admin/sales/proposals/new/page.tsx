import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listCatalog } from "@/lib/services/sales.service";
import { ProposalEditor } from "../proposal-editor";

export const metadata: Metadata = { title: "New proposal" };
export const dynamic = "force-dynamic";

export default async function NewProposalPage() {
  const actor = await requireActorPage("/admin/sales/proposals/new");
  requirePermission(actor, "proposals.create");

  const [catalog, leads, clients] = await Promise.all([
    listCatalog(actor),
    db.lead.findMany({
      where: { deletedAt: null, status: { notIn: ["WON", "LOST"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, company: true },
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
          <Link href="/admin/sales/proposals" className="hover:text-navy-800">
            Proposals
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New proposal</h1>
      </header>

      <ProposalEditor
        catalog={catalog.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice.toString(),
          taxRate: item.taxRate.toString(),
        }))}
        leads={leads}
        clients={clients}
      />
    </>
  );
}
