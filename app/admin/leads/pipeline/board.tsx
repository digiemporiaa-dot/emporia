"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { BOARD_STAGES, STAGE_LABEL } from "@/lib/crm/pipeline";
import { bandOf } from "@/lib/crm/scoring";
import { moveLeadAction } from "../actions";
import type { LeadStatus, Priority } from "@/generated/prisma/enums";

/**
 * Pipeline board.
 *
 * Drag-and-drop uses the native HTML drag events rather than a library, and
 * every card is also movable from the keyboard through a per-card stage select
 * — a board that only responds to a mouse is not usable (CLAUDE.md 12).
 *
 * A move is optimistic in the UI and authoritative on the server: if the server
 * refuses the transition, the card returns and the reason is shown.
 */

export type BoardLead = {
  id: string;
  name: string;
  company: string | null;
  status: LeadStatus;
  priority: Priority;
  score: number;
  assignedTo: { id: string; name: string } | null;
  service: { name: string } | null;
  city: { name: string } | null;
};

export function PipelineBoard({ leads, canMove }: { leads: BoardLead[]; canMove: boolean }) {
  const router = useRouter();
  const [items, setItems] = React.useState(leads);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<LeadStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => setItems(leads), [leads]);

  const move = (leadId: string, status: LeadStatus) => {
    const previous = items;
    const lead = items.find((l) => l.id === leadId);
    if (!lead || lead.status === status) return;

    setError(null);
    setItems((current) => current.map((l) => (l.id === leadId ? { ...l, status } : l)));

    startTransition(async () => {
      const result = await moveLeadAction(leadId, status);
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

      <div className="flex gap-3 overflow-x-auto pb-3" aria-busy={pending}>
        {BOARD_STAGES.map((stage) => {
          const staged = items.filter((lead) => lead.status === stage);

          return (
            <section
              key={stage}
              aria-label={STAGE_LABEL[stage]}
              onDragOver={(e) => {
                if (!canMove) return;
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (canMove && dragging) move(dragging, stage);
                setDragging(null);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-lg border bg-surface-muted ${
                over === stage ? "border-brand-red" : "border-line"
              }`}
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2.5">
                <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                  {STAGE_LABEL[stage]}
                </h2>
                <span className="text-xs tabular-nums text-ink-subtle">{staged.length}</span>
              </header>

              <ul className="flex-1 space-y-2 p-2">
                {staged.length === 0 ? (
                  <li className="px-1 py-6 text-center text-xs text-ink-subtle">Nothing here</li>
                ) : (
                  staged.map((lead) => {
                    const band = bandOf(lead.score);
                    return (
                      <li
                        key={lead.id}
                        draggable={canMove}
                        onDragStart={() => setDragging(lead.id)}
                        onDragEnd={() => setDragging(null)}
                        className={`rounded-md border border-line bg-white p-2.5 shadow-xs ${
                          canMove ? "cursor-grab active:cursor-grabbing" : ""
                        } ${dragging === lead.id ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={{ pathname: "/admin/leads/[leadId]", query: { leadId: lead.id } }}
                            className="text-sm font-medium text-navy-800 hover:text-brand-red"
                          >
                            {lead.name}
                          </Link>
                          <span
                            className={`shrink-0 font-display text-xs tabular-nums ${
                              band === "HOT"
                                ? "text-brand-red"
                                : band === "WARM"
                                  ? "text-warning"
                                  : "text-ink-subtle"
                            }`}
                          >
                            {lead.score}
                          </span>
                        </div>

                        {lead.company ? (
                          <p className="mt-0.5 text-xs text-ink-subtle">{lead.company}</p>
                        ) : null}

                        <p className="mt-1.5 text-2xs text-ink-subtle">
                          {[lead.service?.name, lead.city?.name].filter(Boolean).join(" · ") || "—"}
                        </p>

                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
                          <span className="truncate text-2xs text-ink-muted">
                            {lead.assignedTo?.name ?? "Unassigned"}
                          </span>
                          {lead.priority === "HIGH" || lead.priority === "URGENT" ? (
                            <span className="text-2xs font-semibold uppercase tracking-wide text-brand-red">
                              {lead.priority.toLowerCase()}
                            </span>
                          ) : null}
                        </div>

                        {canMove ? (
                          <label className="mt-2 block">
                            <span className="sr-only">Move {lead.name} to another stage</span>
                            <select
                              value={lead.status}
                              onChange={(e) => move(lead.id, e.target.value as LeadStatus)}
                              className="h-7 w-full rounded-sm border border-line bg-white px-1.5 text-2xs text-ink-muted focus:border-brand-red"
                            >
                              {BOARD_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  Move to {STAGE_LABEL[s]}
                                </option>
                              ))}
                              <option value="WON">Mark won</option>
                              <option value="LOST">Mark lost</option>
                              <option value="NURTURE">Move to nurture</option>
                            </select>
                          </label>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
