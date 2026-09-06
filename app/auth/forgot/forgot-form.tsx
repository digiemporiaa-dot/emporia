"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { requestResetAction, type ForgotState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Email me a link"}
    </Button>
  );
}

export function ForgotForm() {
  const [state, formAction] = useActionState<ForgotState, FormData>(requestResetAction, null);

  if (state?.done) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
      >
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        {/* Deliberately says nothing about whether the address exists. */}
        <span>
          If that address has an account, a reset link is on its way. It expires in an hour.
        </span>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state?.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <Field id="email" label="Email">
        {(aria) => (
          <Input {...aria} name="email" type="email" autoComplete="email" required autoFocus />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
