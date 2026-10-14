import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/errors";
import { binnedClients, binnedLeads } from "@/lib/services/recycle-bin.service";
import { Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { StatusBadge } from "@/components/admin/lead-badges";
import { BinActions } from "./bin-actions";

export const metadata: Metadata = { title: "Recycle bin" };
export const dynamic = "force-dynamic";

/**
 * Deleted leads and clients, waiting to be restored or removed for good.
 *
 * Nothing leaves the bin on a timer: an item stays until a person restores it
 * or deletes it permanently. A client with invoices, payments or contracts
 * stays regardless — the row says why.
 */

const params = z.object({
  tab: z.enum(["leads", "clients"]).catch("leads").default("leads"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

const WHEN = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const tabClass = (active: boolean) =>
  active
    ? "inline-flex h-9 items-center border-b-2 border-brand-red px-3 text-sm font-medium text-navy-800"
    : "inline-flex h-9 items-center border-b-2 border-transparent px-3 text-sm text-ink-muted hover:border-line-strong hover:text-navy-800";

export default async function RecycleBinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/recycle-bin");
  const canLeads = can(actor, "leads.delete");
  const canClients = can(actor, "clients.delete");
  if (!canLeads && !canClients) throw new ForbiddenError("You do not have permission to do that.");

  const parsed = params.parse(await searchParams);
  const tab = parsed.tab === "clients" && canClients ? "clients" : canLeads ? "leads" : "clients";

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Recycle bin</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Deleted leads and clients. Restore brings one back; delete permanently removes it for good.
        </p>
      </header>

      <nav aria-label="Recycle bin sections" className="mb-4 border-b border-line">
        <ul className="-mb-px flex gap-1">
          {canLeads ? (
            <li>
              <Link href={"/admin/recycle-bin?tab=leads" as Route} aria-current={tab === "leads" ? "page" : undefined} className={tabClass(tab === "leads")}>
                Leads
              </Link>
            </li>
          ) : null}
          {canClients ? (
            <li>
              <Link href={"/admin/recycle-bin?tab=clients" as Route} aria-current={tab === "clients" ? "page" : undefined} className={tabClass(tab === "clients")}>
                Clients
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>

      {tab === "leads" ? <LeadsBin actor={actor} page={parsed.page} /> : <ClientsBin actor={actor} />}
    </>
  );
}

async function LeadsBin({ actor, page }: { actor: Parameters<typeof binnedLeads>[0]; page: number }) {
  const bin = await binnedLeads(actor, page);
  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Lead</TH>
              <TH>Status</TH>
              <TH>Deleted</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {bin.rows.length === 0 ? (
              <TableEmpty colSpan={4} title="No deleted leads" description="Leads you delete wait here until you restore them or delete them permanently." />
            ) : (
              bin.rows.map((lead) => (
                <TR key={lead.id}>
                  <TD>
                    <span className="font-medium text-navy-800">{lead.name}</span>
                    <span className="block text-xs text-ink-subtle">{lead.company ?? lead.email ?? "—"}</span>
                  </TD>
                  <TD>
                    <StatusBadge status={lead.status} />
                  </TD>
                  <TD className="text-xs text-ink-muted">
                    {lead.deletedAt ? WHEN.format(lead.deletedAt) : "—"}
                    {lead.deletedBy ? <span className="block text-ink-subtle">by {lead.deletedBy}</span> : null}
                  </TD>
                  <TD>
                    <BinActions kind="lead" id={lead.id} name={lead.name} />
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
      {bin.pages > 1 ? (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-end gap-2 text-xs text-ink-subtle">
          {page > 1 ? (
            <Link href={`/admin/recycle-bin?tab=leads&page=${page - 1}` as Route} className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red">
              Previous
            </Link>
          ) : null}
          <span className="tabular-nums">
            Page {page} of {bin.pages}
          </span>
          {page < bin.pages ? (
            <Link href={`/admin/recycle-bin?tab=leads&page=${page + 1}` as Route} className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

async function ClientsBin({ actor }: { actor: Parameters<typeof binnedClients>[0] }) {
  const rows = await binnedClients(actor);
  return (
    <>
      <p className="mb-3 text-xs text-ink-subtle">
        A client with invoices, payments or contracts cannot be deleted permanently: financial records are kept
        (GST, about six years). It stays here, with its work stopped.
      </p>
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Deleted</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={3} title="No deleted clients" description="Clients you delete wait here until you restore them or delete them permanently." />
            ) : (
              rows.map((client) => (
                <TR key={client.id}>
                  <TD>
                    <span className="font-medium text-navy-800">{client.name}</span>
                    <span className="block text-xs text-ink-subtle">{client.industry ?? "—"}</span>
                  </TD>
                  <TD className="text-xs text-ink-muted">
                    {client.deletedAt ? WHEN.format(client.deletedAt) : "—"}
                    {client.deletedBy ? <span className="block text-ink-subtle">by {client.deletedBy}</span> : null}
                  </TD>
                  <TD>
                    <BinActions kind="client" id={client.id} name={client.name} keptBecause={client.keptBecause} />
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
