import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getInvoice } from "@/lib/services/invoice.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { isEditable } from "@/lib/finance/invoice";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import {
  GATEWAY_LABEL,
  InvoiceStatusBadge,
  PaymentStatusBadge,
} from "@/components/admin/invoice-badges";
import { InvoiceEditor } from "../invoice-editor";
import { InvoiceLifecycle, RecordPayment, RefundPayment } from "./invoice-actions";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const actor = await requireActorPage("/admin/finance/invoices");
  requirePermission(actor, "invoices.view");

  let invoice;
  try {
    invoice = await getInvoice(actor, invoiceId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const editable = isEditable(invoice.status);

  const [clients, projects] = editable
    ? await Promise.all([
        db.client.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        db.project.findMany({
          where: { clientId: invoice.clientId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, clientId: true },
        }),
      ])
    : [[], []];

  const canSeePayments = can(actor, "payments.view");

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/finance" className="hover:text-navy-800">
            Finance
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/finance/invoices" className="hover:text-navy-800">
            Invoices
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{invoice.number}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl text-navy-800">{invoice.number}</h1>
          <InvoiceStatusBadge status={invoice.status} />
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {invoice.client.name}
          {invoice.project ? ` · ${invoice.project.name}` : ""} · issued{" "}
          {DATE.format(invoice.issuedAt)} · due {DATE.format(invoice.dueAt)}
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          {editable ? (
            <InvoiceEditor
              invoice={{
                id: invoice.id,
                clientId: invoice.clientId,
                projectId: invoice.projectId,
                currency: invoice.currency,
                issuedAt: invoice.issuedAt.toISOString().slice(0, 10),
                dueAt: invoice.dueAt.toISOString().slice(0, 10),
                notes: invoice.notes,
                items: invoice.items.map((item) => ({
                  name: item.name,
                  description: item.description ?? "",
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  discountRate: item.discountRate,
                  taxRate: item.taxRate,
                })),
              }}
              clients={clients}
              projects={projects}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Billed lines</CardTitle>
                <p className="text-xs text-ink-subtle">
                  Locked because the client has this invoice. Cancel and reissue to change the
                  figures.
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
                      {invoice.items.map((item) => (
                        <tr key={item.id} className="border-b border-line">
                          <td className="py-2 pr-3">
                            <span className="text-navy-800">{item.name}</span>
                            {item.description ? (
                              <span className="block text-xs text-ink-subtle">
                                {item.description}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatMoney(item.unitPrice, invoice.currency)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-ink-subtle">
                            {item.discountRate}%
                          </td>
                          <td className="py-2 text-right tabular-nums text-ink-subtle">
                            {item.taxRate}%
                          </td>
                          <td className="py-2 text-right font-medium tabular-nums text-navy-800">
                            {formatMoney(item.lineTotal, invoice.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <dl className="ml-auto mt-4 w-full max-w-xs space-y-1.5 border-t-2 border-navy-800 pt-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd className="tabular-nums">
                      {formatMoney(invoice.subtotal, invoice.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Discount</dt>
                    <dd className="tabular-nums">
                      −{formatMoney(invoice.discountTotal, invoice.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Tax</dt>
                    <dd className="tabular-nums">
                      {formatMoney(invoice.taxTotal, invoice.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-display text-lg">
                    <dt className="text-navy-800">Total</dt>
                    <dd className="tabular-nums text-navy-800">
                      {formatMoney(invoice.total, invoice.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 text-xs">
                    <dt className="text-ink-muted">Received</dt>
                    <dd className="tabular-nums">
                      {formatMoney(invoice.paidTotal, invoice.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 text-sm font-medium">
                    <dt className="text-navy-800">Outstanding</dt>
                    <dd className="tabular-nums text-brand-red">
                      {formatMoney(invoice.dueTotal, invoice.currency)}
                    </dd>
                  </div>
                </dl>

                {invoice.notes ? (
                  <div className="mt-4 border-t border-line pt-3">
                    <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                      Notes
                    </h2>
                    <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">
                      {invoice.notes}
                    </p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          )}

          {canSeePayments ? (
            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardBody>
                {invoice.payments.length === 0 ? (
                  <p className="text-xs text-ink-subtle">
                    Nothing received against this invoice yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {invoice.payments.map((payment) => (
                      <li key={payment.id} className="py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-navy-800 tabular-nums">
                              {formatMoney(payment.amount, payment.currency)}
                            </p>
                            <p className="truncate text-2xs text-ink-subtle">
                              {[
                                GATEWAY_LABEL[payment.gateway] ?? payment.gateway,
                                payment.gatewayPaymentId,
                                DATE.format(payment.receivedAt),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <PaymentStatusBadge status={payment.status} />
                            {can(actor, "payments.refund") &&
                            (payment.status === "CAPTURED" ||
                              payment.status === "PARTIALLY_REFUNDED") ? (
                              <RefundPayment
                                paymentId={payment.id}
                                amount={payment.amount}
                                currency={payment.currency}
                              />
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle</CardTitle>
            </CardHeader>
            <CardBody>
              <InvoiceLifecycle
                invoiceId={invoice.id}
                status={invoice.status}
                canSend={can(actor, "invoices.send")}
                canEdit={can(actor, "invoices.edit")}
              />
            </CardBody>
          </Card>

          {can(actor, "payments.record") && invoice.outstanding ? (
            <Card>
              <CardHeader>
                <CardTitle>Record a payment</CardTitle>
              </CardHeader>
              <CardBody>
                <RecordPayment
                  invoiceId={invoice.id}
                  outstanding={invoice.dueTotal}
                  currency={invoice.currency}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Total</dt>
                  <dd className="tabular-nums text-navy-800">
                    {formatMoney(invoice.total, invoice.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Received</dt>
                  <dd className="tabular-nums">
                    {formatMoney(invoice.paidTotal, invoice.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-line pt-1.5">
                  <dt className="text-navy-800">Outstanding</dt>
                  <dd className="font-display text-lg tabular-nums text-navy-800">
                    {formatMoney(invoice.dueTotal, invoice.currency)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
