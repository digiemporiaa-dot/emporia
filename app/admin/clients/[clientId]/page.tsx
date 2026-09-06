import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getClient } from "@/lib/services/sales.service";
import { listPortalUsers } from "@/lib/services/portal-access.service";
import { listMessages } from "@/lib/services/client-messages.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/sales/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { ClientThread, PortalAccessPanel } from "./client-panels";
import type { ClientStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Client" };
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

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const actor = await requireActorPage("/admin/clients");

  let client;
  try {
    client = await getClient(actor, clientId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [portalUsers, thread, projects] = await Promise.all([
    listPortalUsers(actor, client.id),
    listMessages(actor, client.id),
    db.project.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/clients" className="hover:text-navy-800">
            Clients
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{client.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{client.name}</h1>
          <Badge tone={TONE[client.status]}>{LABEL[client.status]}</Badge>
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {client.industry ?? "Industry not recorded"} · client since {DATE.format(client.createdAt)}
          {client.convertedFrom ? (
            <>
              {" · from lead "}
              <Link
                href={`/admin/leads/${client.convertedFrom.id}`}
                className="hover:text-brand-red"
              >
                {client.convertedFrom.name}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Proposals</CardTitle>
            </CardHeader>
            <CardBody>
              {client.proposals.length === 0 ? (
                <p className="text-xs text-ink-subtle">No proposals against this client.</p>
              ) : (
                <ul className="space-y-2.5">
                  {client.proposals.map((proposal) => (
                    <li key={proposal.id} className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/admin/sales/proposals/${proposal.id}`}
                        className="text-sm text-navy-800 hover:text-brand-red-text"
                      >
                        <span className="font-mono text-xs">{proposal.number}</span> {proposal.title}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone="neutral">{STATUS_LABEL[proposal.status]}</Badge>
                        <span className="text-xs tabular-nums text-ink-muted">
                          {formatMoney(proposal.total, proposal.currency)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contracts</CardTitle>
            </CardHeader>
            <CardBody>
              {client.contracts.length === 0 ? (
                <p className="text-xs text-ink-subtle">No contracts drafted yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {client.contracts.map((contract) => (
                    <li key={contract.id} className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/admin/sales/contracts/${contract.id}`}
                        className="text-sm text-navy-800 hover:text-brand-red-text"
                      >
                        <span className="font-mono text-xs">{contract.number}</span> {contract.title}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                        {formatMoney(contract.value, contract.currency)} · from{" "}
                        {DATE.format(contract.startsAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardBody>
            {client.contacts.length === 0 ? (
              <p className="text-xs text-ink-subtle">No contacts recorded.</p>
            ) : (
              <ul className="space-y-3.5">
                {client.contacts.map((contact) => (
                  <li key={contact.id}>
                    <p className="text-sm text-navy-800">
                      {contact.name}
                      {contact.isPrimary ? (
                        <span className="ml-2 align-middle text-2xs uppercase tracking-widest text-brand-red-text">
                          Primary
                        </span>
                      ) : null}
                    </p>
                    {contact.designation ? (
                      <p className="text-xs text-ink-subtle">{contact.designation}</p>
                    ) : null}
                    {contact.email ? (
                      <p className="text-xs text-ink-muted">
                        <a href={`mailto:${contact.email}`} className="hover:text-brand-red">
                          {contact.email}
                        </a>
                      </p>
                    ) : null}
                    {contact.phone ? (
                      <p className="text-xs text-ink-muted">{contact.phone}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {client.website ? (
              <p className="mt-4 border-t border-border pt-3 text-xs">
                <a
                  href={client.website}
                  rel="noreferrer noopener"
                  target="_blank"
                  className="text-navy-800 hover:text-brand-red"
                >
                  {client.website}
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Portal access</CardTitle>
          </CardHeader>
          <CardBody>
            <PortalAccessPanel
              clientId={client.id}
              users={portalUsers}
              canInvite={can(actor, "users.create")}
              canRevoke={can(actor, "users.edit")}
            />
          </CardBody>
        </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Messages</CardTitle>
        </CardHeader>
        <CardBody>
          <ClientThread
            clientId={client.id}
            messages={thread}
            projects={projects}
            canReply={can(actor, "clients.edit")}
          />
        </CardBody>
      </Card>
    </>
  );
}
