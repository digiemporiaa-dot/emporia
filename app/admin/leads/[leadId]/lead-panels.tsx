"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  addNoteAction,
  addTaskAction,
  assignAction,
  changeStatusAction,
  completeTaskAction,
  rescoreAction,
  type CrmActionState,
} from "../actions";
import { PIPELINE_STAGES, STAGE_LABEL } from "@/lib/crm/pipeline";
import type { LeadStatus, Priority, TaskStatus } from "@/generated/prisma/enums";

type Person = { id: string; name: string };

function Submit({ label, size = "sm" }: { label: string; size?: "sm" | "md" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

function Feedback({ state }: { state: CrmActionState }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p role="status" className="text-xs text-success">
        Saved.
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

export function StatusPanel({
  leadId,
  status,
  canEdit,
}: {
  leadId: string;
  status: LeadStatus;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<CrmActionState, FormData>(changeStatusAction, null);

  if (!canEdit) {
    return <p className="text-xs text-ink-subtle">You cannot change this lead&rsquo;s stage.</p>;
  }

  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="block">
        <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
          Stage
        </span>
        <Select name="status" defaultValue={status}>
          {PIPELINE_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABEL[stage]}
            </option>
          ))}
        </Select>
      </label>
      <Input name="note" placeholder="Why? (optional)" aria-label="Reason for the change" />
      <Submit label="Update stage" />
      <Feedback state={state} />
    </form>
  );
}

export function AssignPanel({
  leadId,
  currentId,
  staff,
  canAssign,
}: {
  leadId: string;
  currentId: string | null;
  staff: readonly Person[];
  canAssign: boolean;
}) {
  const [state, formAction] = useActionState<CrmActionState, FormData>(assignAction, null);

  if (!canAssign) {
    return <p className="text-xs text-ink-subtle">You do not have permission to reassign leads.</p>;
  }

  return (
    <form action={formAction} className="space-y-2.5">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="block">
        <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
          Owner
        </span>
        <Select name="toUserId" defaultValue={currentId ?? ""}>
          <option value="">Unassigned</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </label>
      <Input name="reason" placeholder="Reason (optional)" aria-label="Reason for reassignment" />
      <Submit label="Reassign" />
      <Feedback state={state} />
    </form>
  );
}

export function NotesPanel({
  leadId,
  notes,
  canEdit,
}: {
  leadId: string;
  notes: readonly { id: string; body: string; createdAt: Date; author: { name: string } }[];
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<CrmActionState, FormData>(addNoteAction, null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-xs text-ink-subtle">No notes yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-line bg-surface-muted p-2.5">
              <p className="whitespace-pre-wrap text-sm text-ink">{note.body}</p>
              <p className="mt-1.5 text-2xs text-ink-subtle">
                {note.author.name} · {note.createdAt.toISOString().slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form ref={formRef} action={formAction} className="space-y-2 border-t border-line pt-3">
          <input type="hidden" name="leadId" value={leadId} />
          <label htmlFor="note-body" className="sr-only">
            Add a note
          </label>
          <Textarea id="note-body" name="body" rows={3} placeholder="Add a note…" required />
          <Submit label="Add note" />
          <Feedback state={state} />
        </form>
      ) : null}
    </div>
  );
}

export function TasksPanel({
  leadId,
  tasks,
  staff,
  canEdit,
}: {
  leadId: string;
  tasks: readonly {
    id: string;
    title: string;
    detail: string | null;
    dueAt: Date;
    status: TaskStatus;
    priority: Priority;
    assignee: { name: string };
  }[];
  staff: readonly Person[];
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<CrmActionState, FormData>(addTaskAction, null);
  const [pending, start] = useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const now = Date.now();

  return (
    <div className="space-y-3">
      {tasks.length === 0 ? (
        <p className="text-xs text-ink-subtle">No follow-ups scheduled.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const overdue = task.status !== "DONE" && task.dueAt.getTime() < now;
            return (
              <li
                key={task.id}
                className="flex items-start gap-2.5 rounded-md border border-line bg-surface-muted p-2.5"
              >
                {canEdit && task.status !== "DONE" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => start(async () => void (await completeTaskAction(task.id, leadId)))}
                    className="mt-0.5 rounded-sm border border-line-strong p-0.5 text-ink-subtle hover:border-success hover:text-success"
                  >
                    <Check size={12} aria-hidden="true" />
                    <span className="sr-only">Mark &ldquo;{task.title}&rdquo; complete</span>
                  </button>
                ) : (
                  <span className="mt-0.5 text-success">
                    {task.status === "DONE" ? <Check size={13} aria-hidden="true" /> : null}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${task.status === "DONE" ? "text-ink-subtle line-through" : "text-navy-800"}`}
                  >
                    {task.title}
                  </p>
                  {task.detail ? <p className="text-xs text-ink-muted">{task.detail}</p> : null}
                  <p className="mt-0.5 text-2xs text-ink-subtle">
                    {task.assignee.name} · due {task.dueAt.toISOString().slice(0, 10)}
                    {overdue ? <span className="ml-1.5 text-brand-red">overdue</span> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <form ref={formRef} action={formAction} className="space-y-2 border-t border-line pt-3">
          <input type="hidden" name="leadId" value={leadId} />
          <Field id="task-title" label="Follow-up">
            {(aria) => <Input {...aria} name="title" required placeholder="Call to confirm budget" />}
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field id="task-dueAt" label="Due">
              {(aria) => <Input {...aria} name="dueAt" type="date" required />}
            </Field>
            <Field id="task-assigneeId" label="Owner">
              {(aria) => (
                <Select {...aria} name="assigneeId" required>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Submit label="Schedule follow-up" />
          <Feedback state={state} />
        </form>
      ) : null}
    </div>
  );
}

export function RescoreButton({ leadId }: { leadId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await rescoreAction(leadId)))}
      className="text-2xs text-ink-subtle underline underline-offset-2 hover:text-brand-red-text disabled:opacity-60"
    >
      {pending ? "Recalculating…" : "Recalculate"}
    </button>
  );
}
