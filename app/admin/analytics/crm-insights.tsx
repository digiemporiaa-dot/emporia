"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { AIDraft, AIError } from "@/components/admin/ai-draft";
import { analyzeCRMAction } from "@/app/admin/ai/actions";

/**
 * Commentary on the figures above.
 *
 * The figures it was given are rendered from what the service returned, not
 * parsed out of the model's prose — so the numbers on this panel are ours even
 * when the sentences are not (CLAUDE.md 16).
 */
export function CRMInsights({ range }: { range: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = React.useState<
    { model: string; prose: string; facts: [string, string][] } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const outcome = await analyzeCRMAction(range);
            if (outcome.ok) {
              setResult({
                model: outcome.data.model,
                prose: outcome.data.data.prose,
                facts: outcome.data.data.facts,
              });
            } else {
              setResult(null);
              setError(outcome.message);
            }
          })
        }
      >
        {pending ? "Reading the numbers…" : "What stands out?"}
      </Button>

      {error ? <AIError message={error} /> : null}

      {result ? (
        <AIDraft model={result.model} onDismiss={() => setResult(null)}>
          <p className="whitespace-pre-line text-sm text-ink">{result.prose}</p>

          <details className="mt-3">
            <summary className="cursor-pointer text-2xs text-ink-subtle">
              The {result.facts.length} figures it was given, from our database
            </summary>
            <dl className="mt-1.5 space-y-0.5">
              {result.facts.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3 text-2xs">
                  <dt className="text-ink-subtle">{key}</dt>
                  <dd className="text-right tabular-nums text-ink-muted">{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </AIDraft>
      ) : null}
    </div>
  );
}
