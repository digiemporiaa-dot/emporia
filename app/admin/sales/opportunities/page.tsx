import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listOpportunities } from "@/lib/services/sales.service";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { OpportunityStage } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Opportunities" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const STAGE_LABEL: Record<OpportunityStage, string> = {
  DISCOVERY: "Discovery",
  SCOPING: "Scoping",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

const TONE: Record<OpportunityStage, "neutral" | "navy" | "warning" | "success" | "red"> = {
  DISCOVERY: "neutral",
  SCOPING: "neutral",
  PROPOSAL: "navy",
  NEGOTIATION: "warning",
  WON: "success",
  LOST: "red",
};

export default async function OpportunitiesPage() {
  const actor = await requireActorPage("/admin/sales/opportunities");
  const opportunities = await listOpportunities(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/sales" className="hover:text-navy-800">
              Sales
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Opportunities</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Opportunities</h1>
        </div>
        {can(actor, "opportunities.create") ? (
          <Link href="/admin/sales/opportunities/new">
            <Button size="sm">New opportunity</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>For</TH>
              <TH className="text-right">Value</TH>
              <TH>Stage</TH>
              <TH className="text-right">Probability</TH>
              <TH>Expected close</TH>
              <TH>Owner</TH>
              <TH className="text-right">Proposals</TH>
            </TR>
          </THead>
          <TBody>
            {opportunities.length === 0 ? (
              <TableEmpty
                colSpan={8}
                title="No opportunities yet"
                description="Open one against a qualified lead or an existing client."
              />
            ) : (
              opportunities.map((opportunity) => (
                <TR key={opportunity.id}>
                  <TD>
                    <Link
                      href={`/admin/sales/opportunities/${opportunity.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {opportunity.title}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">
                    {opportunity.client?.name ?? opportunity.lead?.name ?? "—"}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(opportunity.value, opportunity.currency)}
                  </TD>
                  <TD>
                    <Badge tone={TONE[opportunity.stage]}>{STAGE_LABEL[opportunity.stage]}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums text-ink-muted">
                    {opportunity.probability}%
                  </TD>
                  <TD className="text-xs text-ink-subtle">
                    {opportunity.expectedCloseAt ? DATE.format(opportunity.expectedCloseAt) : "—"}
                  </TD>
                  <TD className="text-ink-muted">{opportunity.owner?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">
                    {opportunity._count.proposals}
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
