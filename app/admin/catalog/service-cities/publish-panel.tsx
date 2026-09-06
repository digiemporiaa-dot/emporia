"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import { publishPageAction, type PublishState } from "../actions";

export type CheckRow = { key: string; label: string; passed: boolean; detail?: string };

function Submit({ label, variant }: { label: string; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

/**
 * Publishability checklist.
 *
 * Shows progress rather than only failing at the last step: the author can see
 * which requirements are outstanding while writing, and the publish button
 * still calls the server, which re-checks. This panel is a convenience — the
 * gate is `publishPage` in the service layer.
 */
export function PublishPanel({
  pageId,
  status,
  checks,
  canPublishNow,
}: {
  pageId: string;
  status: string;
  checks: readonly CheckRow[];
  canPublishNow: boolean;
}) {
  const [state, formAction] = useActionState<PublishState, FormData>(publishPageAction, null);
  const passed = checks.filter((c) => c.passed).length;

  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-navy-800">Ready to publish?</h2>
        <span className="text-xs tabular-nums text-ink-subtle">
          {passed} of {checks.length}
        </span>
      </div>

      <ul className="divide-y divide-line">
        {checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2.5 px-4 py-2.5">
            {check.passed ? (
              <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
            ) : (
              <X size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-red" />
            )}
            <span className="min-w-0 flex-1">
              <span className={check.passed ? "text-sm text-ink-muted" : "text-sm text-navy-800"}>
                {check.label}
              </span>
              {check.detail ? (
                <span className="block text-xs text-ink-subtle">{check.detail}</span>
              ) : null}
            </span>
            <span className="sr-only">{check.passed ? "Met" : "Not met"}</span>
          </li>
        ))}
      </ul>

      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-t border-line bg-red-50 px-4 py-3 text-xs text-brand-red-text"
        >
          <AlertCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <form action={formAction} className="flex items-center gap-2 border-t border-line px-4 py-3">
        <input type="hidden" name="id" value={pageId} />
        {status === "PUBLISHED" ? (
          <>
            <input type="hidden" name="intent" value="unpublish" />
            <Submit label="Unpublish" variant="secondary" />
          </>
        ) : (
          <>
            <input type="hidden" name="intent" value="publish" />
            <Submit label="Publish" />
            {!canPublishNow ? (
              <span className="text-xs text-ink-subtle">
                Outstanding requirements will block this.
              </span>
            ) : null}
          </>
        )}
      </form>
    </div>
  );
}
