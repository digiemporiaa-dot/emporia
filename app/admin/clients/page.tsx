import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { listClients } from "@/lib/services/sales.service";
import { Badge, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { ClientStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const LABEL: Record<ClientStatus, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  CHURNED: "Churned",
};

const TONE: Record<ClientStatus, "success" | "warning" | "red"> = {
  ACTIVE: "success",
  ON_HOLD: "warning",
  CHURNED: "red",
};

export default async function ClientsPage() {
  const actor = await requireActorPage("/admin/clients");
  const clients = await listClients(actor);

  return (
    <>
      <header className="mb-6">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Clients</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Won business</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Clients are created by accepting a proposal, so every one here traces back to the lead it
          came from.
        </p>
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Industry</TH>
              <TH>Status</TH>
              <TH>Owner</TH>
              <TH className="text-right">Contacts</TH>
              <TH className="text-right">Proposals</TH>
              <TH className="text-right">Contracts</TH>
              <TH>Since</TH>
            </TR>
          </THead>
          <TBody>
            {clients.length === 0 ? (
              <TableEmpty
                colSpan={8}
                title="No clients yet"
                description="Accept a proposal and the client is created from it."
              />
            ) : (
              clients.map((client) => (
                <TR key={client.id}>
                  <TD>
                    <Link
                      href={`/admin/clients/${client.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {client.name}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">{client.industry ?? "—"}</TD>
                  <TD>
                    <Badge tone={TONE[client.status]}>{LABEL[client.status]}</Badge>
                  </TD>
                  <TD className="text-ink-muted">{client.owner?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">{client._count.contacts}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">{client._count.proposals}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">{client._count.contracts}</TD>
                  <TD className="text-xs text-ink-subtle">{DATE.format(client.createdAt)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
