"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { AIDraft, AIError } from "@/components/admin/ai-draft";
import { assessLeadAction, summarizeLeadAction } from "@/app/admin/ai/actions";
import type { LeadAssessment, LeadSummary } from "@/lib/validation/ai";

/**
 * Drafting help on a lead.
 *
 * Both assists read; neither writes. The assessment sits next to the computed
 * score rather than replacing it — the number stays the rules engine's.
 */

type State =
  | { kind: "summary"; model: string; data: LeadSummary }
  | { kind: "assessment"; model: string; data: LeadAssessment }
  | null;

const CONFIDENCE_TONE: Record<LeadAssessment["confidence"], string> = {
  LOW: "text-ink-muted",
  MEDIUM: "text-warning",
  HIGH: "text-success",
};

export function LeadAssist({ leadId, computedScore }: { leadId: string; computedScore: number }) {
  const [pending, start] = useTransition();
  const [state, setState] = React.useState<State>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      await fn();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await summarizeLeadAction(leadId);
              if (result.ok) setState({ kind: "summary", model: result.data.model, data: result.data.data });
              else setError(result.message);
            })
          }
        >
          {pending ? "Reading…" : "Summarise"}
        </Button>

        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await assessLeadAction(leadId);
              if (result.ok) setState({ kind: "assessment", model: result.data.model, data: result.data.data });
              else setError(result.message);
            })
          }
        >
          {pending ? "Reading…" : "Assess"}
        </Button>
      </div>

      {error ? <AIError message={error} /> : null}

      {state?.kind === "summary" ? (
        <AIDraft model={state.model} onDismiss={() => setState(null)}>
          <p className="whitespace-pre-line text-sm text-ink">{state.data.summary}</p>

          <p className="mt-2.5 text-xs">
            <span className="font-medium text-navy-800">Suggested next step: </span>
            <span className="text-ink-muted">{state.data.nextStep}</span>
          </p>

          {state.data.questions.length > 0 ? (
            <div className="mt-2.5">
              <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Worth asking
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
                {state.data.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </AIDraft>
      ) : null}

      {state?.kind === "assessment" ? (
        <AIDraft model={state.model} onDismiss={() => setState(null)}>
          <p className="text-xs">
            <span className="font-medium text-navy-800">Read: </span>
            <span className={`font-medium ${CONFIDENCE_TONE[state.data.confidence]}`}>
              {state.data.confidence.toLowerCase()} confidence
            </span>
            {/* Shown beside the real score, never in place of it. */}
            <span className="text-ink-subtle"> · our rules scored this {computedScore}</span>
          </p>

          <p className="mt-2 whitespace-pre-line text-sm text-ink">{state.data.reasoning}</p>

          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
            <Points title="In its favour" items={state.data.strengths} />
            <Points title="Concerns" items={state.data.concerns} />
            <Points title="Not known" items={state.data.missing} />
          </div>
        </AIDraft>
      ) : null}
    </div>
  );
}

function Points({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-2xs text-ink-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
