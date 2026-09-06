"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Select, Textarea } from "@/components/ui";
import { sendMessageAction, type PortalActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sending…" : "Send"}
    </Button>
  );
}

export function MessageForm({
  projects,
}: {
  projects: readonly { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<PortalActionState, FormData>(sendMessageAction, null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2.5" noValidate>
      <label htmlFor="message-body" className="sr-only">
        Write a message
      </label>
      <Textarea
        id="message-body"
        name="body"
        rows={3}
        placeholder="Ask us anything about the work"
        required
      />

      {projects.length > 0 ? (
        <div className="flex items-center gap-2">
          <label htmlFor="message-project" className="text-2xs uppercase tracking-wide text-ink-subtle">
            About
          </label>
          <Select id="message-project" name="projectId" defaultValue="" className="max-w-xs">
            <option value="">Anything</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {state && !state.ok ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
