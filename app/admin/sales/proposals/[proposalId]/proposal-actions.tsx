"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import {
  acceptProposalAction,
  createContractFromProposalAction,
  reviseProposalAction,
  sendProposalAction,
  setProposalStatusAction,
  type SalesActionState,
} from "../../actions";
import type { ProposalStatus } from "@/generated/prisma/enums";

/**
 * Lifecycle controls.
 *
 * Accepting is deliberately a separate, confirmed action rather than another
 * option in a status dropdown: it creates a Client and wins the lead, and a
 * consequence like that should not be one mis-click away.
 */

function Result({ state }: { state: SalesActionState }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p role="status" className="flex items-start gap-1.5 text-xs text-success">
        <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
        Done.
      </p>
    );
  }
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {state.message}
    </p>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function ProposalLifecycle({
  proposalId,
  status,
  canSend,
  canEdit,
  canAccept,
  suggestedClientName,
}: {
  proposalId: string;
  status: ProposalStatus;
  canSend: boolean;
  canEdit: boolean;
  canAccept: boolean;
  suggestedClientName: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [acceptState, acceptAction] = useActionState<SalesActionState, FormData>(
    acceptProposalAction,
    null,
  );

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.message ?? "That did not work.");
    });

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {status === "DRAFT" && canSend ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => sendProposalAction(proposalId))}>
          {pending ? "Sending…" : "Send to client"}
        </Button>
      ) : null}

      {(status === "SENT" || status === "VIEWED" || status === "NEGOTIATION") && canEdit ? (
        <div className="flex flex-wrap gap-2">
          {status === "SENT" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => setProposalStatusAction(proposalId, "VIEWED"))}
            >
              Mark viewed
            </Button>
          ) : null}
          {status !== "NEGOTIATION" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => setProposalStatusAction(proposalId, "NEGOTIATION"))}
            >
              Move to negotiation
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => reviseProposalAction(proposalId))}
          >
            Revise
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => run(() => setProposalStatusAction(proposalId, "REJECTED"))}
          >
            Mark rejected
          </Button>
        </div>
      ) : null}

      {(status === "SENT" || status === "VIEWED" || status === "NEGOTIATION") && canAccept ? (
        <div className="rounded-md border border-success/30 bg-success-bg p-3">
          {confirming ? (
            <form action={acceptAction} className="space-y-2">
              <input type="hidden" name="proposalId" value={proposalId} />
              <p className="text-xs text-ink-muted">
                Accepting creates a client and marks the lead won. This cannot be undone.
              </p>
              <label className="block">
                <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                  Client name
                </span>
                <Input name="clientName" defaultValue={suggestedClientName} />
              </label>
              <div className="flex gap-2">
                <Submit label="Accept and create client" />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
              <Result state={acceptState} />
            </form>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}>
              Accept proposal
            </Button>
          )}
        </div>
      ) : null}

      {status === "ACCEPTED" ? (
        <ContractButton proposalId={proposalId} />
      ) : null}
    </div>
  );
}

function ContractButton({ proposalId }: { proposalId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [startsAt, setStartsAt] = React.useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
          Contract start date
        </span>
        <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </label>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await createContractFromProposalAction(proposalId, startsAt);
            setMessage(result.ok ? "Contract drafted." : result.message);
          })
        }
      >
        {pending ? "Drafting…" : "Draft contract"}
      </Button>
      {message ? <p className="text-xs text-ink-muted">{message}</p> : null}
    </div>
  );
}
