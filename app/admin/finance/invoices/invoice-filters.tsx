"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { INVOICE_STATUS_LABEL } from "@/lib/finance/invoice";
import type { InvoiceStatus } from "@/generated/prisma/enums";

/**
 * Invoice list filters.
 *
 * The filter state lives in the URL, so the server does the filtering and a
 * "everything overdue for this client" view is a link someone can send.
 */

const STATUSES: readonly InvoiceStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
];

export function InvoiceFilters({
  params,
  clients,
}: {
  params: Record<string, unknown>;
  clients: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = React.useState(String(params["search"] ?? ""));

  const push = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("page");
      router.push(`/admin/finance/invoices?${next.toString()}`);
    },
    [router, searchParams],
  );

  const activeCount = ["status", "clientId", "overdue", "search"].filter((key) =>
    searchParams.get(key),
  ).length;

  const selectClass =
    "h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red";

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            push({ search: search.trim() || undefined });
          }}
          className="flex items-center gap-1.5"
        >
          <label htmlFor="invoice-search" className="sr-only">
            Search invoices
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id="invoice-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Invoice number or client"
              className="h-9 w-60 rounded-md border border-line-strong pl-8 pr-2 text-sm focus:border-brand-red"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md border border-line-strong px-3 text-sm text-navy-800 hover:border-navy-300"
          >
            Search
          </button>
        </form>

        <label className="sr-only" htmlFor="invoice-filter-status">
          Status
        </label>
        <select
          id="invoice-filter-status"
          className={selectClass}
          value={searchParams.get("status") ?? ""}
          onChange={(event) => push({ status: event.target.value || undefined })}
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {INVOICE_STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="invoice-filter-client">
          Client
        </label>
        <select
          id="invoice-filter-client"
          className={selectClass}
          value={searchParams.get("clientId") ?? ""}
          onChange={(event) => push({ clientId: event.target.value || undefined })}
        >
          <option value="">Any client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>

        <label className="flex h-9 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={Boolean(searchParams.get("overdue"))}
            onChange={(event) =>
              push({ overdue: event.target.checked ? "true" : undefined, status: undefined })
            }
            className="accent-brand-red"
          />
          Past due only
        </label>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              router.push("/admin/finance/invoices");
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-muted hover:bg-surface-muted hover:text-brand-red-text"
          >
            <X size={14} aria-hidden="true" />
            Clear {activeCount}
          </button>
        ) : null}
      </div>
    </div>
  );
}
