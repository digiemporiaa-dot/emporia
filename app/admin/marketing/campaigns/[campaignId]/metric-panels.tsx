"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import {
  deleteMetricAction,
  importMetricsAction,
  recordMetricAction,
  type CampaignActionState,
} from "../actions";

/**
 * Entering performance data.
 *
 * Both routes into the database are here, and both are the same thing: a person
 * transcribing numbers the ad platform reported. Nothing estimates a missing
 * day, and a revenue box left blank stays blank rather than becoming a zero
 * that would read as a measurement (CLAUDE.md 2 rule 5).
 */

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function RecordMetric({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState<CampaignActionState, FormData>(
    recordMetricAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="campaignId" value={campaignId} />

      <p className="text-xs text-ink-subtle">
        One row per day. Re-entering a day corrects it rather than adding a second row.
      </p>

      <Field id="metric-date" label="Date" required>
        {(aria) => (
          <Input
            {...aria}
            name="date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field id="metric-impressions" label="Impressions">
          {(aria) => <Input {...aria} name="impressions" inputMode="numeric" defaultValue="0" />}
        </Field>
        <Field id="metric-clicks" label="Clicks">
          {(aria) => <Input {...aria} name="clicks" inputMode="numeric" defaultValue="0" />}
        </Field>
        <Field id="metric-conversions" label="Conversions">
          {(aria) => <Input {...aria} name="conversions" inputMode="numeric" defaultValue="0" />}
        </Field>
        <Field id="metric-spend" label="Spend">
          {(aria) => <Input {...aria} name="spend" inputMode="decimal" defaultValue="0.00" />}
        </Field>
      </div>

      <Field
        id="metric-revenue"
        label="Revenue"
        hint="Leave blank if the platform cannot attribute it"
      >
        {(aria) => <Input {...aria} name="revenue" inputMode="decimal" />}
      </Field>

      {state && !state.ok ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="flex items-start gap-1.5 text-xs text-success">
          <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          Recorded.
        </p>
      ) : null}

      <Submit label="Record day" />
    </form>
  );
}

export function ImportMetrics({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = React.useState<
    { ok: true; imported: number; rejected: string[] } | { ok: false; message: string } | null
  >(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setOutcome(null);
    start(async () => {
      const result = await importMetricsAction(formData);
      setOutcome(
        result.ok
          ? { ok: true, imported: result.data.imported, rejected: result.data.rejected }
          : { ok: false, message: result.message },
      );
      if (result.ok) router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="campaignId" value={campaignId} />

      <p className="text-xs text-ink-subtle">
        Paste rows exported from the ad platform, as{" "}
        <code className="font-mono text-2xs">date,impressions,clicks,conversions,spend,revenue</code>
        . A header line is optional and the revenue column may be left empty.
      </p>

      <Field id="import-csv" label="Rows">
        {(aria) => (
          <Textarea
            {...aria}
            name="csv"
            rows={6}
            className="font-mono text-2xs"
            placeholder={"2026-03-01,5000,120,4,9000.00,45000.00\n2026-03-02,6000,140,5,9500.50,"}
          />
        )}
      </Field>

      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Importing…" : "Import rows"}
      </Button>

      {outcome ? (
        outcome.ok ? (
          <div role="status" className="space-y-1.5">
            <p className="flex items-start gap-1.5 text-xs text-success">
              <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
              {outcome.imported} day{outcome.imported === 1 ? "" : "s"} imported.
            </p>
            {/* Rejected rows are named, never silently dropped. */}
            {outcome.rejected.length > 0 ? (
              <ul className="space-y-0.5 border-l-2 border-warning/40 pl-2.5">
                {outcome.rejected.map((message) => (
                  <li key={message} className="text-2xs text-warning">
                    {message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
            <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            {outcome.message}
          </p>
        )
      ) : null}
    </form>
  );
}

export function DeleteMetric({ id, campaignId }: { id: string; campaignId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await deleteMetricAction(id, campaignId);
            if (result.ok) router.refresh();
            else setError(result.message);
          })
        }
        className="rounded-sm p-1 text-ink-subtle hover:bg-red-50 hover:text-brand-red"
      >
        <Trash2 size={13} aria-hidden="true" />
        <span className="sr-only">Delete this day</span>
      </button>
      {error ? (
        <span role="alert" className="block text-2xs text-brand-red">
          {error}
        </span>
      ) : null}
    </>
  );
}
