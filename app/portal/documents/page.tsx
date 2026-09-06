import type { Metadata } from "next";
import Link from "next/link";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listContracts, listProposals } from "@/lib/services/portal.service";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/sales/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { ContractStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const CONTRACT_LABEL: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  SIGNED: "Signed",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
};

export default async function PortalDocumentsPage() {
  const actor = await requirePortalActorPage();
  const [proposals, contracts] = await Promise.all([listProposals(actor), listContracts(actor)]);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Documents</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          The proposals we have sent you and the contracts in force.
        </p>
      </header>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Proposals</CardTitle>
          </CardHeader>
          <CardBody>
            {proposals.length === 0 ? (
              <p className="text-xs text-ink-subtle">Nothing sent yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {proposals.map((proposal) => (
                  <li
                    key={proposal.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/portal/documents/proposals/${proposal.id}`}
                        className="text-sm text-navy-800 hover:text-brand-red-text"
                      >
                        <span className="font-mono text-xs">{proposal.number}</span>{" "}
                        {proposal.title}
                      </Link>
                      <p className="text-2xs text-ink-subtle">
                        {proposal.sentAt ? `sent ${DATE.format(proposal.sentAt)}` : ""}
                        {proposal.validUntil
                          ? ` · valid until ${DATE.format(proposal.validUntil)}`
                          : ""}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge
                        tone={
                          proposal.status === "ACCEPTED"
                            ? "success"
                            : proposal.status === "REJECTED"
                              ? "red"
                              : "neutral"
                        }
                      >
                        {STATUS_LABEL[proposal.status]}
                      </Badge>
                      <span className="tabular-nums text-sm text-navy-800">
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
            {contracts.length === 0 ? (
              <p className="text-xs text-ink-subtle">No contracts on file.</p>
            ) : (
              <ul className="space-y-4">
                {contracts.map((contract) => (
                  <li key={contract.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <p className="text-sm text-navy-800">
                        <span className="font-mono text-xs">{contract.number}</span>{" "}
                        {contract.title}
                      </p>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge
                          tone={
                            contract.status === "ACTIVE" || contract.status === "SIGNED"
                              ? "success"
                              : "neutral"
                          }
                        >
                          {CONTRACT_LABEL[contract.status]}
                        </Badge>
                        <span className="tabular-nums text-sm text-navy-800">
                          {formatMoney(contract.value, contract.currency)}
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-2xs text-ink-subtle">
                      {[
                        `from ${DATE.format(contract.startsAt)}`,
                        contract.endsAt ? `to ${DATE.format(contract.endsAt)}` : null,
                        contract.renewalAt ? `renews ${DATE.format(contract.renewalAt)}` : null,
                        contract.signedAt ? `signed ${DATE.format(contract.signedAt)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {contract.terms ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-2xs text-ink-muted hover:text-brand-red-text">
                          Read the terms
                        </summary>
                        <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink">
                          {contract.terms}
                        </p>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
