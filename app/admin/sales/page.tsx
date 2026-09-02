import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Card, CardBody } from "@/components/ui";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const actor = await requireActorPage("/admin/sales");
  requirePermission(actor, "proposals.view");

  const [open, accepted, opportunities, contracts, clients, catalogItems, pipelineValue] =
    await Promise.all([
    db.proposal.count({ where: { status: { in: ["DRAFT", "SENT", "VIEWED", "NEGOTIATION"] } } }),
    db.proposal.count({ where: { status: "ACCEPTED" } }),
    db.opportunity.count({ where: { stage: { notIn: ["WON", "LOST"] } } }),
    db.contract.count(),
    db.client.count({ where: { deletedAt: null } }),
    db.catalogItem.count({ where: { isActive: true } }),
    db.proposal.aggregate({
      where: { status: { in: ["SENT", "VIEWED", "NEGOTIATION"] } },
      _sum: { total: true },
    }),
  ]);

  // Money crosses the boundary as a string; a Decimal would not survive.
  const withClient = pipelineValue._sum.total?.toString() ?? "0";

  const sections = [
    {
      href: "/admin/sales/proposals" as const,
      title: "Proposals",
      detail: `${open} open · ${accepted} accepted`,
      description: "Quote, revise and send. Accepting one creates the client.",
    },
    {
      href: "/admin/sales/opportunities" as const,
      title: "Opportunities",
      detail: `${opportunities} open`,
      description: "Deals in play, with expected value and close date.",
    },
    {
      href: "/admin/sales/contracts" as const,
      title: "Contracts",
      detail: `${contracts}`,
      description: "Signed agreements. E-signature is interface-only for now.",
    },
    {
      href: "/admin/sales/catalog" as const,
      title: "Catalog",
      detail: `${catalogItems}`,
      description: "Reusable priced lines that proposals quote from.",
    },
    {
      href: "/admin/clients" as const,
      title: "Clients",
      detail: `${clients}`,
      description: "Won business, and what it came from.",
    },
  ];

  return (
    <>
      <header className="mb-6">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Sales</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Pipeline to signature</h1>
        {open > 0 ? (
          <p className="mt-1.5 text-xs text-ink-subtle">
            {formatMoney(withClient, "INR")} sitting with clients across sent, viewed and
            negotiating proposals.
          </p>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {section.title}
                  </h2>
                  {section.detail ? (
                    <span className="text-xs tabular-nums text-ink-subtle">{section.detail}</span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-ink-subtle">{section.description}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
