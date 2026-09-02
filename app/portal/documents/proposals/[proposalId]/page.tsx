import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { getProposal } from "@/lib/services/portal.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/sales/lifecycle";
import { Badge, Card, CardBody, Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata: Metadata = { title: "Proposal" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function PortalProposalPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  const actor = await requirePortalActorPage();

  let proposal;
  try {
    // Opening it is what records VIEWED — the sales lifecycle says that is the
    // client's action, never staff's.
    proposal = await getProposal(actor, proposalId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/portal/documents" className="hover:text-navy-800">
            Documents
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{proposal.number}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{proposal.title}</h1>
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
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          <span className="font-mono">{proposal.number}</span>
          {proposal.sentAt ? ` · sent ${DATE.format(proposal.sentAt)}` : ""}
          {proposal.validUntil ? ` · valid until ${DATE.format(proposal.validUntil)}` : ""}
        </p>
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Unit</TH>
              <TH className="text-right">Disc</TH>
              <TH className="text-right">Tax</TH>
              <TH className="text-right">Total</TH>
            </TR>
          </THead>
          <TBody>
            {proposal.items.map((item) => (
              <TR key={item.id}>
                <TD>
                  <span className="text-navy-800">{item.name}</span>
                  {item.description ? (
                    <span className="block text-2xs text-ink-subtle">{item.description}</span>
                  ) : null}
                </TD>
                <TD className="text-right tabular-nums">{item.quantity}</TD>
                <TD className="text-right tabular-nums">
                  {formatMoney(item.unitPrice, proposal.currency)}
                </TD>
                <TD className="text-right tabular-nums text-ink-muted">{item.discountRate}%</TD>
                <TD className="text-right tabular-nums text-ink-muted">{item.taxRate}%</TD>
                <TD className="text-right tabular-nums">
                  {formatMoney(item.lineTotal, proposal.currency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <Card className="mt-4 ml-auto max-w-sm">
        <CardBody>
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-xs text-ink-subtle">Subtotal</dt>
              <dd className="tabular-nums text-ink">
                {formatMoney(proposal.subtotal, proposal.currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-xs text-ink-subtle">Discount</dt>
              <dd className="tabular-nums text-ink">
                −{formatMoney(proposal.discountTotal, proposal.currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-xs text-ink-subtle">Tax</dt>
              <dd className="tabular-nums text-ink">
                {formatMoney(proposal.taxTotal, proposal.currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 border-t border-line pt-1.5">
              <dt className="text-sm font-medium text-navy-800">Total</dt>
              <dd className="font-display text-lg tabular-nums text-navy-800">
                {formatMoney(proposal.total, proposal.currency)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <p className="mt-4 text-2xs text-ink-subtle">
        To accept, reply to your account manager or leave a note under{" "}
        <Link href="/portal/messages" className="underline underline-offset-2">
          Messages
        </Link>
        . Acceptance is recorded by us so the contract and client record are created together.
      </p>
    </>
  );
}
