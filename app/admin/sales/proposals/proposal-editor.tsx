"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { formatMoney, documentTotals, lineTotals, toMoneyString } from "@/lib/money";
import { saveProposalAction, type SalesActionState } from "../actions";

/**
 * Proposal editor.
 *
 * The totals shown while typing are computed with the same `lib/money`
 * functions the server uses to store them, so the preview and the saved record
 * cannot disagree. Money is handled as strings throughout — no value is ever
 * parsed into a JS number (CLAUDE.md 2 rule 1).
 */

type Line = {
  catalogItemId: string;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
};

export type ProposalValues = {
  id: string;
  title: string;
  currency: string;
  leadId: string | null;
  clientId: string | null;
  opportunityId: string | null;
  validUntil: string | null;
  items: Line[];
};

type CatalogOption = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  taxRate: string;
};

const EMPTY_LINE: Line = {
  catalogItemId: "",
  name: "",
  description: "",
  quantity: "1",
  unitPrice: "0.00",
  discountRate: "0",
  taxRate: "18",
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** Guard against a partially typed value blowing up the live preview. */
function safeMoney(value: string): string {
  return /^\d{1,12}(\.\d{1,2})?$/.test(value.trim()) ? value.trim() : "0";
}
function safeQty(value: string): string {
  return /^\d{1,9}(\.\d{1,3})?$/.test(value.trim()) ? value.trim() : "0";
}
function safeRate(value: string): string {
  return /^\d{1,3}(\.\d{1,3})?$/.test(value.trim()) ? value.trim() : "0";
}

/** Name, company and email, so two leads called Priya are tellable apart. */
function leadLabel(lead: { name: string; company: string | null; email: string | null }): string {
  const who = lead.company ? `${lead.company} — ${lead.name}` : lead.name;
  return lead.email ? `${who} (${lead.email})` : who;
}

/**
 * Why the lead list is empty, when it is.
 *
 * Three distinct causes, three different things to do about them. Saying
 * nothing — which is what an empty dropdown does — was the reported bug.
 */
function leadHint(shown: number, beforeScoping: number | undefined): string | undefined {
  if (shown > 0) return undefined;
  if (beforeScoping === undefined || beforeScoping === 0) {
    return "No open leads yet. Add a lead first, or address this proposal to an existing client below.";
  }
  const many = beforeScoping !== 1;
  return `${beforeScoping} open lead${many ? "s" : ""} ${many ? "exist" : "exists"} but ${
    many ? "none are" : "it is not"
  } assigned to you. Ask for one to be assigned, or address this proposal to a client below.`;
}

export function ProposalEditor({
  proposal,
  catalog,
  leads,
  clients,
  leadsBeforeScoping,
  currencyDefault = "INR",
}: {
  proposal?: ProposalValues;
  catalog: readonly CatalogOption[];
  leads: readonly { id: string; name: string; company: string | null; email: string | null }[];
  clients: readonly { id: string; name: string }[];
  /**
   * Live leads before the actor's own row-level scoping.
   *
   * Lets the empty state tell "there are no leads" from "none of them are
   * assigned to you" — two different problems with two different fixes, and an
   * empty dropdown says neither.
   */
  leadsBeforeScoping?: number;
  currencyDefault?: string;
}) {
  const [state, formAction] = useActionState<SalesActionState, FormData>(saveProposalAction, null);
  const [lines, setLines] = React.useState<Line[]>(proposal?.items ?? [EMPTY_LINE]);
  const [currency, setCurrency] = React.useState(proposal?.currency ?? currencyDefault);

  const update = (index: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const addFromCatalog = (index: number, catalogId: string) => {
    const item = catalog.find((c) => c.id === catalogId);
    if (!item) {
      update(index, { catalogItemId: "" });
      return;
    }
    update(index, {
      catalogItemId: item.id,
      name: item.name,
      description: item.description ?? "",
      // Copied, not referenced: later catalogue edits must not move a quote.
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
    });
  };

  const priced = lines.map((line) =>
    lineTotals({
      quantity: safeQty(line.quantity),
      unitPrice: safeMoney(line.unitPrice),
      discountRate: safeRate(line.discountRate),
      taxRate: safeRate(line.taxRate),
    }),
  );

  const totals = documentTotals(
    lines.map((line) => ({
      quantity: safeQty(line.quantity),
      unitPrice: safeMoney(line.unitPrice),
      discountRate: safeRate(line.discountRate),
      taxRate: safeRate(line.taxRate),
    })),
  );

  const payload = lines
    .filter((line) => line.name.trim())
    .map((line) => ({
      catalogItemId: line.catalogItemId || null,
      name: line.name,
      description: line.description || null,
      quantity: safeQty(line.quantity),
      unitPrice: safeMoney(line.unitPrice),
      discountRate: safeRate(line.discountRate),
      taxRate: safeRate(line.taxRate),
    }));

  const cell =
    "h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm tabular-nums focus:border-brand-red";

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {proposal ? <input type="hidden" name="id" value={proposal.id} /> : null}
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}
      {state?.ok ? (
        <div role="status" className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success">
          Saved.
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="title" label="Title" required>
          {(aria) => <Input {...aria} name="title" defaultValue={proposal?.title} required />}
        </Field>
        <Field id="currency" label="Currency">
          {(aria) => (
            <Select
              {...aria}
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["INR", "USD", "EUR", "GBP", "AED"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="validUntil" label="Valid until">
          {(aria) => (
            <Input {...aria} name="validUntil" type="date" defaultValue={proposal?.validUntil ?? ""} />
          )}
        </Field>
        <Field
          id="leadId"
          label="For"
          hint={proposal ? undefined : leadHint(leads.length, leadsBeforeScoping)}
        >
          {(aria) => (
            <Select {...aria} name="leadId" defaultValue={proposal?.leadId ?? ""} disabled={Boolean(proposal)}>
              <option value="">{leads.length === 0 ? "No leads available" : "Choose a lead…"}</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {leadLabel(lead)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {proposal ? (
        <>
          <input type="hidden" name="leadId" value={proposal.leadId ?? ""} />
          <input type="hidden" name="clientId" value={proposal.clientId ?? ""} />
          <input type="hidden" name="opportunityId" value={proposal.opportunityId ?? ""} />
        </>
      ) : (
        <Field
          id="clientId"
          label="Or an existing client"
          hint={clients.length === 0 ? "No clients yet — a proposal can still go to a lead." : undefined}
        >
          {(aria) => (
            <Select {...aria} name="clientId" defaultValue="">
              <option value="">Not an existing client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <fieldset className="space-y-2">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Lines
        </legend>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left text-2xs uppercase tracking-widest text-ink-subtle">
                <th scope="col" className="w-1/3 py-2">Item</th>
                <th scope="col" className="w-20 py-2 text-right">Qty</th>
                <th scope="col" className="w-32 py-2 text-right">Unit price</th>
                <th scope="col" className="w-20 py-2 text-right">Disc %</th>
                <th scope="col" className="w-20 py-2 text-right">Tax %</th>
                <th scope="col" className="w-32 py-2 text-right">Line total</th>
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
                      onChange={(e) => update(index, { name: e.target.value })}
                      placeholder="What is being sold"
                      className={cell}
                    />
                    <label className="sr-only" htmlFor={`line-${index}-description`}>
                      Line {index + 1} description
                    </label>
                    <textarea
                      id={`line-${index}-description`}
                      value={line.description}
                      onChange={(e) => update(index, { description: e.target.value })}
                      rows={2}
                      placeholder="Detail shown to the client (optional)"
                      className={`${cell} mt-1 h-auto py-1 text-2xs`}
                    />
                    {catalog.length > 0 ? (
                      <>
                        <label className="sr-only" htmlFor={`line-${index}-catalog`}>
                          Fill line {index + 1} from the catalogue
                        </label>
                        <select
                          id={`line-${index}-catalog`}
                          value={line.catalogItemId}
                          onChange={(e) => addFromCatalog(index, e.target.value)}
                          className="mt-1 h-7 w-full rounded-sm border border-line bg-white px-1.5 text-2xs text-ink-muted"
                        >
                          <option value="">From catalogue…</option>
                          {catalog.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.unitPrice} / {item.unit}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2">
                    <label className="sr-only" htmlFor={`line-${index}-qty`}>Line {index + 1} quantity</label>
                    <input
                      id={`line-${index}-qty`}
                      value={line.quantity}
                      onChange={(e) => update(index, { quantity: e.target.value })}
                      inputMode="decimal"
                      className={`${cell} text-right`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <label className="sr-only" htmlFor={`line-${index}-price`}>Line {index + 1} unit price</label>
                    <input
                      id={`line-${index}-price`}
                      value={line.unitPrice}
                      onChange={(e) => update(index, { unitPrice: e.target.value })}
                      inputMode="decimal"
                      className={`${cell} text-right`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <label className="sr-only" htmlFor={`line-${index}-disc`}>Line {index + 1} discount percent</label>
                    <input
                      id={`line-${index}-disc`}
                      value={line.discountRate}
                      onChange={(e) => update(index, { discountRate: e.target.value })}
                      inputMode="decimal"
                      className={`${cell} text-right`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <label className="sr-only" htmlFor={`line-${index}-tax`}>Line {index + 1} tax percent</label>
                    <input
                      id={`line-${index}-tax`}
                      value={line.taxRate}
                      onChange={(e) => update(index, { taxRate: e.target.value })}
                      inputMode="decimal"
                      className={`${cell} text-right`}
                    />
                  </td>
                  <td className="py-2 pr-2 text-right font-medium tabular-nums text-navy-800">
                    {formatMoney(priced[index]?.total ?? "0", currency)}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setLines((c) => (c.length === 1 ? c : c.filter((_, i) => i !== index)))}
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

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setLines((c) => [...c, EMPTY_LINE])}
        >
          <Plus size={14} aria-hidden="true" /> Add line
        </Button>
      </fieldset>

      <div className="flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5 border-t-2 border-navy-800 pt-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd className="tabular-nums text-navy-800">{formatMoney(totals.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Discount</dt>
            <dd className="tabular-nums text-navy-800">
              −{formatMoney(totals.discountTotal, currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Tax</dt>
            <dd className="tabular-nums text-navy-800">{formatMoney(totals.taxTotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-display text-lg">
            <dt className="text-navy-800">Total</dt>
            <dd className="tabular-nums text-navy-800">{formatMoney(totals.total, currency)}</dd>
          </div>
          <p className="pt-1 text-2xs text-ink-subtle">
            Computed by the same code that stores the figures. Stored total:{" "}
            <span className="font-mono">{toMoneyString(totals.total)}</span>
          </p>
        </dl>
      </div>

      <div className="border-t border-line pt-5">
        <Submit label={proposal ? "Save changes" : "Create proposal"} />
      </div>
    </form>
  );
}
