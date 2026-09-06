import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { financeSummary } from "@/lib/services/invoice.service";
import { listPayments } from "@/lib/services/payment.service";
import { isPaymentsConfigured } from "@/lib/payments";
import { formatMoney } from "@/lib/money";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FinanceTools } from "./finance-tools";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function FinancePage() {
  const actor = await requireActorPage("/admin/finance");
  requirePermission(actor, "invoices.view");

  const [summary, payments] = await Promise.all([
    financeSummary(actor),
    can(actor, "payments.view") ? listPayments(actor, 10) : Promise.resolve([]),
  ]);

  const stats = [
    { label: "Outstanding", value: formatMoney(summary.outstandingTotal, "INR"), detail: `${summary.outstandingCount} invoice${summary.outstandingCount === 1 ? "" : "s"}` },
    { label: "Overdue", value: formatMoney(summary.overdueTotal, "INR"), detail: `${summary.overdueCount} past due`, alarming: summary.overdueCount > 0 },
    { label: "Received this month", value: formatMoney(summary.receivedThisMonth, "INR"), detail: "captured payments" },
    { label: "Drafts", value: String(summary.drafts), detail: "not yet sent" },
  ];

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">Finance</p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Money</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {isPaymentsConfigured()
              ? "Online payment is configured; invoices are marked paid by the gateway webhook."
              : "No payment gateway is configured, so payments are recorded by hand."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/finance/invoices">
            <span className="inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm text-navy-800 hover:border-brand-red hover:text-brand-red-text">
              Invoices
            </span>
          </Link>
          <Link href="/admin/finance/retainers">
            <span className="inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm text-navy-800 hover:border-brand-red hover:text-brand-red-text">
              Retainers
            </span>
          </Link>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardBody>
              <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                {stat.label}
              </p>
              <p
                className={`mt-1.5 font-display text-2xl tabular-nums ${
                  stat.alarming ? "text-brand-red" : "text-navy-800"
                }`}
              >
                {stat.value}
              </p>
              <p className="text-xs text-ink-subtle">{stat.detail}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Recent payments</CardTitle>
          </CardHeader>
          <CardBody>
            {payments.length === 0 ? (
              <p className="text-xs text-ink-subtle">Nothing received yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-navy-800">
                        {formatMoney(payment.amount, payment.currency)}
                      </p>
                      <p className="truncate text-2xs text-ink-subtle">
                        {[
                          payment.client.name,
                          payment.invoice ? `against ${payment.invoice.number}` : null,
                          payment.gateway.replace(/_/g, " ").toLowerCase(),
                          DATE.format(payment.receivedAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Badge tone={payment.status === "CAPTURED" ? "success" : "neutral"}>
                      {payment.status.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Routine work</CardTitle>
          </CardHeader>
          <CardBody>
            <FinanceTools
              canBill={can(actor, "invoices.create")}
              canRemind={can(actor, "invoices.send")}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
