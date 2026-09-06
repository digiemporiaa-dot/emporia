import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { pageParamsSchema } from "@/lib/paging";
import { Pagination } from "@/components/admin/pagination";
import { can } from "@/lib/auth/rbac";
import { listProposals } from "@/lib/services/sales.service";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/sales/lifecycle";
import type { ProposalStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Proposals" };
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

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/sales/proposals");

  const parsed = pageParamsSchema.safeParse(await searchParams);
  const params = parsed.success ? parsed.data : pageParamsSchema.parse({});
  const proposals = await listProposals(actor, params);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/sales" className="hover:text-navy-800">
              Sales
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Proposals</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Proposals</h1>
        </div>
        {can(actor, "proposals.create") ? (
          <Link href="/admin/sales/proposals/new">
            <Button size="sm">New proposal</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Title</TH>
              <TH>For</TH>
              <TH className="text-right">Total</TH>
              <TH>Status</TH>
              <TH>Sent</TH>
              <TH>Valid until</TH>
            </TR>
          </THead>
          <TBody>
            {proposals.rows.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No proposals yet"
                description="Quote a lead to get started."
              />
            ) : (
              proposals.rows.map((proposal) => (
                <TR key={proposal.id}>
                  <TD className="font-mono text-xs">
                    <Link
                      href={`/admin/sales/proposals/${proposal.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {proposal.number}
                    </Link>
                  </TD>
                  <TD>{proposal.title}</TD>
                  <TD className="text-ink-muted">
                    {proposal.client?.name ?? proposal.lead?.name ?? "—"}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(proposal.total, proposal.currency)}
                  </TD>
                  <TD>
                    <Badge tone={TONE[proposal.status]}>{STATUS_LABEL[proposal.status]}</Badge>
                  </TD>
                  <TD className="text-xs text-ink-subtle">
                    {proposal.sentAt ? DATE.format(proposal.sentAt) : "—"}
                  </TD>
                  <TD className="text-xs text-ink-subtle">
                    {proposal.validUntil ? DATE.format(proposal.validUntil) : "—"}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>

      <Pagination
        basePath="/admin/sales/proposals"
        params={params}
        page={proposals.page}
        pages={proposals.pages}
        total={proposals.total}
        perPage={proposals.perPage}
      />
    </>
  );
}
