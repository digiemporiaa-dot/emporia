"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, X } from "lucide-react";
import { Badge, Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import {
  addOccasionDateAction,
  archiveOccasionAction,
  removeOccasionDateAction,
  saveOccasionAction,
} from "@/app/admin/social/occasions/actions";

/**
 * Editing one occasion — the library's or a client's own — and the dates of a
 * moving one. Shared by the library screen and the client's brand page so the
 * two cannot drift apart.
 */

export type OccasionView = {
  id: string;
  clientId: string | null;
  name: string;
  category: string;
  description: string | null;
  fixedMonth: number | null;
  fixedDay: number | null;
  archived: boolean;
  /** `YYYY-MM-DD`, ascending. */
  dates: { id: string; day: string }[];
};

export const CATEGORY_LABEL: Record<string, string> = {
  FESTIVAL: "Festival",
  NATIONAL_DAY: "National day",
  AWARENESS_DAY: "Awareness day",
  INDUSTRY_EVENT: "Industry event",
  BRAND: "Brand",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "26 January, every year" / "8 Nov 2026" / "No date for 2026 yet". */
export function whenText(occasion: Pick<OccasionView, "fixedMonth" | "fixedDay" | "dates">, year: number): string {
  if (occasion.fixedMonth && occasion.fixedDay) return `${occasion.fixedDay} ${MONTHS[occasion.fixedMonth - 1]}, every year`;
  const upcoming = occasion.dates.filter((d) => Number(d.day.slice(0, 4)) >= year);
  if (upcoming.length === 0) return `No date for ${year} yet`;
  return upcoming
    .map((d) =>
      new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${d.day}T00:00:00Z`),
      ),
    )
    .join(" · ");
}

export function OccasionDialog({
  occasion,
  clientId,
  defaultCategory,
  onClose,
}: {
  occasion: OccasionView | null;
  clientId: string | null;
  defaultCategory?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState(occasion?.name ?? "");
  const [category, setCategory] = React.useState(occasion?.category ?? defaultCategory ?? "FESTIVAL");
  const [description, setDescription] = React.useState(occasion?.description ?? "");
  const [fixed, setFixed] = React.useState(occasion ? occasion.fixedMonth !== null : true);
  const [month, setMonth] = React.useState(String(occasion?.fixedMonth ?? 1));
  const [day, setDay] = React.useState(String(occasion?.fixedDay ?? 1));

  const save = () => {
    setError(null);
    start(async () => {
      const result = await saveOccasionAction({
        id: occasion?.id ?? null,
        clientId,
        occasion: {
          name,
          category,
          description,
          fixedMonth: fixed ? month : null,
          fixedDay: fixed ? day : null,
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      push({ tone: "success", title: occasion ? "Occasion saved." : "Occasion added." });
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onClose={onClose} title={occasion ? "Edit occasion" : "New occasion"}>
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text">
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}
        <Field id="occasion-name" label="Occasion name" required>
          {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand anniversary" />}
        </Field>
        <Field id="occasion-category" label="Kind">
          {(aria) => (
            <Select {...aria} value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-navy-800">When</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" className="accent-brand-red" checked={fixed} onChange={() => setFixed(true)} />
            The same day every year
          </label>
          {fixed ? (
            <div className="flex gap-2 pl-6">
              <Select aria-label="Day" className="w-24" value={day} onChange={(e) => setDay(e.target.value)}>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </Select>
              <Select aria-label="Month" className="w-40" value={month} onChange={(e) => setMonth(e.target.value)}>
                {MONTHS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" className="accent-brand-red" checked={!fixed} onChange={() => setFixed(false)} />
            A different day each year — dates are entered one year at a time
          </label>
        </fieldset>
        <Field id="occasion-description" label="Notes">
          {(aria) => <Textarea {...aria} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Button onClick={save} disabled={pending || name.trim().length < 2}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Dialog>
  );
}

/** A moving occasion's dates: listed, removable, and one added at a time. */
export function OccasionDates({ occasion, canEdit }: { occasion: OccasionView; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [day, setDay] = React.useState("");

  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const result = await work();
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      push({ tone: "success", title: done });
      setDay("");
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {occasion.dates.map((date) => (
        <Badge key={date.id} tone="navy">
          {date.day}
          {canEdit ? (
            <button
              type="button"
              aria-label={`Remove ${date.day}`}
              className="ml-1 inline-flex"
              disabled={pending}
              onClick={() => run(() => removeOccasionDateAction({ dateId: date.id }), "Date removed.")}
            >
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
        </Badge>
      ))}
      {canEdit ? (
        <span className="flex items-center gap-1">
          <Input
            type="date"
            aria-label={`Add a date for ${occasion.name}`}
            className="h-8 w-40 text-xs"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !day}
            onClick={() => run(() => addOccasionDateAction({ id: occasion.id, day }), "Date added.")}
          >
            <Plus size={13} aria-hidden="true" />
            Add date
          </Button>
        </span>
      ) : null}
    </div>
  );
}

export function ArchiveOccasionButton({ occasion }: { occasion: OccasionView }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await archiveOccasionAction({ id: occasion.id, archived: !occasion.archived });
          if (!result.ok) {
            push({ tone: "error", title: "That did not work.", description: result.message });
            return;
          }
          push({ tone: "success", title: occasion.archived ? "Restored." : "Archived." });
          router.refresh();
        })
      }
    >
      {occasion.archived ? "Restore" : "Archive"}
    </Button>
  );
}
