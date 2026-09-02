import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getProposal, listCatalog } from "@/lib/services/sales.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { isEditable, STATUS_LABEL } from "@/lib/sales/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { ProposalEditor } from "../proposal-editor";
import { ProposalLifecycle } from "./proposal-actions";
import type { ProposalStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Proposal" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TONE: Record<ProposalStatus, "neutral" | "navy" | "warning" | "success" | "red"> = {
  DRAFT: "neutral",
  SENT: "navy",
  VIEWED: "navy",
  NEGOTIATION: "warning",
  ACCEPTED: "success",
  REJECTED: "red",
};

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  const actor = await requireActorPage("/admin/sales/proposals");
  requirePermission(actor, "proposals.view");

  let proposal;
  try {
    proposal = await getProposal(actor, proposalId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [catalog, clients] = await Promise.all([
    listCatalog(actor),
    db.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const editable = isEditable(proposal.status);
  const suggestedName =
    proposal.client?.name ?? proposal.lead?.company ?? proposal.lead?.name ?? "";

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/sales/proposals" className="hover:text-navy-800">
            Proposals
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{proposal.number}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{proposal.title}</h1>
          <Badge tone={TONE[proposal.status]}>{STATUS_LABEL[proposal.status]}</Badge>
          {proposal.version > 1 ? (
            <span className="text-xs text-ink-subtle">version {proposal.version}</span>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          <span className="font-mono">{proposal.number}</span>
          {proposal.client ? ` · ${proposal.client.name}` : proposal.lead ? ` · ${proposal.lead.name}` : ""}
          {proposal.sentAt ? ` · sent ${DATE.format(proposal.sentAt)}` : ""}
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          {editable ? (
            <ProposalEditor
              proposal={{
                id: proposal.id,
                title: proposal.title,
                currency: proposal.currency,
                leadId: proposal.lead?.id ?? null,
                clientId: proposal.client?.id ?? null,
                opportunityId: proposal.opportunity?.id ?? null,
                validUntil: proposal.validUntil ? proposal.validUntil.toISOString().slice(0, 10) : null,
                items: proposal.items.map((item) => ({
                  catalogItemId: item.catalogItemId ?? "",
                  name: item.name,
                  description: item.description ?? "",
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  discountRate: item.discountRate,
                  taxRate: item.taxRate,
                })),
              }}
              catalog={catalog.map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description,
                unit: item.unit,
                unitPrice: item.unitPrice.toString(),
                taxRate: item.taxRate.toString(),
              }))}
              leads={[]}
              clients={clients}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Quoted lines</CardTitle>
                <p className="text-xs text-ink-subtle">
                  Locked because the client has this document. Revise it to change the figures.
                </p>
              </CardHeader>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line-strong text-left text-2xs uppercase tracking-widest text-ink-subtle">
                        <th scope="col" className="py-2">Item</th>
                        <th scope="col" className="py-2 text-right">Qty</th>
                        <th scope="col" className="py-2 text-right">Unit</th>
                        <th scope="col" className="py-2 text-right">Disc</th>
                        <th scope="col" className="py-2 text-right">Tax</th>
                        <th scope="col" className="py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.items.map((item) => (
                        <tr key={item.id} className="border-b border-line">
                          <td className="py-2 pr-3">
                            <span className="text-navy-800">{item.name}</span>
                            {item.description ? (
                              <span className="block text-xs text-ink-subtle">{item.description}</span>
                            ) : null}
                          </td>
                          <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatMoney(item.unitPrice, proposal.currency)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-ink-subtle">{item.discountRate}%</td>
                          <td className="py-2 text-right tabular-nums text-ink-subtle">{item.taxRate}%</td>
                          <td className="py-2 text-right font-medium tabular-nums text-navy-800">
                            {formatMoney(item.lineTotal, proposal.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <dl className="ml-auto mt-4 w-full max-w-xs space-y-1.5 border-t-2 border-navy-800 pt-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd className="tabular-nums">{formatMoney(proposal.subtotal, proposal.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Discount</dt>
                    <dd className="tabular-nums">−{formatMoney(proposal.discountTotal, proposal.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Tax</dt>
                    <dd className="tabular-nums">{formatMoney(proposal.taxTotal, proposal.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-display text-lg">
                    <dt className="text-navy-800">Total</dt>
                    <dd className="tabular-nums text-navy-800">
                      {formatMoney(proposal.total, proposal.currency)}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle</CardTitle>
            </CardHeader>
            <CardBody>
              <ProposalLifecycle
                proposalId={proposal.id}
                status={proposal.status}
                canSend={can(actor, "proposals.send")}
                canEdit={can(actor, "proposals.edit")}
                canAccept={can(actor, "proposals.edit") && can(actor, "clients.create")}
                suggestedClientName={suggestedName}
              />
            </CardBody>
          </Card>

          {proposal.revisions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Revisions</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1.5 text-xs">
                  {proposal.revisions.map((revision) => (
                    <li key={revision.id} className="flex justify-between gap-3">
                      <span className="text-navy-800">Version {revision.version}</span>
                      <span className="text-ink-subtle">
                        {DATE.format(revision.createdAt)} · {revision.createdBy.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {proposal.contracts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Contract</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1.5 text-xs">
                  {proposal.contracts.map((contract) => (
                    <li key={contract.id} className="flex justify-between gap-3">
                      <span className="font-mono text-navy-800">{contract.number}</span>
                      <span className="text-ink-subtle">{contract.status.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
