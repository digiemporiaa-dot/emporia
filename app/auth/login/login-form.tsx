"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { loginAction, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-brand-red"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      ) : null}

      <Field id="email" label="Email">
        {(aria) => (
          <Input
            {...aria}
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder="you@agency.com"
          />
        )}
      </Field>

      <Field id="password" label="Password">
        {(aria) => (
          <Input {...aria} name="password" type="password" autoComplete="current-password" required />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
