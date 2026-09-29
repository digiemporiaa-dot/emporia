"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, ClipboardCheck, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Textarea } from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import type { InternalReviewStatus } from "@/generated/prisma/enums";
import { decideReviewAction, submitReviewAction, withdrawReviewAction } from "../actions";

/**
 * Internal review, before the client (brief §15).
 *
 * Someone submits the idea's versions; someone with the review permission
 * approves, asks for changes or rejects it, with feedback for the last two.
 * Every round stays listed with what it contained, so the history is intact.
 * Only an approval of the content as it stands now unlocks sending it to the
 * client.
 */

export type ReviewRoundRow = {
  id: string;
  round: number;
  status: InternalReviewStatus;
  note: string | null;
  feedback: string | null;
  submittedAt: string;
  submittedBy: string | null;
  decidedAt: string | null;
  reviewer: string | null;
  posts: { key: string; label: string; caption: string; media: number }[];
};

export const REVIEW_STATUS_LABEL: Record<InternalReviewStatus, string> = {
  PENDING: "Waiting for review",
  APPROVED: "Approved internally",
  CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export const REVIEW_STATUS_TONE: Record<InternalReviewStatus, "neutral" | "navy" | "red" | "success" | "warning"> = {
  PENDING: "warning",
  APPROVED: "success",
  CHANGES_REQUESTED: "warning",
  REJECTED: "red",
  WITHDRAWN: "neutral",
};

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function ReviewPanel({
  clientId,
  itemId,
  stage,
  rounds,
  approvedAsItStands,
  canSubmit,
  canReview,
}: {
  clientId: string;
  itemId: string;
  stage: string;
  rounds: ReviewRoundRow[];
  approvedAsItStands: boolean;
  canSubmit: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const latest = rounds[0] ?? null;
  const pending = latest?.status === "PENDING";
  const submittable = stage === "IDEA" || stage === "DRAFT" || stage === "INTERNAL_REVIEW";

  const run = async (work: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "That did not work.");
      return;
    }
    setText("");
    router.refresh();
  };

  const decide = (decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED") =>
    run(() => decideReviewAction({ clientId, itemId, decision, feedback: text.trim() || null }));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Internal review</CardTitle>
          {latest ? <Badge tone={REVIEW_STATUS_TONE[latest.status]}>{REVIEW_STATUS_LABEL[latest.status]}</Badge> : null}
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-md border border-brand-red/30 bg-brand-red/5 px-2.5 py-2 text-xs text-brand-red-text"
          >
            <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {pending ? (
          <>
            <p className="text-xs text-ink-muted">
              Round {latest.round}, submitted by {latest.submittedBy ?? "someone"} on{" "}
              {DATE.format(new Date(latest.submittedAt))}. Editing a version withdraws it.
            </p>
            {canReview ? (
              <div className="space-y-2">
                <Textarea
                  rows={3}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Feedback — required to ask for changes or reject."
                  aria-label="Review feedback"
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!ready || busy} onClick={() => decide("APPROVED")}>
                    <Check size={14} aria-hidden="true" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!ready || busy || text.trim().length < 3}
                    onClick={() => decide("CHANGES_REQUESTED")}
                  >
                    Request changes
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!ready || busy || text.trim().length < 3}
                    onClick={() => decide("REJECTED")}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-2xs text-ink-subtle">Waiting for someone who can review social content.</p>
            )}
            {canSubmit ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={!ready || busy}
                onClick={() => run(() => withdrawReviewAction({ clientId, itemId }))}
              >
                <Undo2 size={14} aria-hidden="true" />
                Withdraw submission
              </Button>
            ) : null}
          </>
        ) : approvedAsItStands ? (
          <p className="rounded-md border border-success/20 bg-success-bg px-2.5 py-2 text-xs text-success">
            Approved by {latest?.reviewer ?? "a reviewer"}. Ready to send to the client.
          </p>
        ) : submittable && canSubmit ? (
          <div className="space-y-2">
            {latest?.status === "APPROVED" ? (
              <p className="text-2xs text-warning">
                The content changed after it was approved. Submit it again before it goes to the client.
              </p>
            ) : null}
            <Textarea
              rows={2}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Anything the reviewer should look at."
              aria-label="Note to the reviewer"
            />
            <Button
              size="sm"
              disabled={!ready || busy}
              onClick={() => run(() => submitReviewAction({ clientId, itemId, note: text.trim() || null }))}
            >
              <ClipboardCheck size={14} aria-hidden="true" />
              Submit for internal review
            </Button>
          </div>
        ) : !submittable ? (
          <p className="text-2xs text-ink-subtle">Past internal review.</p>
        ) : (
          <p className="text-2xs text-ink-subtle">You do not have permission to submit content for review.</p>
        )}

        {rounds.length > 0 ? (
          <ol className="space-y-2.5 border-t border-line pt-3">
            {rounds.map((round) => (
              <li key={round.id} className="border-l-2 border-line pl-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs text-navy-800">Round {round.round}</p>
                  <span className="text-2xs text-ink-subtle">{DATE.format(new Date(round.submittedAt))}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={REVIEW_STATUS_TONE[round.status]}>{REVIEW_STATUS_LABEL[round.status]}</Badge>
                  <span className="text-2xs text-ink-subtle">
                    by {round.submittedBy ?? "someone"}
                    {round.reviewer ? ` · decided by ${round.reviewer}` : ""}
                  </span>
                </div>
                {round.note ? <p className="mt-1 whitespace-pre-wrap text-2xs text-ink-muted">{round.note}</p> : null}
                {round.feedback ? (
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-warning/30 bg-warning-bg px-2 py-1.5 text-2xs text-warning">
                    {round.feedback}
                  </p>
                ) : null}
                {round.posts.length > 0 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-2xs text-ink-subtle">What was submitted</summary>
                    <ul className="mt-1 space-y-1">
                      {round.posts.map((post) => (
                        <li key={post.key} className="text-2xs text-ink-muted">
                          <span className="font-medium text-navy-800">{post.label}</span>
                          {post.media ? ` · ${post.media} creative${post.media === 1 ? "" : "s"}` : ""}
                          <span className="block line-clamp-3 whitespace-pre-wrap">{post.caption || "No caption."}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </CardBody>
    </Card>
  );
}
