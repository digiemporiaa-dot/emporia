"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { completeResetAction, type ResetState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Set my password"}
    </Button>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetState, FormData>(completeResetAction, null);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Your password is set. You can sign in with it now.</span>
        </div>
        <Link href="/auth/login">
          <Button size="lg" className="w-full">
            Sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <Field id="password" label="New password">
        {(aria) => (
          <Input
            {...aria}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
          />
        )}
      </Field>

      <Field id="confirmPassword" label="Confirm it">
        {(aria) => (
          <Input
            {...aria}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
