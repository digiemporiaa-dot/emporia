"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { decideApprovalAction, type PortalActionState } from "../../actions";

/**
 * The client's decision on the current version.
 *
 * Rejecting outright is deliberately not offered: from this side the useful
 * choices are "this is good" and "here is what to change". Anything harder is a
 * conversation, and there is a messages thread for that.
 */
function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sending…" : "Send decision"}
    </Button>
  );
}

export function DecisionForm({ approvalId }: { approvalId: string }) {
  const [state, formAction] = useActionState<PortalActionState, FormData>(
    decideApprovalAction,
    null,
  );

  // Controlled, so a refusal does not quietly reset the choice.
  const [decision, setDecision] = React.useState("APPROVED");
  const [feedback, setFeedback] = React.useState("");

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="approvalId" value={approvalId} />

      <Field id="decision" label="Your decision" required>
        {(aria) => (
          <Select
            {...aria}
            name="decision"
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
            <option value="APPROVED">Approve this version</option>
            <option value="CHANGES_REQUESTED">Ask for changes</option>
          </Select>
        )}
      </Field>

      <Field
        id="feedback"
        label="Comments"
        hint={
          decision === "CHANGES_REQUESTED"
            ? "Tell us what to change"
            : "Optional — anything you want on the record"
        }
      >
        {(aria) => (
          <Textarea
            {...aria}
            name="feedback"
            rows={4}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        )}
      </Field>

      {state && !state.ok ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
