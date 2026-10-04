"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { saveAccessEmailAction, toggleNotApplicableAction, type StaffOnboardingState } from "./actions";

function useManualSubmit(action: (state: StaffOnboardingState, formData: FormData) => Promise<StaffOnboardingState>) {
  const [state, formAction, pending] = useActionState<StaffOnboardingState, FormData>(action, null);
  const [, startTransition] = React.useTransition();
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  return { state, pending, onSubmit };
}

/** Mark a step not applicable for this client, or applicable again. */
export function NotApplicableToggle({ clientId, step, notApplicable }: { clientId: string; step: string; notApplicable: boolean }) {
  const { state, pending, onSubmit } = useManualSubmit(toggleNotApplicableAction);
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="notApplicable" value={notApplicable ? "false" : "true"} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {notApplicable ? "Needed after all" : "Not needed"}
      </Button>
      {state && !state.ok ? <span role="alert" className="text-2xs text-brand-red-text">{state.message}</span> : null}
    </form>
  );
}

export function AccessEmailForm({ email }: { email: string | null }) {
  const { state, pending, onSubmit } = useManualSubmit(saveAccessEmailAction);
  return (
    <form onSubmit={onSubmit} className="space-y-2" noValidate>
      <label htmlFor="access-email" className="block text-xs text-ink-muted">
        The address clients add to their website and Analytics (all clients)
      </label>
      <div className="flex flex-wrap gap-2">
        <Input id="access-email" name="email" type="email" defaultValue={email ?? ""} placeholder="access@youragency.com" className="max-w-xs" />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state && !state.ok ? <p role="alert" className="text-xs text-brand-red-text">{state.message}</p> : null}
      {state?.ok ? <p role="status" className="text-xs text-success">{state.data.message}</p> : null}
    </form>
  );
}
