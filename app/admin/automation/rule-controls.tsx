"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui";
import {
  deleteAutomationAction,
  previewAutomationAction,
  setAutomationActiveAction,
} from "./actions";

/** Switching a rule on and off, deleting it, and trying it without running it. */

export function RuleToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={isActive ? "secondary" : "primary"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await setAutomationActiveAction(id, !isActive);
            if (result.ok) router.refresh();
            else setError(result.message);
          })
        }
      >
        {isActive ? "Switch off" : "Switch on"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-64 text-right text-2xs text-brand-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function DeleteRule({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!confirming) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
        Delete rule
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Delete this rule? Its history stays in the audit trail.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await deleteAutomationAction(id);
              if (result.ok) router.push("/admin/automation");
              else setError(result.message);
            })
          }
        >
          Delete
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-2xs text-brand-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Try a rule against a real lead.
 *
 * Reports whether it matches and what would run. Nothing is executed, so this
 * is safe to point at a live record.
 */
export function PreviewRule({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [leadId, setLeadId] = React.useState("");
  const [result, setResult] = React.useState<
    | { ok: true; matched: boolean; actions: string[]; facts: [string, string][] }
    | { ok: false; message: string }
    | null
  >(null);

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-ink-subtle">
        Paste a lead id to see whether this rule matches it. Nothing runs.
      </p>

      <label htmlFor="preview-lead" className="sr-only">
        Lead id
      </label>
      <input
        id="preview-lead"
        value={leadId}
        onChange={(event) => setLeadId(event.target.value)}
        placeholder="Lead id"
        className="h-9 w-full rounded-sm border border-line bg-white px-2 font-mono text-xs focus:border-brand-red"
      />

      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const outcome = await previewAutomationAction(id, leadId);
            setResult(
              outcome.ok
                ? { ok: true, ...outcome.data }
                : { ok: false, message: outcome.message },
            );
          })
        }
      >
        {pending ? "Checking…" : "Try it"}
      </Button>

      {result ? (
        result.ok ? (
          <div role="status" className="space-y-1.5">
            <p
              className={`flex items-start gap-1.5 text-xs ${
                result.matched ? "text-success" : "text-ink-muted"
              }`}
            >
              {result.matched ? (
                <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
              )}
              {result.matched
                ? `Matches. Would run: ${result.actions.join(", ")}.`
                : "Does not match this record."}
            </p>
            <details className="text-2xs text-ink-subtle">
              <summary className="cursor-pointer">What the rule can see</summary>
              <dl className="mt-1 space-y-0.5">
                {result.facts.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="font-mono">{key}</dt>
                    <dd className="truncate text-ink-muted">{value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        ) : (
          <p role="alert" className="text-xs text-brand-red-text">
            {result.message}
          </p>
        )
      ) : null}
    </div>
  );
}
