"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { saveOpportunityAction, type SalesActionState } from "../actions";

type Option = { id: string; name: string };

type Opportunity = {
  id: string;
  title: string;
  value: string;
  currency: string;
  stage: string;
  probability: number;
  expectedCloseAt: Date | null;
  ownerId: string;
  leadId: string | null;
  clientId: string | null;
};

const STAGES = ["DISCOVERY", "SCOPING", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Opportunity form. Value is typed and submitted as a string and stays one all
 * the way to Prisma — a deal value must never round-trip through a JS number
 * (CLAUDE.md 2 rule 1).
 */
export function OpportunityForm({
  opportunity,
  owners,
  leads,
  clients,
}: {
  opportunity?: Opportunity;
  owners: readonly Option[];
  leads: readonly Option[];
  clients: readonly Option[];
}) {
  const [state, formAction] = useActionState<SalesActionState, FormData>(
    saveOpportunityAction,
    null,
  );

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="max-w-2xl space-y-5" noValidate>
      {opportunity ? <input type="hidden" name="id" value={opportunity.id} /> : null}

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
          Saved.
        </div>
      ) : null}

      <Field id="title" label="Title" required error={err("title")}>
        {(aria) => <Input {...aria} name="title" defaultValue={opportunity?.title} required />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="value" label="Value" required hint="Digits only, e.g. 240000.00" error={err("value")}>
          {(aria) => (
            <Input
              {...aria}
              name="value"
              inputMode="decimal"
              defaultValue={opportunity?.value ?? ""}
              required
            />
          )}
        </Field>
        <Field id="currency" label="Currency" error={err("currency")}>
          {(aria) => (
            <Select {...aria} name="currency" defaultValue={opportunity?.currency ?? "INR"}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="stage" label="Stage" error={err("stage")}>
          {(aria) => (
            <Select {...aria} name="stage" defaultValue={opportunity?.stage ?? "DISCOVERY"}>
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage.charAt(0) + stage.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id="probability"
          label="Probability"
          hint="Percent, 0–100"
          error={err("probability")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="probability"
              type="number"
              min={0}
              max={100}
              defaultValue={opportunity?.probability ?? 0}
            />
          )}
        </Field>
        <Field id="expectedCloseAt" label="Expected close" error={err("expectedCloseAt")}>
          {(aria) => (
            <Input
              {...aria}
              name="expectedCloseAt"
              type="date"
              defaultValue={isoDate(opportunity?.expectedCloseAt)}
            />
          )}
        </Field>
        <Field id="ownerId" label="Owner" required error={err("ownerId")}>
          {(aria) => (
            <Select {...aria} name="ownerId" defaultValue={opportunity?.ownerId ?? ""} required>
              <option value="">Choose an owner</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {opportunity ? null : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="leadId" label="Lead" hint="A lead or a client — one of the two" error={err("leadId")}>
            {(aria) => (
              <Select {...aria} name="leadId" defaultValue="">
                <option value="">None</option>
                {leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="clientId" label="Client" error={err("clientId")}>
            {(aria) => (
              <Select {...aria} name="clientId" defaultValue="">
                <option value="">None</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}

      <Submit label={opportunity ? "Save opportunity" : "Create opportunity"} />
    </form>
  );
}
