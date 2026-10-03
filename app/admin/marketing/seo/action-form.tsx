"use client";

import * as React from "react";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui";
import type { SeoActionState } from "./actions";

/**
 * One server action behind one button, with its outcome shown beside it.
 * Submitted by hand so a refusal does not reset what was typed, and with an
 * optional confirmation for actions that cannot be undone.
 */
export function ActionForm({
  action,
  label,
  pendingLabel,
  hidden,
  confirm,
  variant = "primary",
  children,
  className,
}: {
  action: (state: SeoActionState, formData: FormData) => Promise<SeoActionState>;
  label: string;
  pendingLabel?: string;
  hidden?: Record<string, string>;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
  children?: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<SeoActionState, FormData>(action, null);
  const [, startTransition] = React.useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  return (
    <form onSubmit={submit} className={className ?? "space-y-3"} noValidate>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? (pendingLabel ?? "Working…") : label}
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
            {state.data.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
