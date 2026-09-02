import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listInvoices, listPayments } from "@/lib/services/portal.service";
import { formatMoney } from "@/lib/money";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import type { InvoiceStatus, PaymentStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const INVOICE_TONE: Record<InvoiceStatus, "neutral" | "navy" | "warning" | "success" | "red"> = {
  DRAFT: "neutral",
  SENT: "navy",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "red",
  CANCELLED: "neutral",
};

const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pending",
  CAPTURED: "Received",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Part refunded",
};

export default async function PortalInvoicesPage() {
  const actor = await requirePortalActorPage();
  const [invoices, payments] = await Promise.all([listInvoices(actor), listPayments(actor)]);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Invoices</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          What has been billed and what has been received.
        </p>
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Invoice</TH>
              <TH>Issued</TH>
              <TH>Due</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Outstanding</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {invoices.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No invoices yet"
                description="Invoices appear here as soon as they are issued."
              />
            ) : (
              invoices.map((invoice) => (
                <TR key={invoice.id}>
                  <TD className="font-mono text-xs text-navy-800">{invoice.number}</TD>
                  <TD className="text-xs text-ink-subtle">{DATE.format(invoice.issuedAt)}</TD>
                  <TD className="text-xs text-ink-subtle">{DATE.format(invoice.dueAt)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(invoice.total, invoice.currency)}
                  </TD>
                  <TD className="text-right tabular-nums text-ink-muted">
                    {formatMoney(invoice.paidTotal, invoice.currency)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(invoice.dueTotal, invoice.currency)}
                  </TD>
                  <TD>
                    <Badge tone={INVOICE_TONE[invoice.status]}>
                      {INVOICE_LABEL[invoice.status]}
                    </Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardBody>
          {payments.length === 0 ? (
            <p className="text-xs text-ink-subtle">Nothing received yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-navy-800">
                      {formatMoney(payment.amount, payment.currency)}
                    </p>
                    <p className="text-2xs text-ink-subtle">
                      {[
                        payment.invoice ? `against ${payment.invoice.number}` : null,
                        payment.gateway.replace(/_/g, " ").toLowerCase(),
                        DATE.format(payment.receivedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Badge tone={payment.status === "CAPTURED" ? "success" : "neutral"}>
                    {PAYMENT_LABEL[payment.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-2xs text-ink-subtle">
        Paying online is not available yet — the payment gateway is wired up in phase 13. Until
        then, pay by the method on your invoice and we will record it here.
      </p>
    </>
  );
}
