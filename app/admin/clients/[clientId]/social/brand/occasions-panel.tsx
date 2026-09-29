"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, useToast } from "@/components/ui";
import {
  ArchiveOccasionButton,
  CATEGORY_LABEL,
  OccasionDates,
  OccasionDialog,
  whenText,
  type OccasionView,
} from "@/components/admin/occasion-editor";
import { setClientOccasionAction } from "./actions";

/**
 * Which occasions this client marks. Library ones are opted in to one by
 * one — nothing is on by default — and the client's own (a brand
 * anniversary) are always on. Marking an occasion only puts it on the
 * calendar and in the planner; it never creates or publishes a post.
 */
export function OccasionsPanel({
  clientId,
  library,
  own,
  canEdit,
  year,
}: {
  clientId: string;
  library: readonly (OccasionView & { optedIn: boolean })[];
  own: readonly OccasionView[];
  canEdit: boolean;
  year: number;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [, start] = React.useTransition();
  const [editing, setEditing] = React.useState<OccasionView | "new" | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  // Ticked at once, and put back if the save fails — a checkbox that waits
  // for the server looks like it ignored the click.
  const [on, setOn] = React.useState(() => new Set(library.filter((o) => o.optedIn).map((o) => o.id)));
  const set = (id: string, value: boolean) =>
    setOn((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = (occasion: OccasionView) => {
    const optedIn = !on.has(occasion.id);
    set(occasion.id, optedIn);
    start(async () => {
      const result = await setClientOccasionAction({ clientId, occasionId: occasion.id, optedIn });
      if (!result.ok) {
        set(occasion.id, !optedIn);
        push({ tone: "error", title: "That did not save.", description: result.message });
        return;
      }
      router.refresh();
    });
  };

  const chosen = library.filter((o) => on.has(o.id));
  const visible = showAll ? library : chosen;

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>Occasions</CardTitle>
          <p className="text-xs text-ink-subtle">
            Festivals and events this client marks. They appear on the calendar and in the monthly planner — nothing is
            ever posted for them automatically.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-navy-800">From the library · {chosen.length} chosen</p>
            <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show chosen only" : `Choose from ${library.length}`}
            </Button>
          </div>
          {visible.length === 0 ? (
            <p className="text-xs text-ink-subtle">None chosen yet.</p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {visible.map((occasion) => (
                <li key={occasion.id}>
                  <label className="flex items-start gap-2 rounded-md border border-line px-2.5 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-brand-red"
                      checked={on.has(occasion.id)}
                      disabled={!canEdit}
                      onChange={() => toggle(occasion)}
                    />
                    <span className="min-w-0">
                      <span className="block text-navy-800">{occasion.name}</span>
                      <span className="block text-2xs text-ink-subtle">{whenText(occasion, year)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-navy-800">This client&apos;s own</p>
          {own.length === 0 ? <p className="text-xs text-ink-subtle">None — a brand anniversary, a store opening…</p> : null}
          <ul className="divide-y divide-line">
            {own.map((occasion) => (
              <li key={occasion.id} className="flex flex-wrap items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-navy-800">
                    {occasion.name} <Badge tone="neutral">{CATEGORY_LABEL[occasion.category] ?? occasion.category}</Badge>
                  </p>
                  <p className="text-2xs text-ink-subtle">{whenText(occasion, year)}</p>
                  {occasion.fixedMonth === null ? (
                    <div className="mt-1.5">
                      <OccasionDates occasion={occasion} canEdit={canEdit} />
                    </div>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(occasion)}>
                      Edit
                    </Button>
                    <ArchiveOccasionButton occasion={occasion} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setEditing("new")}>
              <Plus size={14} aria-hidden="true" />
              Add an occasion
            </Button>
          ) : null}
        </div>
      </CardBody>
      {editing ? (
        <OccasionDialog
          occasion={editing === "new" ? null : editing}
          clientId={clientId}
          defaultCategory="BRAND"
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}
