"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, Textarea, useToast } from "@/components/ui";
import { setWorkflowAction } from "../../actions";

/**
 * Editorial workflow.
 *
 * Deliberately four states and a handful of moves, laid out as the buttons that
 * are actually available from where the page is — rather than a status dropdown
 * offering transitions the service will refuse.
 *
 * The note travels with a decision, so "changes requested" can say what to
 * change. Submitting for review clears it: a reviewer's note about work that
 * has since been redone is worse than no note.
 */

type Workflow = "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";

const LABEL: Record<Workflow, string> = {
  DRAFT: "In progress",
  IN_REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
};

const TONE: Record<Workflow, string> = {
  DRAFT: "border-line bg-surface-muted text-ink-muted",
  IN_REVIEW: "border-warning/30 bg-warning-bg text-warning",
  CHANGES_REQUESTED: "border-red-100 bg-red-50 text-brand-red-text",
  APPROVED: "border-success/30 bg-success-bg text-success",
};

/** What can be reached from here, and who may do it. */
const MOVES: Record<Workflow, readonly { to: Workflow; label: string; decision: boolean }[]> = {
  DRAFT: [{ to: "IN_REVIEW", label: "Submit for review", decision: false }],
  IN_REVIEW: [
    { to: "APPROVED", label: "Approve", decision: true },
    { to: "CHANGES_REQUESTED", label: "Request changes", decision: true },
    { to: "DRAFT", label: "Withdraw", decision: false },
  ],
  CHANGES_REQUESTED: [
    { to: "IN_REVIEW", label: "Resubmit", decision: false },
    { to: "DRAFT", label: "Back to in progress", decision: false },
  ],
  APPROVED: [
    { to: "IN_REVIEW", label: "Send back to review", decision: true },
    { to: "DRAFT", label: "Back to in progress", decision: false },
  ],
};

export function WorkflowPanel({
  pageId,
  workflow,
  reviewNote,
  canEdit,
  canDecide,
}: {
  pageId: string;
  workflow: Workflow;
  reviewNote: string | null;
  canEdit: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");

  const moves = MOVES[workflow].filter((move) => (move.decision ? canDecide : canEdit));

  const go = (to: Workflow, label: string) => {
    startTransition(async () => {
      const result = await setWorkflowAction(pageId, to, note);
      if (result?.ok) {
        push({ tone: "success", title: `${label}.` });
        setNote("");
        router.refresh();
        return;
      }
      push({ tone: "error", title: "That did not work.", description: result?.message });
    });
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg text-navy-800">Review</h2>
          <span className={`rounded-md border px-2.5 py-1 text-xs font-medium ${TONE[workflow]}`}>
            {LABEL[workflow]}
          </span>
        </div>

        {reviewNote ? (
          <blockquote className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted">
            {reviewNote}
          </blockquote>
        ) : null}

        <p className="text-xs text-ink-subtle">
          Review gates publishing. Because sections are edited in place, a page that is already live
          shows its edits immediately — review is the check before it goes out, not a hold on what
          is already out.
        </p>

        {moves.length === 0 ? (
          <p className="text-xs text-ink-subtle">Nothing to do from here with your permissions.</p>
        ) : (
          <>
            {moves.some((move) => move.decision) ? (
              <Textarea
                rows={2}
                value={note}
                aria-label="Note for whoever picks this up"
                placeholder="What needs changing, if anything."
                onChange={(event) => setNote(event.target.value)}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              {moves.map((move, index) => (
                <Button
                  key={move.to}
                  type="button"
                  size="sm"
                  variant={index === 0 ? "primary" : "secondary"}
                  disabled={pending}
                  onClick={() => go(move.to, move.label)}
                >
                  {move.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
