import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listInvoices, listPayments } from "@/lib/services/portal.service";
import { isPaymentsConfigured } from "@/lib/payments";
import { formatMoney } from "@/lib/money";
import { INVOICE_STATUS_LABEL, isOutstanding } from "@/lib/finance/invoice";
import { siteDefaults } from "@/lib/seo/defaults";
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
import { PayInvoiceButton } from "./pay-button";
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

  // Whether the deployment can take card and UPI payments at all. With no
  // gateway configured the column is not rendered rather than showing a button
  // that cannot work.
  const canPayOnline = isPaymentsConfigured();

  // The business name checkout shows the payer, taken from site settings so it
  // is not hard-coded in a client component.
  const { siteName } = canPayOnline
    ? await siteDefaults()
    : { siteName: "" };

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
              {canPayOnline ? (
                <TH className="text-right">
                  <span className="sr-only">Pay</span>
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {invoices.length === 0 ? (
              <TableEmpty
                colSpan={canPayOnline ? 8 : 7}
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
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </Badge>
                  </TD>
                  {canPayOnline ? (
                    <TD className="text-right">
                      {isOutstanding(invoice.status) ? (
                        <PayInvoiceButton
                          invoiceId={invoice.id}
                          invoiceNumber={invoice.number}
                          businessName={siteName}
                        />
                      ) : null}
                    </TD>
                  ) : null}
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
        {canPayOnline
          ? "An online payment shows here once the gateway confirms it, usually within a minute of you paying. Bank transfers and cheques are recorded by us when they clear."
          : "Online payment is not available on this account. Pay by the method printed on your invoice and it will be recorded here once it clears."}
      </p>
    </>
  );
}
