"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

/**
 * The banner and submit button every admin form repeats.
 *
 * Extracted when the content library added five more forms that all needed the
 * same three states — rejected, saved, saving. The `role="alert"` /
 * `role="status"` split matters: a failure interrupts a screen reader, a
 * success does not (CLAUDE.md 12).
 */

export function FormStatus({
  state,
  savedMessage = "Saved.",
}: {
  state: ActionResult<unknown> | null;
  savedMessage?: string;
}) {
  if (!state) return null;

  if (!state.ok) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
      >
        <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{state.message}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
    >
      {savedMessage}
    </div>
  );
}

/** Field-level messages, keyed by input name, from a rejected action. */
export function fieldErrors(state: ActionResult<unknown> | null): Record<string, string[]> {
  if (!state || state.ok) return {};
  const details = state.details;
  return details && typeof details === "object" ? (details as Record<string, string[]>) : {};
}

/**
 * Whether this component is alive in the browser yet.
 *
 * Only needed by a form that posts part of its content as JSON in a hidden
 * field — the structured editors, where React is the only thing that writes
 * that field. React's progressive enhancement will happily submit such a form
 * before hydration, which posts whatever the server rendered and silently
 * discards everything just typed. Gating the submit button on this is the fix.
 *
 * A form built entirely from ordinary named inputs does not need it, and should
 * not use it: those submit correctly with no JavaScript at all.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  return hydrated;
}

export function SubmitButton({
  label = "Save",
  ready = true,
}: {
  label?: string;
  ready?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || !ready}>
      {pending ? "Saving…" : label}
    </Button>
  );
}
