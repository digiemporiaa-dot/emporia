import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import * as React from "react";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { financeSummary, listInvoices } from "@/lib/services/invoice.service";
import { invoiceListParamsSchema, type InvoiceListParamsInput } from "@/lib/validation/finance";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import type { Actor } from "@/lib/actor/types";
import { formatMoney } from "@/lib/money";
import { Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { InvoiceStatusBadge } from "@/components/admin/invoice-badges";
import { InvoiceFilters } from "./invoice-filters";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/finance/invoices");
  requirePermission(actor, "invoices.view");

  const raw = await searchParams;

  // Query-string filters are input like any other: validated before they reach
  // a query, and anything unrecognised falls back to the defaults.
  const parsed = invoiceListParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : invoiceListParamsSchema.parse({});

  // Only what the filter bar needs. The rows are fetched below, inside a
  // Suspense boundary, so the filters stay interactive while the query runs.
  // The headline figure is "across every unpaid invoice", which does not depend
  // on the filters — so it comes from the finance summary rather than from the
  // filtered query, and the header no longer waits on the rows.
  const [clients, summary] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    financeSummary(actor),
  ]);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/finance" className="hover:text-navy-800">
              Finance
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Invoices</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Invoices</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {formatMoney(summary.outstandingTotal, "INR")} outstanding across every unpaid invoice.
          </p>
        </div>
        {can(actor, "invoices.create") ? (
          <Link href="/admin/finance/invoices/new">
            <Button size="sm">New invoice</Button>
          </Link>
        ) : null}
      </header>

      <InvoiceFilters params={params} clients={clients} />

      <div className="mt-4">
        <Suspense key={JSON.stringify(params)} fallback={<TableSkeleton />}>
          <InvoicesTable actor={actor} params={params} />
        </Suspense>
      </div>
    </>
  );
}

/**
 * The rows themselves, so the filter bar above stays mounted and interactive
 * while the query runs.
 */
async function InvoicesTable({
  actor,
  params,
}: {
  actor: Actor;
  params: InvoiceListParamsInput;
}) {
  const result = await listInvoices(actor, params);
  const from = result.total === 0 ? 0 : (result.page - 1) * result.perPage + 1;
  const to = Math.min(result.page * result.perPage, result.total);
  const now = new Date();

  return (
    <>
      <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Client</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Outstanding</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.length === 0 ? (
                <TableEmpty
                  colSpan={7}
                  title="No invoices here"
                  description="Either nothing has been billed yet, or no invoice matches these filters."
                />
              ) : (
                result.rows.map((invoice) => {
                  const late =
                    invoice.dueAt < now &&
                    (invoice.status === "SENT" ||
                      invoice.status === "PARTIALLY_PAID" ||
                      invoice.status === "OVERDUE");

                  return (
                    <TR key={invoice.id}>
                      <TD className="font-mono text-xs">
                        <Link
                          href={`/admin/finance/invoices/${invoice.id}`}
                          className="font-medium text-navy-800 hover:text-brand-red"
                        >
                          {invoice.number}
                        </Link>
                      </TD>
                      <TD>
                        <span className="text-navy-800">{invoice.client.name}</span>
                        {invoice.project ? (
                          <span className="block text-2xs text-ink-subtle">
                            {invoice.project.name}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-xs text-ink-subtle">{DATE.format(invoice.issuedAt)}</TD>
                      <TD className={`text-xs ${late ? "text-brand-red-text" : "text-ink-subtle"}`}>
                        {DATE.format(invoice.dueAt)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatMoney(invoice.total, invoice.currency)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatMoney(invoice.dueTotal, invoice.currency)}
                      </TD>
                      <TD>
                        <InvoiceStatusBadge status={invoice.status} />
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
      </TableWrap>

      {result.total > 0 ? (
        <nav
          aria-label="Pagination"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-subtle"
        >
          <p>
            Showing {from}–{to} of {result.total}
          </p>
          <div className="flex items-center gap-2">
            <PageLink params={params} page={result.page - 1} disabled={result.page <= 1}>
              Previous
            </PageLink>
            <span className="tabular-nums">
              Page {result.page} of {result.pages}
            </span>
            <PageLink
              params={params}
              page={result.page + 1}
              disabled={result.page >= result.pages}
            >
              Next
            </PageLink>
          </div>
        </nav>
      ) : null}
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: Record<string, unknown>;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-sm border border-line px-2.5 py-1 text-ink-subtle/60">
        {children}
      </span>
    );
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && key !== "page") {
      query.set(key, String(value));
    }
  }
  query.set("page", String(page));

  return (
    <Link
      href={`/admin/finance/invoices?${query.toString()}`}
      className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red hover:text-brand-red"
    >
      {children}
    </Link>
  );
}
