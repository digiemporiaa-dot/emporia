"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import {
  addApprovalVersionAction,
  decideApprovalAction,
  type DeliveryActionState,
} from "../projects/actions";

/** Approval controls: a decision on the current version, or a new version. */

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function DecisionForm({ approvalId }: { approvalId: string }) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(
    decideApprovalAction,
    null,
  );

  // Controlled, so a refusal ("say what needs to change") does not silently
  // reset the decision the reviewer picked and approve on the next submit.
  const [decision, setDecision] = React.useState("APPROVED");
  const [feedback, setFeedback] = React.useState("");

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="approvalId" value={approvalId} />

      <Field id="decision" label="Decision" required>
        {(aria) => (
          <Select
            {...aria}
            name="decision"
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
            <option value="APPROVED">Approve</option>
            <option value="CHANGES_REQUESTED">Request changes</option>
            <option value="REJECTED">Reject</option>
          </Select>
        )}
      </Field>

      <Field
        id="feedback"
        label="Feedback"
        hint={
          decision === "CHANGES_REQUESTED"
            ? "Say what needs to change"
            : "Optional note for the record"
        }
      >
        {(aria) => (
          <Textarea
            {...aria}
            name="feedback"
            rows={3}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        )}
      </Field>

      {state && !state.ok ? <Problem message={state.message} /> : null}
      <Submit label="Record decision" />
    </form>
  );
}

export function NewVersionForm({ approvalId }: { approvalId: string }) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(
    addApprovalVersionAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="approvalId" value={approvalId} />

      <Field id="version-notes" label="What changed">
        {(aria) => <Textarea {...aria} name="notes" rows={3} />}
      </Field>

      {state && !state.ok ? <Problem message={state.message} /> : null}
      <Submit label="Submit a new version" />
    </form>
  );
}
