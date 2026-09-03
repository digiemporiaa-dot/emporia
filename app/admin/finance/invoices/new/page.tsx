import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { InvoiceEditor } from "../invoice-editor";

export const metadata: Metadata = { title: "New invoice" };
export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const actor = await requireActorPage("/admin/finance/invoices/new");
  requirePermission(actor, "invoices.create");

  const [clients, projects] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.project.findMany({
      where: { status: { notIn: ["CANCELLED"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true },
    }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/finance" className="hover:text-navy-800">
            Finance
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/finance/invoices" className="hover:text-navy-800">
            Invoices
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New invoice</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Saved as a draft first, with its number allocated. It only reaches the client when you
          send it.
        </p>
      </header>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-5 text-sm text-ink-muted">
          There are no clients to bill yet. Accept a proposal to create one.
        </p>
      ) : (
        <InvoiceEditor clients={clients} projects={projects} />
      )}
    </>
  );
}
