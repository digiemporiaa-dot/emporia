"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { acceptInviteAction, type InviteState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Setting up…" : "Set my password"}
    </Button>
  );
}

export function InviteForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<InviteState, FormData>(acceptInviteAction, null);

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success">
          <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          Your account is ready. Sign in with {state.data.email}.
        </p>
        <Link href="/auth/login">
          <Button className="w-full">Go to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      {state && !state.ok ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      ) : null}

      <Field
        id="password"
        label="Choose a password"
        required
        hint="At least 12 characters"
        error={fieldErrors?.["password"]?.[0]}
      >
        {(aria) => (
          <Input {...aria} name="password" type="password" autoComplete="new-password" required />
        )}
      </Field>

      <Field
        id="confirmPassword"
        label="Confirm password"
        required
        error={fieldErrors?.["confirmPassword"]?.[0]}
      >
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

      <Submit />
    </form>
  );
}
