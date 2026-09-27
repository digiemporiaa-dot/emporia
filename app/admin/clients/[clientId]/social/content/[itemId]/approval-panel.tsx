"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Send, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Textarea } from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import { APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE } from "@/lib/projects/lifecycle";
import { requestApprovalAction, withdrawApprovalAction } from "../actions";
import type { ApprovalStatus } from "@/generated/prisma/enums";

/**
 * Client sign-off, from the agency's side.
 *
 * Deliberately small. The decision itself belongs to the client and happens in
 * the portal; what an agency needs here is to send, to see what came back, and
 * to pull something back when they spot a problem before the client does.
 */

export type ApprovalVersionRow = {
  id: string;
  version: number;
  status: ApprovalStatus;
  notes: string | null;
  feedback: string | null;
  createdAt: string;
  createdBy: string | null;
  postCount: number;
};

export type ApprovalSummary = {
  id: string;
  status: ApprovalStatus;
  currentVersion: number;
  decidedAt: string | null;
  decidedBy: string | null;
  versions: ApprovalVersionRow[];
};

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function ApprovalPanel({
  clientId,
  itemId,
  stage,
  approval,
  canApprove,
}: {
  clientId: string;
  itemId: string;
  stage: string;
  approval: ApprovalSummary | null;
  canApprove: boolean;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const pending = approval?.status === "PENDING";
  // The service refuses anything outside these two stages, so the button says
  // so instead of offering a click that comes back as an error.
  const sendable = stage === "DRAFT" || stage === "INTERNAL_REVIEW";

  const run = async (work: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "That did not work.");
      return;
    }
    setNote("");
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Client approval</CardTitle>
          {approval ? (
            <Badge tone={APPROVAL_STATUS_TONE[approval.status]}>
              {APPROVAL_STATUS_LABEL[approval.status]}
            </Badge>
          ) : null}
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
              With the client since {DATE.format(new Date(approval.versions[0]!.createdAt))}. The
              copy is locked while they are reading it.
            </p>
            {canApprove ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={!ready || busy}
                onClick={() => run(() => withdrawApprovalAction({ clientId, itemId }))}
              >
                <Undo2 size={14} aria-hidden="true" />
                Withdraw
              </Button>
            ) : null}
          </>
        ) : canApprove ? (
          <>
            {sendable ? (
              <Textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Anything the client should know about this round."
                aria-label="Note to the client"
              />
            ) : null}
            <Button
              size="sm"
              disabled={!ready || busy || !sendable}
              onClick={() =>
                run(() =>
                  requestApprovalAction({ clientId, itemId, note: note.trim() || null }),
                )
              }
            >
              <Send size={14} aria-hidden="true" />
              {approval ? "Send the next version" : "Send to client"}
            </Button>
            {sendable ? null : (
              <p className="text-2xs text-ink-subtle">
                Content at {stage.toLowerCase().replace(/_/g, " ")} cannot be sent for review. Move
                it to internal review first.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-subtle">
            You do not have permission to send content for client approval.
          </p>
        )}

        {approval && approval.versions.length > 0 ? (
          <ol className="space-y-2.5 border-t border-line pt-3">
            {approval.versions.map((version) => (
              <li key={version.id} className="border-l-2 border-line pl-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs text-navy-800">
                    Version {version.version}
                    <span className="ml-1.5 text-2xs text-ink-subtle">
                      {version.postCount} post{version.postCount === 1 ? "" : "s"}
                    </span>
                  </p>
                  <span className="text-2xs text-ink-subtle">
                    {DATE.format(new Date(version.createdAt))}
                  </span>
                </div>
                <Badge tone={APPROVAL_STATUS_TONE[version.status]} className="mt-1">
                  {APPROVAL_STATUS_LABEL[version.status]}
                </Badge>
                {version.notes ? (
                  <p className="mt-1 whitespace-pre-wrap text-2xs text-ink-muted">
                    {version.notes}
                  </p>
                ) : null}
                {version.feedback ? (
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-warning/30 bg-warning-bg px-2 py-1.5 text-2xs text-warning">
                    {version.feedback}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </CardBody>
    </Card>
  );
}
