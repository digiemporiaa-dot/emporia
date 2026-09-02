"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker } from "@/components/admin/media-picker";
import { saveContractAction, type SalesActionState } from "../actions";

type Option = { id: string; name: string };

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Create contract"}
    </Button>
  );
}

/**
 * Draft a contract by hand. The usual route is to accept a proposal and draft
 * the contract from it, which carries the quoted total across untouched; this
 * form covers agreements that did not start life as a proposal.
 */
export function ContractForm({
  clients,
  proposals,
}: {
  clients: readonly Option[];
  proposals: readonly { id: string; label: string }[];
}) {
  const [state, formAction] = useActionState<SalesActionState, FormData>(saveContractAction, null);

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="max-w-2xl space-y-5" noValidate>
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
          Contract created. It is listed under Contracts.
        </div>
      ) : null}

      <Field id="title" label="Title" required error={err("title")}>
        {(aria) => <Input {...aria} name="title" required />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="clientId" label="Client" required error={err("clientId")}>
          {(aria) => (
            <Select {...aria} name="clientId" defaultValue="" required>
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="proposalId" label="From proposal" error={err("proposalId")}>
          {(aria) => (
            <Select {...aria} name="proposalId" defaultValue="">
              <option value="">None</option>
              {proposals.map((proposal) => (
                <option key={proposal.id} value={proposal.id}>
                  {proposal.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="value" label="Value" required hint="Digits only, e.g. 240000.00" error={err("value")}>
          {(aria) => <Input {...aria} name="value" inputMode="decimal" required />}
        </Field>
        <Field id="currency" label="Currency" error={err("currency")}>
          {(aria) => (
            <Select {...aria} name="currency" defaultValue="INR">
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="startsAt" label="Starts" required error={err("startsAt")}>
          {(aria) => <Input {...aria} name="startsAt" type="date" required />}
        </Field>
        <Field id="endsAt" label="Ends" error={err("endsAt")}>
          {(aria) => <Input {...aria} name="endsAt" type="date" />}
        </Field>
        <Field id="renewalAt" label="Renewal" error={err("renewalAt")}>
          {(aria) => <Input {...aria} name="renewalAt" type="date" />}
        </Field>
      </div>

      <Field id="terms" label="Terms" hint="Plain text, stored with the contract" error={err("terms")}>
        {(aria) => <Textarea {...aria} name="terms" rows={6} />}
      </Field>

      <MediaPicker
        name="documentId"
        label="Signed agreement"
        accept="DOCUMENT"
        hint="The client sees this under Documents in their portal"
      />

      <Submit />
    </form>
  );
}
