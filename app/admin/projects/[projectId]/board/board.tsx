"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { TASK_BOARD_STATUSES, TASK_STATUS_LABEL } from "@/lib/projects/lifecycle";
import { moveTaskAction } from "../../actions";
import type { Priority, TaskStatus } from "@/generated/prisma/enums";

/**
 * Task board.
 *
 * Drag-and-drop uses native HTML drag events, and every card also carries a
 * status select so the board is usable from the keyboard — a board that only
 * answers to a mouse is not usable (CLAUDE.md 12).
 *
 * A move is optimistic in the UI and authoritative on the server: a task that
 * waits on unfinished work is refused there, and the card comes back with the
 * reason.
 */

export type BoardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  assignee: { id: string; name: string } | null;
  waitingOn: string[];
};

export function TaskBoard({ tasks, canMove }: { tasks: BoardTask[]; canMove: boolean }) {
  const router = useRouter();
  const [items, setItems] = React.useState(tasks);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => setItems(tasks), [tasks]);

  const move = (taskId: string, status: TaskStatus) => {
    const previous = items;
    const task = items.find((t) => t.id === taskId);
    if (!task || task.status === status) return;

    setError(null);
    setItems((current) => current.map((t) => (t.id === taskId ? { ...t, status } : t)));

    startTransition(async () => {
      const result = await moveTaskAction(taskId, status);
      if (!result.ok) {
        // The server is the authority; put the card back and say why.
        setItems(previous);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {error ? (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-brand-red"
        >
          <AlertCircle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="relative flex gap-3 overflow-x-auto pb-3" aria-busy={pending}>
        {TASK_BOARD_STATUSES.map((status) => {
          const column = items.filter((task) => task.status === status);

          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABEL[status]}
              onDragOver={(event) => {
                if (!canMove) return;
                event.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((current) => (current === status ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                if (canMove && dragging) move(dragging, status);
                setDragging(null);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-lg border bg-surface-muted ${
                over === status ? "border-brand-red" : "border-line"
              }`}
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2.5">
                <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                  {TASK_STATUS_LABEL[status]}
                </h2>
                <span className="text-xs tabular-nums text-ink-subtle">{column.length}</span>
              </header>

              <ul className="flex-1 space-y-2 p-2">
                {column.length === 0 ? (
                  <li className="px-1 py-6 text-center text-xs text-ink-subtle">Nothing here</li>
                ) : (
                  column.map((task) => (
                    <li
                      key={task.id}
                      draggable={canMove}
                      onDragStart={() => setDragging(task.id)}
                      onDragEnd={() => setDragging(null)}
                      className={`rounded-md border border-line bg-white p-2.5 shadow-xs ${
                        canMove ? "cursor-grab active:cursor-grabbing" : ""
                      } ${dragging === task.id ? "opacity-50" : ""}`}
                    >
                      <p className="text-sm text-navy-800">{task.title}</p>

                      <p className="mt-1 text-2xs text-ink-subtle">
                        {[task.assignee?.name ?? "Unassigned", task.dueAt ? `due ${task.dueAt}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>

                      {task.waitingOn.length > 0 ? (
                        <p className="mt-1 text-2xs text-warning">
                          waits on {task.waitingOn.join(", ")}
                        </p>
                      ) : null}

                      {task.priority === "HIGH" || task.priority === "URGENT" ? (
                        <p className="mt-1 text-2xs font-semibold uppercase tracking-wide text-brand-red">
                          {task.priority.toLowerCase()}
                        </p>
                      ) : null}

                      {canMove ? (
                        <label className="mt-2 block">
                          <span className="sr-only">Move {task.title} to another column</span>
                          <select
                            value={task.status}
                            onChange={(event) => move(task.id, event.target.value as TaskStatus)}
                            className="h-7 w-full rounded-sm border border-line bg-white px-1.5 text-2xs text-ink-muted focus:border-brand-red"
                          >
                            {TASK_BOARD_STATUSES.map((option) => (
                              <option key={option} value={option}>
                                Move to {TASK_STATUS_LABEL[option]}
                              </option>
                            ))}
                            <option value="CANCELLED">Cancel task</option>
                          </select>
                        </label>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
