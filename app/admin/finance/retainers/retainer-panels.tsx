"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { saveRetainerAction, setRetainerStatusAction, type FinanceActionState } from "../actions";
import type { RetainerStatus } from "@/generated/prisma/enums";

/** Creating a retainer, and pausing or ending one. */

const CYCLES = [
  ["MONTHLY", "Monthly"],
  ["QUARTERLY", "Quarterly"],
  ["HALF_YEARLY", "Half-yearly"],
  ["ANNUAL", "Annual"],
] as const;

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function NewRetainer({ clients }: { clients: readonly { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, formAction] = useActionState<FinanceActionState, FormData>(
    saveRetainerAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (clients.length === 0) {
    return (
      <p className="text-xs text-ink-subtle">
        There are no clients yet, so there is nothing to put on retainer.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3" noValidate>
      {state && !state.ok ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="flex items-start gap-1.5 text-xs text-success">
          <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          Added. Its first invoice is raised when you bill due retainers.
        </p>
      ) : null}

      <Field id="retainer-client" label="Client" required>
        {(aria) => (
          <Select {...aria} name="clientId" required defaultValue="">
            <option value="">Choose a client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="retainer-name" label="What it covers" required>
        {(aria) => (
          <Input {...aria} name="name" placeholder="SEO retainer" maxLength={160} required />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="retainer-amount" label="Amount per cycle" required>
          {(aria) => <Input {...aria} name="amount" inputMode="decimal" required />}
        </Field>

        <Field id="retainer-currency" label="Currency">
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

        <Field id="retainer-cycle" label="Billed">
          {(aria) => (
            <Select {...aria} name="cycle" defaultValue="MONTHLY">
              {CYCLES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="retainer-starts" label="Starts" required>
          {(aria) => (
            <Input
              {...aria}
              name="startsAt"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          )}
        </Field>
      </div>

      <Field id="retainer-ends" label="Ends" hint="Leave blank for an open-ended retainer">
        {(aria) => <Input {...aria} name="endsAt" type="date" />}
      </Field>

      <Submit label="Add retainer" />
    </form>
  );
}

export function RetainerStatusControl({
  retainerId,
  status,
}: {
  retainerId: string;
  status: RetainerStatus;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  if (status === "CANCELLED" || status === "EXPIRED") {
    return (
      <span className="text-2xs text-ink-subtle">
        {status === "EXPIRED" ? "Expired" : "Ended"}
      </span>
    );
  }

  const run = (next: "ACTIVE" | "PAUSED" | "CANCELLED") =>
    start(async () => {
      setError(null);
      const result = await setRetainerStatusAction(retainerId, next);
      if (result.ok) router.refresh();
      else setError(result.message);
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {status === "ACTIVE" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("PAUSED")}
            className="text-2xs font-medium text-ink-muted underline underline-offset-2 hover:text-navy-800"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("ACTIVE")}
            className="text-2xs font-medium text-ink-muted underline underline-offset-2 hover:text-navy-800"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run("CANCELLED")}
          className="text-2xs font-medium text-ink-muted underline underline-offset-2 hover:text-brand-red-text"
        >
          End
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-2xs text-brand-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
