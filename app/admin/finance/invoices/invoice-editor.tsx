"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { formatMoney, priceDocument } from "@/lib/money";
import { saveInvoiceAction, type FinanceActionState } from "../actions";

/**
 * Invoice editor.
 *
 * The totals shown while typing come from the same `lib/money` pricing the
 * server stores, so the preview and the saved invoice cannot disagree. Money is
 * a string throughout — no value is parsed into a JS number
 * (CLAUDE.md 2 rule 1).
 */

type Line = {
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
};

export type InvoiceValues = {
  id: string;
  clientId: string;
  projectId: string | null;
  currency: string;
  issuedAt: string;
  dueAt: string;
  notes: string | null;
  items: Line[];
};

const EMPTY_LINE: Line = {
  name: "",
  description: "",
  quantity: "1",
  unitPrice: "0.00",
  discountRate: "0",
  taxRate: "18",
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** A blank stays a valid number for the live preview, without being submitted. */
const safe = (value: string, fallback = "0") => (/^\d*\.?\d*$/.test(value) && value ? value : fallback);

export function InvoiceEditor({
  invoice,
  clients,
  projects,
}: {
  invoice?: InvoiceValues;
  clients: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string; clientId: string }[];
}) {
  const [state, formAction] = useActionState<FinanceActionState, FormData>(saveInvoiceAction, null);
  const [lines, setLines] = React.useState<Line[]>(invoice?.items ?? [EMPTY_LINE]);
  const [currency, setCurrency] = React.useState(invoice?.currency ?? "INR");
  const [clientId, setClientId] = React.useState(invoice?.clientId ?? "");

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  const update = (index: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const priced = priceDocument(
    lines.map((line) => ({
      quantity: safe(line.quantity, "0"),
      unitPrice: safe(line.unitPrice, "0"),
      discountRate: safe(line.discountRate, "0"),
      taxRate: safe(line.taxRate, "0"),
    })),
  );

  const payload = lines
    .filter((line) => line.name.trim())
    .map((line) => ({
      name: line.name,
      description: line.description || null,
      quantity: safe(line.quantity, "1"),
      unitPrice: safe(line.unitPrice, "0"),
      discountRate: safe(line.discountRate, "0"),
      taxRate: safe(line.taxRate, "0"),
    }));

  const cell =
    "h-9 w-full rounded-sm border border-line bg-white px-2 text-sm text-ink focus:border-brand-red";

  const clientProjects = projects.filter((project) => project.clientId === clientId);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {invoice ? <input type="hidden" name="id" value={invoice.id} /> : null}
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      {state?.ok ? (
        <div
          role="status"
          className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
        >
          Saved as a draft. Send it when you are ready.{" "}
          {invoice ? null : (
            <Link
              href={`/admin/finance/invoices/${state.data.id}`}
              className="font-medium underline underline-offset-2"
            >
              Open it
            </Link>
          )}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="clientId" label="Client" required error={err("clientId")}>
          {(aria) => (
            <Select
              {...aria}
              name="clientId"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={Boolean(invoice)}
              required
            >
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="projectId" label="Project" error={err("projectId")}>
          {(aria) => (
            <Select {...aria} name="projectId" defaultValue={invoice?.projectId ?? ""}>
              <option value="">None</option>
              {clientProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="issuedAt" label="Issued" error={err("issuedAt")}>
          {(aria) => (
            <Input
              {...aria}
              name="issuedAt"
              type="date"
              defaultValue={invoice?.issuedAt ?? new Date().toISOString().slice(0, 10)}
            />
          )}
        </Field>

        <Field id="dueAt" label="Due" required error={err("dueAt")}>
          {(aria) => (
            <Input
              {...aria}
              name="dueAt"
              type="date"
              defaultValue={
                invoice?.dueAt ??
                new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
              }
              required
            />
          )}
        </Field>
      </div>

      {invoice ? <input type="hidden" name="currency" value={currency} /> : null}

      {invoice ? null : (
        <div className="max-w-40">
          <Field id="currency" label="Currency" error={err("currency")}>
            {(aria) => (
              <Select
                {...aria}
                name="currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-3xl text-left text-sm">
          <thead className="border-b border-line text-2xs uppercase tracking-widest text-ink-subtle">
            <tr>
              <th scope="col" className="py-2 font-semibold">Item</th>
              <th scope="col" className="w-24 py-2 text-right font-semibold">Qty</th>
              <th scope="col" className="w-32 py-2 text-right font-semibold">Unit price</th>
              <th scope="col" className="w-20 py-2 text-right font-semibold">Disc %</th>
              <th scope="col" className="w-20 py-2 text-right font-semibold">Tax %</th>
              <th scope="col" className="w-32 py-2 text-right font-semibold">Line total</th>
              <th scope="col" className="w-10 py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-line align-top">
                <td className="py-2 pr-2">
                  <label className="sr-only" htmlFor={`line-${index}-name`}>
                    Line {index + 1} name
                  </label>
                  <input
                    id={`line-${index}-name`}
                    value={line.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    placeholder="What is being billed"
                    className={cell}
                  />
                  <label className="sr-only" htmlFor={`line-${index}-description`}>
                    Line {index + 1} description
                  </label>
                  <textarea
                    id={`line-${index}-description`}
                    value={line.description}
                    onChange={(event) => update(index, { description: event.target.value })}
                    rows={2}
                    placeholder="Detail shown to the client (optional)"
                    className={`${cell} mt-1 h-auto py-1 text-2xs`}
                  />
                </td>
                <td className="py-2 pr-2">
                  <label className="sr-only" htmlFor={`line-${index}-qty`}>Line {index + 1} quantity</label>
                  <input
                    id={`line-${index}-qty`}
                    value={line.quantity}
                    onChange={(event) => update(index, { quantity: event.target.value })}
                    inputMode="decimal"
                    className={`${cell} text-right`}
                  />
                </td>
                <td className="py-2 pr-2">
                  <label className="sr-only" htmlFor={`line-${index}-price`}>Line {index + 1} unit price</label>
                  <input
                    id={`line-${index}-price`}
                    value={line.unitPrice}
                    onChange={(event) => update(index, { unitPrice: event.target.value })}
                    inputMode="decimal"
                    className={`${cell} text-right`}
                  />
                </td>
                <td className="py-2 pr-2">
                  <label className="sr-only" htmlFor={`line-${index}-disc`}>Line {index + 1} discount percent</label>
                  <input
                    id={`line-${index}-disc`}
                    value={line.discountRate}
                    onChange={(event) => update(index, { discountRate: event.target.value })}
                    inputMode="decimal"
                    className={`${cell} text-right`}
                  />
                </td>
                <td className="py-2 pr-2">
                  <label className="sr-only" htmlFor={`line-${index}-tax`}>Line {index + 1} tax percent</label>
                  <input
                    id={`line-${index}-tax`}
                    value={line.taxRate}
                    onChange={(event) => update(index, { taxRate: event.target.value })}
                    inputMode="decimal"
                    className={`${cell} text-right`}
                  />
                </td>
                <td className="py-2 pr-2 text-right font-medium tabular-nums text-navy-800">
                  {formatMoney(priced.lineTotals[index] ?? "0", currency)}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setLines((current) =>
                        current.length === 1 ? current : current.filter((_, i) => i !== index),
                      )
                    }
                    className="rounded-sm p-1 text-ink-subtle hover:bg-red-50 hover:text-brand-red"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span className="sr-only">Remove line {index + 1}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button type="button" size="sm" variant="secondary" onClick={() => setLines((c) => [...c, EMPTY_LINE])}>
        <Plus size={14} aria-hidden="true" className="mr-1" />
        Add a line
      </Button>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Field id="notes" label="Notes" hint="Shown on the invoice">
          {(aria) => <Textarea {...aria} name="notes" rows={3} defaultValue={invoice?.notes ?? ""} />}
        </Field>

        <dl className="space-y-1.5 rounded-lg border border-line bg-white p-3.5 text-sm">
          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-xs text-ink-subtle">Subtotal</dt>
            <dd className="tabular-nums text-ink">{formatMoney(priced.totals.subtotal, currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-xs text-ink-subtle">Discount</dt>
            <dd className="tabular-nums text-ink">
              −{formatMoney(priced.totals.discountTotal, currency)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-xs text-ink-subtle">Tax</dt>
            <dd className="tabular-nums text-ink">{formatMoney(priced.totals.taxTotal, currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-6 border-t border-line pt-1.5">
            <dt className="text-sm font-medium text-navy-800">Total</dt>
            <dd className="font-display text-lg tabular-nums text-navy-800">
              {formatMoney(priced.totals.total, currency)}
            </dd>
          </div>
        </dl>
      </div>

      <Submit label={invoice ? "Save invoice" : "Create draft"} />
    </form>
  );
}
