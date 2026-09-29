"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import {
  ArchiveOccasionButton,
  CATEGORY_LABEL,
  OccasionDates,
  OccasionDialog,
  whenText,
  type OccasionView,
} from "@/components/admin/occasion-editor";

/**
 * The agency's occasion library. Moving occasions without a date for this
 * year are listed first, because they are the ones that need a person.
 */
export function OccasionLibrary({
  occasions,
  canManage,
  year,
}: {
  occasions: readonly OccasionView[];
  canManage: boolean;
  year: number;
}) {
  const [editing, setEditing] = React.useState<OccasionView | "new" | null>(null);

  const active = occasions.filter((o) => !o.archived);
  const needsDate = active.filter((o) => o.fixedMonth === null && !o.dates.some((d) => Number(d.day.slice(0, 4)) === year));
  const archived = occasions.filter((o) => o.archived);

  const row = (occasion: OccasionView) => (
    <li key={occasion.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-navy-800">{occasion.name}</span>
          <Badge tone="neutral">{CATEGORY_LABEL[occasion.category] ?? occasion.category}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-ink-subtle">{whenText(occasion, year)}</p>
        {occasion.fixedMonth === null ? (
          <div className="mt-2">
            <OccasionDates occasion={occasion} canEdit={canManage && !occasion.archived} />
          </div>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex items-center gap-1">
          {!occasion.archived ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(occasion)}>
              Edit
            </Button>
          ) : null}
          <ArchiveOccasionButton occasion={occasion} />
        </div>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl text-navy-800">Occasion library</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Festivals, national days and events clients can plan around. A client sees only the ones it has opted
            in to. Moving festivals need their date entered each year — it is never guessed.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} aria-hidden="true" />
            New occasion
          </Button>
        ) : null}
      </div>

      {needsDate.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>Needs a date for {year}</CardTitle>
              <p className="text-xs text-ink-subtle">
                These fall on a different day each year. Until a date is added they do not appear on any calendar in{" "}
                {year}.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">{needsDate.map(row)}</ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All occasions</CardTitle>
        </CardHeader>
        <CardBody>
          {active.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-subtle">
              The library is empty.
            </p>
          ) : (
            <ul className="divide-y divide-line">{active.filter((o) => !needsDate.includes(o)).map(row)}</ul>
          )}
          {archived.length > 0 ? (
            <details className="mt-4 rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer text-xs text-ink-subtle">{archived.length} archived</summary>
              <ul className="mt-2 divide-y divide-line">{archived.map(row)}</ul>
            </details>
          ) : null}
        </CardBody>
      </Card>

      {editing ? (
        <OccasionDialog occasion={editing === "new" ? null : editing} clientId={null} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
