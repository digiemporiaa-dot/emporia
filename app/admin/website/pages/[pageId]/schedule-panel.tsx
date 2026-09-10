"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button, Card, CardBody, Field, Input, useToast } from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import { setScheduleAction } from "../../actions";

/**
 * Scheduled publishing.
 *
 * Times are stored in UTC and shown in the operator's own clock, converted
 * here rather than on the server: the server has no idea where anyone is, and a
 * page scheduled for "9am" by someone in Gurgaon should go live at 9am there.
 * The browser's timezone is named on screen so there is no ambiguity about
 * which 9am was meant.
 *
 * `datetime-local` gives a value like `2026-09-15T09:00` with no offset, which
 * `new Date()` reads in the browser's own zone — exactly the interpretation
 * wanted — and `toISOString()` then hands the server UTC.
 */

/** UTC ISO → the `datetime-local` value for this browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Shift by the offset so the *displayed* fields read as local time, then trim
  // the seconds and zone the input does not accept.
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** The `datetime-local` value → UTC ISO, or "" to clear. */
function toIso(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function SchedulePanel({
  pageId,
  status,
  publishAt,
  unpublishAt,
  canPublish,
}: {
  pageId: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishAt: string | null;
  unpublishAt: string | null;
  canPublish: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const ready = useHydrated();
  const [pending, startTransition] = React.useTransition();
  const [up, setUp] = React.useState(() => toLocalInput(publishAt));
  const [down, setDown] = React.useState(() => toLocalInput(unpublishAt));
  const [error, setError] = React.useState<string | null>(null);

  // Read once the component is alive; on the server there is no such thing.
  const zone = ready ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await setScheduleAction(pageId, toIso(up), toIso(down));
      if (result.ok) {
        push({ tone: "success", title: "Schedule saved." });
        router.refresh();
        return;
      }
      setError(result.message);
    });
  };

  const clear = () => {
    setUp("");
    setDown("");
    startTransition(async () => {
      const result = await setScheduleAction(pageId, "", "");
      if (result.ok) {
        push({ tone: "success", title: "Schedule cleared." });
        router.refresh();
        return;
      }
      setError(result.message);
    });
  };

  if (!canPublish) {
    // Scheduling a publish is publishing, just later, so an editor who cannot
    // publish sees the schedule rather than the controls.
    return publishAt || unpublishAt ? (
      <Card>
        <CardBody>
          <h2 className="flex items-center gap-2 font-display text-lg text-navy-800">
            <CalendarClock size={16} aria-hidden="true" className="text-ink-subtle" />
            Scheduled
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {publishAt ? `Goes live ${new Date(publishAt).toLocaleString()}. ` : ""}
            {unpublishAt ? `Comes down ${new Date(unpublishAt).toLocaleString()}.` : ""}
          </p>
        </CardBody>
      </Card>
    ) : null;
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg text-navy-800">
            <CalendarClock size={16} aria-hidden="true" className="text-ink-subtle" />
            Schedule
          </h2>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {zone ? `Times are in ${zone}, your own clock.` : "Times are in your own clock."} A page
            goes live on the first check after its time, not to the second.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
          >
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="publishAt"
            label="Go live"
            hint={status === "PUBLISHED" ? "This page is already live." : "Leave blank for none."}
          >
            {(aria) => (
              <Input
                {...aria}
                type="datetime-local"
                value={up}
                onChange={(event) => setUp(event.target.value)}
              />
            )}
          </Field>
          <Field id="unpublishAt" label="Come down" hint="Leave blank for none.">
            {(aria) => (
              <Input
                {...aria}
                type="datetime-local"
                value={down}
                onChange={(event) => setDown(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={pending || !ready} onClick={save}>
            {pending ? "Saving…" : "Save schedule"}
          </Button>
          {publishAt || unpublishAt ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || !ready}
              onClick={clear}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
