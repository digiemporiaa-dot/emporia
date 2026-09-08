"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, KeyRound } from "lucide-react";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";
import {
  clearCapiTokenAction,
  saveCapiTokenAction,
  type TrackingActionState,
} from "./actions";

/**
 * The Meta Conversions API access token.
 *
 * Its own form, and its own server action, for one reason: the token is never
 * sent back to the browser. What arrives here is a mask — the last four
 * characters — so the page can say whether a token exists without the value
 * appearing in the HTML, in the React payload, or in a devtools inspection
 * (CLAUDE.md 2 rule 6).
 *
 * Saving replaces; there is no "edit". A write-only field is the only shape
 * that keeps that property.
 */

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function Clear() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? "Removing…" : "Remove token"}
    </Button>
  );
}

export function CapiTokenForm({
  masked,
  unreadable,
}: {
  masked: string | null;
  unreadable: boolean;
}) {
  const [saveState, saveAction] = useActionState<TrackingActionState, FormData>(
    saveCapiTokenAction,
    null,
  );
  const [clearState, clearAction] = useActionState<TrackingActionState, FormData>(
    clearCapiTokenAction,
    null,
  );

  const failure = [saveState, clearState].find((s) => s && !s.ok);
  const success = [saveState, clearState].some((s) => s?.ok);

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-2">
          <KeyRound size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-red" />
          <div>
            <h3 className="font-display text-sm text-navy-800">Conversions API access token</h3>
            <p className="mt-1 text-xs text-ink-subtle">
              Encrypted before it is stored and never sent to the browser. Saving a new token
              replaces the old one.
            </p>
          </div>
        </div>

        {failure && !failure.ok ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{failure.message}</span>
          </div>
        ) : null}

        {success && !failure ? (
          <div
            role="status"
            className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
          >
            Saved.
          </div>
        ) : null}

        {unreadable ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3.5 py-3 text-sm text-warning"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              A token is stored but can no longer be decrypted — this happens when AUTH_SECRET is
              rotated. Server-side events will not send until it is entered again.
            </span>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">
            {masked ? (
              <>
                Stored: <span className="font-mono tabular-nums">{masked}</span>
              </>
            ) : (
              "No token stored."
            )}
          </p>
        )}

        <form action={saveAction} className="space-y-3" noValidate>
          <Field
            id="capiToken"
            label={masked ? "Replace token" : "Access token"}
            hint="Generated in Meta Events Manager under the pixel's Conversions API settings."
          >
            {(aria) => (
              <Input
                {...aria}
                name="token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="EAA…"
              />
            )}
          </Field>
          <Submit label={masked ? "Replace token" : "Save token"} busy="Saving…" />
        </form>

        {masked || unreadable ? (
          <form action={clearAction} className="border-t border-line pt-3">
            <p className="mb-2 text-xs text-ink-subtle">
              Removing the token also switches server-side purchases off — leaving them on would
              mean every purchase attempting a send that cannot succeed.
            </p>
            <Clear />
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
