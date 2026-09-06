"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import {
  changePasswordAction,
  updateProfileAction,
  type PortalActionState,
} from "../actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Problem({ state }: { state: PortalActionState }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {state.message}
    </p>
  );
}

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const [state, formAction] = useActionState<PortalActionState, FormData>(
    updateProfileAction,
    null,
  );

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;

  return (
    <form action={formAction} className="max-w-md space-y-4" noValidate>
      <Field id="name" label="Your name" required error={fieldErrors?.["name"]?.[0]}>
        {(aria) => <Input {...aria} name="name" defaultValue={name} required />}
      </Field>
      <Field id="phone" label="Phone" error={fieldErrors?.["phone"]?.[0]}>
        {(aria) => <Input {...aria} name="phone" defaultValue={phone ?? ""} />}
      </Field>

      <Problem state={state} />
      {state?.ok ? (
        <p role="status" className="text-xs text-success">
          Saved.
        </p>
      ) : null}

      <Submit label="Save" />
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState<PortalActionState, FormData>(
    changePasswordAction,
    null,
  );

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;

  return (
    <form action={formAction} className="max-w-md space-y-4" noValidate>
      <Field id="currentPassword" label="Current password" required>
        {(aria) => (
          <Input
            {...aria}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <Field
        id="newPassword"
        label="New password"
        required
        hint="At least 12 characters"
        error={fieldErrors?.["newPassword"]?.[0]}
      >
        {(aria) => (
          <Input {...aria} name="newPassword" type="password" autoComplete="new-password" required />
        )}
      </Field>
      <Field
        id="confirmPassword"
        label="Confirm new password"
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

      <Problem state={state} />
      {state?.ok ? (
        <p role="status" className="text-xs text-success">
          Password changed.
        </p>
      ) : null}

      <Submit label="Change password" />
    </form>
  );
}
