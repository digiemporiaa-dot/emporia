import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ContractForm } from "../contract-form";

export const metadata: Metadata = { title: "New contract" };
export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  const actor = await requireActorPage("/admin/sales/contracts/new");
  requirePermission(actor, "contracts.create");

  const [clients, proposals] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.proposal.findMany({
      where: { status: "ACCEPTED", contracts: { none: {} } },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, title: true },
    }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/sales/contracts" className="hover:text-navy-800">
            Contracts
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New contract</h1>
      </header>

      <ContractForm
        clients={clients}
        proposals={proposals.map((proposal) => ({
          id: proposal.id,
          label: `${proposal.number} — ${proposal.title}`,
        }))}
      />
    </>
  );
}
