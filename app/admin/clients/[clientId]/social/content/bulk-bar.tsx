"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, X } from "lucide-react";
import { Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import type { BulkResult } from "@/lib/services/social-bulk.service";
import { bulkAction } from "./actions";

/**
 * What can be done to many ideas at once (brief §39).
 *
 * Every action opens a confirmation that says how many ideas it touches and
 * what will happen, then reports item by item: what worked, and for what did
 * not, why. Nothing here publishes — scheduling hands versions to the
 * scheduler, which still checks each one at its time.
 */

type Kind = "approve" | "requestClientReview" | "schedule" | "reschedule" | "assign" | "deleteDrafts";

const TITLE: Record<Kind, string> = {
  approve: "Approve internally",
  requestClientReview: "Send to the client",
  schedule: "Schedule",
  reschedule: "Reschedule",
  assign: "Assign",
  deleteDrafts: "Delete drafts",
};

const EXPLAIN: Record<Kind, string> = {
  approve: "Approves the internal review round waiting on each idea. Ideas with nothing waiting are skipped.",
  requestClientReview:
    "Sends each idea to the client for approval. Only ideas approved internally, exactly as they stand now, can go.",
  schedule:
    "Schedules every draft version of each idea at its own time. Only client-approved ideas can be scheduled; versions whose time has passed are skipped.",
  reschedule:
    "Moves every unpublished version with a time. Approvals are kept — a new time is not new content — and each move is recorded.",
  assign: "Sets who owns each idea.",
  deleteDrafts:
    "Permanently deletes ideas that are still ideas or drafts and have never been sent to the client or to a platform. Anything else is left alone.",
};

export function BulkBar({
  clientId,
  selected,
  staff,
  permissions,
  onClear,
}: {
  clientId: string;
  selected: string[];
  staff: readonly { id: string; name: string }[];
  permissions: { review: boolean; send: boolean; edit: boolean; delete: boolean };
  onClear: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<Kind | null>(null);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<BulkResult[] | null>(null);
  const [text, setText] = React.useState("");
  const [mode, setMode] = React.useState<"shift" | "to">("shift");
  const [shiftDays, setShiftDays] = React.useState("1");
  const [toDay, setToDay] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState("");

  const count = selected.length;
  const close = () => {
    // Once something has run, the selection has done its job.
    if (results) onClear();
    setOpen(null);
    setResults(null);
    setError(null);
    setText("");
    setConfirmDelete("");
  };

  const actions: { kind: Kind; allowed: boolean; tone?: "danger" }[] = [
    { kind: "approve", allowed: permissions.review },
    { kind: "requestClientReview", allowed: permissions.send },
    { kind: "schedule", allowed: permissions.edit },
    { kind: "reschedule", allowed: permissions.edit },
    { kind: "assign", allowed: permissions.edit },
    { kind: "deleteDrafts", allowed: permissions.delete, tone: "danger" },
  ];

  const payload = (kind: Kind) => {
    switch (kind) {
      case "approve":
        return { kind, feedback: text.trim() || null };
      case "requestClientReview":
        return { kind, note: text.trim() || null };
      case "reschedule":
        return mode === "shift" ? { kind, shiftDays } : { kind: "rescheduleTo", toDay };
      case "assign":
        return { kind, ownerId: ownerId || null };
      default:
        return { kind };
    }
  };

  const run = (kind: Kind) => {
    setError(null);
    start(async () => {
      const response = await bulkAction({ clientId, itemIds: selected, action: payload(kind) });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setResults(response.data.results);
      router.refresh();
    });
  };

  const ready =
    open === "reschedule"
      ? mode === "shift"
        ? Number(shiftDays) !== 0 && Number.isInteger(Number(shiftDays))
        : /^\d{4}-\d{2}-\d{2}$/.test(toDay)
      : open === "deleteDrafts"
        ? confirmDelete.trim().toLowerCase() === "delete"
        : true;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-navy-100 bg-white px-3 py-2 shadow-sm"
    >
      <span className="mr-1 text-sm font-medium text-navy-800">{count} selected</span>
      {actions
        .filter((action) => action.allowed)
        .map((action) => (
          <Button
            key={action.kind}
            size="sm"
            variant={action.tone === "danger" ? "ghost" : "secondary"}
            className={action.tone === "danger" ? "text-brand-red-text" : undefined}
            onClick={() => setOpen(action.kind)}
          >
            {TITLE[action.kind]}
          </Button>
        ))}
      <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
        <X size={14} aria-hidden="true" />
        Clear
      </Button>

      {open ? (
        <Dialog open onClose={close} title={`${TITLE[open]} — ${count} idea${count === 1 ? "" : "s"}`} description={EXPLAIN[open]}>
          <div className="space-y-4">
            {error ? (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text">
                <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            ) : null}

            {results ? (
              <>
                <p className="text-sm text-navy-800">
                  {results.filter((r) => r.ok).length} done, {results.filter((r) => !r.ok).length} not.
                </p>
                <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
                  {results.map((result) => (
                    <li key={result.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                      {result.ok ? (
                        <Check size={14} aria-label="Done" className="mt-0.5 shrink-0 text-success" />
                      ) : (
                        <X size={14} aria-label="Not done" className="mt-0.5 shrink-0 text-brand-red-text" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-medium text-navy-800">{result.label}</span>
                        {result.message ? <span className="block text-ink-muted">{result.message}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button onClick={close}>Close</Button>
              </>
            ) : (
              <>
                {open === "approve" || open === "requestClientReview" ? (
                  <Field id="bulk-text" label={open === "approve" ? "Feedback" : "Note to the client"}>
                    {(aria) => <Textarea {...aria} rows={2} value={text} placeholder="Optional" onChange={(e) => setText(e.target.value)} />}
                  </Field>
                ) : null}

                {open === "reschedule" ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-navy-800">Move</legend>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" className="accent-brand-red" checked={mode === "shift"} onChange={() => setMode("shift")} />
                      by
                      <Input
                        type="number"
                        min={-90}
                        max={90}
                        className="h-8 w-20"
                        aria-label="Days to move by"
                        value={shiftDays}
                        onChange={(e) => {
                          setMode("shift");
                          setShiftDays(e.target.value);
                        }}
                      />
                      days (negative moves earlier)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" className="accent-brand-red" checked={mode === "to"} onChange={() => setMode("to")} />
                      to
                      <Input
                        type="date"
                        className="h-8 w-44"
                        aria-label="Day to move to"
                        value={toDay}
                        onChange={(e) => {
                          setMode("to");
                          setToDay(e.target.value);
                        }}
                      />
                      keeping each version&rsquo;s time of day
                    </label>
                  </fieldset>
                ) : null}

                {open === "assign" ? (
                  <Field id="bulk-owner" label="Owner">
                    {(aria) => (
                      <Select {...aria} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
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

                {open === "deleteDrafts" ? (
                  <Field id="bulk-confirm" label='Type "delete" to confirm'>
                    {(aria) => <Input {...aria} value={confirmDelete} autoComplete="off" onChange={(e) => setConfirmDelete(e.target.value)} />}
                  </Field>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={close}>
                    Cancel
                  </Button>
                  <Button disabled={pending || !ready} onClick={() => run(open)}>
                    {pending ? "Working…" : `${TITLE[open]} ${count}`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
