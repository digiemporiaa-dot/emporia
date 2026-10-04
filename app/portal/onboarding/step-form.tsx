"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui";
import type { StepState } from "./actions";

/**
 * One onboarding step's form. Submitted by hand so a refusal keeps what was
 * typed; field errors are offered to the children through `errors`.
 */
export function StepForm({
  action,
  label = "Save",
  hidden,
  children,
}: {
  action: (state: StepState, formData: FormData) => Promise<StepState>;
  label?: string;
  hidden?: Record<string, string>;
  children: (errors: Record<string, string | undefined>) => React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<StepState, FormData>(action, null);
  const [, startTransition] = React.useTransition();
  const details = (state && !state.ok ? state.details : null) as Record<string, string[]> | null | undefined;
  const errors = new Proxy({} as Record<string, string | undefined>, { get: (_t, key: string) => details?.[key]?.[0] });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children(errors)}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : label}
        </Button>
        {state && !state.ok ? (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
            <AlertCircle size={14} aria-hidden="true" className="mt-px shrink-0" />
            {state.message}
          </p>
        ) : null}
        {state?.ok ? (
          <p role="status" className="flex items-start gap-1.5 text-xs text-success">
            <CheckCircle2 size={14} aria-hidden="true" className="mt-px shrink-0" />
            {state.data.message} Account setup: {state.data.percent}%.
          </p>
        ) : null}
      </div>
    </form>
  );
}
