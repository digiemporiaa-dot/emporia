import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getOpportunity } from "@/lib/services/sales.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/sales/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { OpportunityForm } from "../opportunity-form";

export const metadata: Metadata = { title: "Opportunity" };
export const dynamic = "force-dynamic";

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}) {
  const { opportunityId } = await params;
  const actor = await requireActorPage("/admin/sales/opportunities");

  let opportunity;
  try {
    opportunity = await getOpportunity(actor, opportunityId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const editable = can(actor, "opportunities.edit");
  const owners = editable
    ? await db.user.findMany({
        where: { type: "STAFF", status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/sales/opportunities" className="hover:text-navy-800">
            Opportunities
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{opportunity.title}</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">{opportunity.title}</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {formatMoney(opportunity.value, opportunity.currency)} ·{" "}
          {opportunity.client ? (
            <Link
              href={`/admin/clients/${opportunity.client.id}`}
              className="hover:text-brand-red"
            >
              {opportunity.client.name}
            </Link>
          ) : opportunity.lead ? (
            <Link
              href={`/admin/leads/${opportunity.lead.id}`}
              className="hover:text-brand-red"
            >
              {opportunity.lead.name}
            </Link>
          ) : (
            "Unattached"
          )}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {editable ? (
            <OpportunityForm
              opportunity={{
                id: opportunity.id,
                title: opportunity.title,
                value: opportunity.value,
                currency: opportunity.currency,
                stage: opportunity.stage,
                probability: opportunity.probability,
                expectedCloseAt: opportunity.expectedCloseAt,
                ownerId: opportunity.ownerId,
                leadId: opportunity.leadId,
                clientId: opportunity.clientId,
              }}
              owners={owners}
              leads={[]}
              clients={[]}
            />
          ) : (
            <Card>
              <CardBody>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-ink-subtle">Stage</dt>
                    <dd className="text-navy-800">{opportunity.stage}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-subtle">Probability</dt>
                    <dd className="tabular-nums text-navy-800">{opportunity.probability}%</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Proposals</CardTitle>
          </CardHeader>
          <CardBody>
            {opportunity.proposals.length === 0 ? (
              <p className="text-xs text-ink-subtle">No proposals quoted against this deal yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {opportunity.proposals.map((proposal) => (
                  <li key={proposal.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/admin/sales/proposals/${proposal.id}`}
                      className="text-sm text-navy-800 hover:text-brand-red"
                    >
                      {proposal.number}
                    </Link>
                    <span className="flex items-center gap-2">
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
      </div>
    </>
  );
}
