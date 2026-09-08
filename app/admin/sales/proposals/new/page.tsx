import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { listCatalog, proposalTargets } from "@/lib/services/sales.service";
import { ProposalEditor } from "../proposal-editor";

export const metadata: Metadata = { title: "New proposal" };
export const dynamic = "force-dynamic";

export default async function NewProposalPage() {
  const actor = await requireActorPage("/admin/sales/proposals/new");
  requirePermission(actor, "proposals.create");

  // Both reads go through the service, which applies the CRM's row-level
  // scoping. This page used to query `lead` directly and skip it.
  const [catalog, targets] = await Promise.all([listCatalog(actor), proposalTargets(actor)]);

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
        leads={targets.leads}
        clients={targets.clients}
        leadsBeforeScoping={targets.leadsBeforeScoping}
      />
    </>
  );
}
