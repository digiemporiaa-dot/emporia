"use client";

import * as React from "react";
import { useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { markSignedAction } from "../../actions";

/**
 * Record a signature obtained elsewhere.
 *
 * There is no e-signature provider wired up, so this does not capture a
 * signature — it records that one exists, with the date it was given. Claiming
 * otherwise would be a fake (CLAUDE.md 2 rule 5).
 */
export function SignPanel({ contractId }: { contractId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [signedAt, setSignedAt] = React.useState(() => new Date().toISOString().slice(0, 10));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await markSignedAction(contractId, signedAt);
      if (result.ok) setDone(true);
      else setError(result.message);
    });
  }

  if (done) {
    return (
      <p role="status" className="flex items-start gap-1.5 text-xs text-success">
        <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
        Recorded as signed.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <label htmlFor="signedAt" className="block text-xs text-ink-subtle">
        Date signed
      </label>
      <Input
        id="signedAt"
        name="signedAt"
        type="date"
        value={signedAt}
        onChange={(event) => setSignedAt(event.target.value)}
        required
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Recording…" : "Mark signed"}
      </Button>
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </form>
  );
}
