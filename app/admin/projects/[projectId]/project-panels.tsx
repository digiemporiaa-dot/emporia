"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Link2, Plus, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "@/lib/projects/lifecycle";
import { formatMinutes } from "@/lib/projects/hours";
import {
  addCommentAction,
  addDependencyAction,
  logTimeAction,
  moveTaskAction,
  removeDependencyAction,
  saveMilestoneAction,
  saveTaskAction,
  setProjectStatusAction,
  type DeliveryActionState,
} from "../actions";
import type { MilestoneStatus, Priority, ProjectStatus, TaskStatus } from "@/generated/prisma/enums";

/**
 * Project working panels.
 *
 * Every control here is backed by a server action that re-checks permission and
 * the lifecycle rules; the UI only decides what to offer, never what is allowed
 * (CLAUDE.md 2 rule 2).
 */

type Option = { id: string; name: string };

export type PanelTask = {
  id: string;
  parentId: string | null;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueAt: Date | null;
  estimateHours: string | null;
  assignee: { id: string; name: string } | null;
  milestone: { id: string; title: string } | null;
  dependencies: { dependsOn: { id: string; title: string; status: TaskStatus } }[];
  _count: { subtasks: number; comments: number; timeEntries: number };
};

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

function Submit({ label, size = "sm" }: { label: string; size?: "sm" | "md" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Project status
// ---------------------------------------------------------------------------

export function ProjectStatusControl({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const move = (next: string) => {
    setError(null);
    start(async () => {
      const result = await setProjectStatusAction(projectId, next);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="project-status" className="block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        Status
      </label>
      <Select
        id="project-status"
        value={status}
        disabled={pending}
        onChange={(event) => move(event.target.value)}
      >
        {PROJECT_STATUSES.map((option) => (
          <option key={option} value={option}>
            {PROJECT_STATUS_LABEL[option]}
          </option>
        ))}
      </Select>
      <Problem message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export function MilestoneForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(
    saveMilestoneAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="status" value="PENDING" />
      <input type="hidden" name="order" value="0" />

      <Field id="milestone-title" label="Milestone" required>
        {(aria) => <Input {...aria} name="title" placeholder="What has to be true" required />}
      </Field>
      <Field id="milestone-dueAt" label="Due" required>
        {(aria) => <Input {...aria} name="dueAt" type="date" required />}
      </Field>

      {state && !state.ok ? <Problem message={state.message} /> : null}
      <Submit label="Add milestone" />
    </form>
  );
}

export function MilestoneStatusControl({
  projectId,
  milestone,
}: {
  projectId: string;
  milestone: { id: string; title: string; dueAt: Date; status: MilestoneStatus };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const move = (status: string) => {
    setError(null);
    const form = new FormData();
    form.set("id", milestone.id);
    form.set("projectId", projectId);
    form.set("title", milestone.title);
    form.set("dueAt", milestone.dueAt.toISOString().slice(0, 10));
    form.set("status", status);
    form.set("order", "0");

    start(async () => {
      const result = await saveMilestoneAction(null, form);
      if (result && !result.ok) setError(result.message);
      else router.refresh();
    });
  };

  return (
    <div>
      <label className="sr-only" htmlFor={`milestone-${milestone.id}`}>
        Status of {milestone.title}
      </label>
      <select
        id={`milestone-${milestone.id}`}
        value={milestone.status}
        disabled={pending}
        onChange={(event) => move(event.target.value)}
        className="h-7 rounded-sm border border-line bg-white px-1.5 text-2xs text-ink-muted focus:border-brand-red"
      >
        <option value="PENDING">Pending</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="COMPLETED">Completed</option>
      </select>
      <Problem message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function TaskForm({
  projectId,
  staff,
  milestones,
  parents,
  canAssign,
}: {
  projectId: string;
  staff: readonly Option[];
  milestones: readonly { id: string; title: string }[];
  parents: readonly { id: string; title: string }[];
  canAssign: boolean;
}) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(saveTaskAction, null);
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" className="mr-1" />
        Add task
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-line bg-surface-muted p-3" noValidate>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="status" value="TODO" />

      <Field id="task-title" label="Task" required>
        {(aria) => <Input {...aria} name="title" placeholder="What needs doing" required />}
      </Field>

      <Field id="task-description" label="Detail">
        {(aria) => <Textarea {...aria} name="description" rows={2} />}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {canAssign ? (
          <Field id="task-assigneeId" label="Assignee">
            {(aria) => (
              <Select {...aria} name="assigneeId" defaultValue="">
                <option value="">Unassigned</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <Field id="task-priority" label="Priority">
          {(aria) => (
            <Select {...aria} name="priority" defaultValue="MEDIUM">
              {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="task-dueAt" label="Due">
          {(aria) => <Input {...aria} name="dueAt" type="date" />}
        </Field>

        <Field id="task-estimateHours" label="Estimate" hint="Hours, e.g. 7.5">
          {(aria) => <Input {...aria} name="estimateHours" inputMode="decimal" />}
        </Field>

        {milestones.length > 0 ? (
          <Field id="task-milestoneId" label="Milestone">
            {(aria) => (
              <Select {...aria} name="milestoneId" defaultValue="">
                <option value="">None</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {parents.length > 0 ? (
          <Field id="task-parentId" label="Subtask of">
            {(aria) => (
              <Select {...aria} name="parentId" defaultValue="">
                <option value="">Nothing — a top-level task</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>

      {state && !state.ok ? <Problem message={state.message} /> : null}

      <div className="flex gap-2">
        <Submit label="Add task" />
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function TaskList({
  tasks,
  canEdit,
}: {
  tasks: readonly PanelTask[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [linking, setLinking] = React.useState<string | null>(null);

  const move = (taskId: string, status: string) => {
    setError(null);
    start(async () => {
      const result = await moveTaskAction(taskId, status);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  const link = (taskId: string, dependsOnId: string) => {
    setError(null);
    setLinking(null);
    start(async () => {
      const result = await addDependencyAction(taskId, dependsOnId);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  const unlink = (taskId: string, dependsOnId: string) => {
    setError(null);
    start(async () => {
      const result = await removeDependencyAction(taskId, dependsOnId);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  const top = tasks.filter((task) => !task.parentId);

  if (tasks.length === 0) {
    return <p className="text-xs text-ink-subtle">No tasks yet.</p>;
  }

  return (
    <div aria-busy={pending}>
      <Problem message={error} />

      <ul className="divide-y divide-line">
        {top.map((task) => {
          const subtasks = tasks.filter((child) => child.parentId === task.id);
          const others = tasks.filter(
            (other) =>
              other.id !== task.id &&
              !task.dependencies.some((d) => d.dependsOn.id === other.id),
          );

          return (
            <li key={task.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-navy-800">{task.title}</p>
                  <p className="mt-0.5 text-2xs text-ink-subtle">
                    {[
                      task.assignee?.name ?? "Unassigned",
                      task.dueAt ? `due ${DATE.format(task.dueAt)}` : null,
                      task.estimateHours ? `${task.estimateHours}h estimated` : null,
                      task.milestone?.title,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>

                  {task.dependencies.length > 0 ? (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {task.dependencies.map(({ dependsOn }) => (
                        <li
                          key={dependsOn.id}
                          className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 text-2xs text-ink-muted"
                        >
                          <Link2 size={11} aria-hidden="true" />
                          waits on {dependsOn.title}
                          <span className="text-ink-subtle">
                            ({TASK_STATUS_LABEL[dependsOn.status].toLowerCase()})
                          </span>
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => unlink(task.id, dependsOn.id)}
                              className="ml-0.5 rounded-sm p-0.5 hover:text-brand-red"
                            >
                              <X size={11} aria-hidden="true" />
                              <span className="sr-only">
                                Remove the dependency on {dependsOn.title}
                              </span>
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <label className="sr-only" htmlFor={`task-${task.id}-status`}>
                      Status of {task.title}
                    </label>
                    <select
                      id={`task-${task.id}-status`}
                      value={task.status}
                      onChange={(event) => move(task.id, event.target.value)}
                      className="h-7 rounded-sm border border-line bg-white px-1.5 text-2xs text-ink-muted focus:border-brand-red"
                    >
                      {TASK_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {TASK_STATUS_LABEL[status]}
                        </option>
                      ))}
                    </select>

                    {others.length > 0 ? (
                      linking === task.id ? (
                        <>
                          <label className="sr-only" htmlFor={`task-${task.id}-depends`}>
                            Make {task.title} wait on another task
                          </label>
                          <select
                            id={`task-${task.id}-depends`}
                            defaultValue=""
                            onChange={(event) =>
                              event.target.value ? link(task.id, event.target.value) : null
                            }
                            className="h-7 rounded-sm border border-line bg-white px-1.5 text-2xs text-ink-muted focus:border-brand-red"
                          >
                            <option value="">Waits on…</option>
                            {others.map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.title}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setLinking(task.id)}
                          className="rounded-sm border border-line px-1.5 py-1 text-2xs text-ink-muted hover:border-brand-red hover:text-brand-red"
                        >
                          Add dependency
                        </button>
                      )
                    ) : null}
                  </div>
                ) : (
                  <span className="text-2xs uppercase tracking-wide text-ink-subtle">
                    {TASK_STATUS_LABEL[task.status]}
                  </span>
                )}
              </div>

              {subtasks.length > 0 ? (
                <ul className="mt-2 space-y-1.5 border-l border-line pl-3">
                  {subtasks.map((subtask) => (
                    <li key={subtask.id} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink">{subtask.title}</span>
                      {canEdit ? (
                        <>
                          <label className="sr-only" htmlFor={`task-${subtask.id}-status`}>
                            Status of {subtask.title}
                          </label>
                          <select
                            id={`task-${subtask.id}-status`}
                            value={subtask.status}
                            onChange={(event) => move(subtask.id, event.target.value)}
                            className="h-7 rounded-sm border border-line bg-white px-1.5 text-2xs text-ink-muted focus:border-brand-red"
                          >
                            {TASK_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {TASK_STATUS_LABEL[status]}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <span className="text-2xs text-ink-subtle">
                          {TASK_STATUS_LABEL[subtask.status]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function TimePanel({
  projectId,
  tasks,
  totalMinutes,
  byUser,
  recent,
  canLog,
}: {
  projectId: string;
  tasks: readonly { id: string; title: string }[];
  totalMinutes: number;
  byUser: readonly { userId: string; name: string; minutes: number }[];
  recent: readonly {
    id: string;
    minutes: number;
    note: string | null;
    startedAt: Date;
    user: { id: string; name: string };
    task: { id: string; title: string } | null;
  }[];
  canLog: boolean;
}) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(logTimeAction, null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <p className="font-display text-2xl text-navy-800">{formatMinutes(totalMinutes)}</p>

      {byUser.length > 0 ? (
        <ul className="space-y-1.5">
          {byUser.map((row) => (
            <li key={row.userId} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-ink-muted">{row.name}</span>
              <span className="tabular-nums text-navy-800">{formatMinutes(row.minutes)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {canLog ? (
        <form action={formAction} className="space-y-3 border-t border-line pt-3" noValidate>
          <input type="hidden" name="projectId" value={projectId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="time-hours" label="Hours" required hint="e.g. 1.5">
              {(aria) => <Input {...aria} name="hours" inputMode="decimal" required />}
            </Field>
            <Field id="time-startedAt" label="Date" required>
              {(aria) => (
                <Input {...aria} name="startedAt" type="date" defaultValue={today} required />
              )}
            </Field>
          </div>

          {tasks.length > 0 ? (
            <Field id="time-taskId" label="Against">
              {(aria) => (
                <Select {...aria} name="taskId" defaultValue="">
                  <option value="">The project as a whole</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field id="time-note" label="Note">
            {(aria) => <Input {...aria} name="note" />}
          </Field>

          {state && !state.ok ? <Problem message={state.message} /> : null}
          {state?.ok ? (
            <p role="status" className="text-xs text-success">
              Logged.
            </p>
          ) : null}

          <Submit label="Log time" />
        </form>
      ) : null}

      {recent.length > 0 ? (
        <ul className="space-y-2 border-t border-line pt-3">
          {recent.map((entry) => (
            <li key={entry.id} className="text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-muted">{entry.user.name}</span>
                <span className="tabular-nums text-navy-800">{formatMinutes(entry.minutes)}</span>
              </div>
              <p className="text-2xs text-ink-subtle">
                {DATE.format(entry.startedAt)}
                {entry.task ? ` · ${entry.task.title}` : ""}
                {entry.note ? ` · ${entry.note}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function CommentPanel({
  projectId,
  comments,
}: {
  projectId: string;
  comments: readonly {
    id: string;
    body: string;
    createdAt: Date;
    author: { id: string; name: string };
    task: { id: string; title: string } | null;
  }[];
}) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(addCommentAction, null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="space-y-2" noValidate>
        <input type="hidden" name="projectId" value={projectId} />
        <label htmlFor="comment-body" className="sr-only">
          Add a comment
        </label>
        <Textarea id="comment-body" name="body" rows={3} placeholder="Add a note for the team" />
        {state && !state.ok ? <Problem message={state.message} /> : null}
        <Submit label="Comment" />
      </form>

      {comments.length === 0 ? (
        <p className="text-xs text-ink-subtle">Nothing discussed here yet.</p>
      ) : (
        <ul className="space-y-3 border-t border-line pt-3">
          {comments.map((comment) => (
            <li key={comment.id}>
              <p className="text-xs text-navy-800">
                {comment.author.name}
                <span className="ml-2 text-2xs text-ink-subtle">
                  {DATE.format(comment.createdAt)}
                  {comment.task ? ` · ${comment.task.title}` : ""}
                </span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
