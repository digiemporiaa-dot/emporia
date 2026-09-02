import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getContract } from "@/lib/services/sales.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { isSignatureConfigured } from "@/lib/signature";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { SignPanel } from "./sign-panel";
import type { ContractStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Contract" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const LABEL: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  SIGNED: "Signed",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
};

const TONE: Record<ContractStatus, "neutral" | "navy" | "warning" | "success" | "red"> = {
  DRAFT: "neutral",
  SENT: "navy",
  SIGNED: "success",
  ACTIVE: "success",
  EXPIRED: "warning",
  TERMINATED: "red",
};

export default async function ContractPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  const actor = await requireActorPage("/admin/sales/contracts");

  let contract;
  try {
    contract = await getContract(actor, contractId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const signable =
    can(actor, "contracts.edit") && contract.status !== "SIGNED" && contract.status !== "ACTIVE";

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/sales/contracts" className="hover:text-navy-800">
            Contracts
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{contract.number}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{contract.title}</h1>
          <Badge tone={TONE[contract.status]}>{LABEL[contract.status]}</Badge>
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          <span className="font-mono">{contract.number}</span> ·{" "}
          <Link
            href={`/admin/clients/${contract.client.id}`}
            className="hover:text-brand-red"
          >
            {contract.client.name}
          </Link>
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
          </CardHeader>
          <CardBody>
            {contract.terms ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{contract.terms}</p>
            ) : (
              <p className="text-xs text-ink-subtle">No terms recorded against this contract.</p>
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Detail</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Value</dt>
                  <dd className="tabular-nums text-navy-800">
                    {formatMoney(contract.value, contract.currency)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Starts</dt>
                  <dd className="text-navy-800">{DATE.format(contract.startsAt)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Ends</dt>
                  <dd className="text-navy-800">
                    {contract.endsAt ? DATE.format(contract.endsAt) : "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Renewal</dt>
                  <dd className="text-navy-800">
                    {contract.renewalAt ? DATE.format(contract.renewalAt) : "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Signed</dt>
                  <dd className="text-navy-800">
                    {contract.signedAt ? DATE.format(contract.signedAt) : "—"}
                  </dd>
                </div>
                {contract.proposal ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs text-ink-subtle">From</dt>
                    <dd>
                      <Link
                        href={`/admin/sales/proposals/${contract.proposal.id}`}
                        className="font-mono text-xs text-navy-800 hover:text-brand-red"
                      >
                        {contract.proposal.number}
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardBody>
          </Card>

          {signable ? (
            <Card>
              <CardHeader>
                <CardTitle>Signature</CardTitle>
              </CardHeader>
              <CardBody>
                {isSignatureConfigured() ? null : (
                  <p className="mb-3 text-xs text-ink-subtle">
                    No e-signature provider is configured, so signatures are collected outside the
                    system. Record the date one was given.
                  </p>
                )}
                <SignPanel contractId={contract.id} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
