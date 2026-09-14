"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, FlaskConical, Play, Plus, Square, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Field, Input, Textarea } from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import { MIN_CONVERSIONS_TOTAL, MIN_EXPOSURES_PER_ARM } from "@/lib/experiments/stats";
import {
  createExperimentAction,
  deleteExperimentAction,
  setExperimentStatusAction,
  type ExperimentActionState,
} from "./actions";

/**
 * A/B tests, and what they do and do not tell you.
 *
 * The reading is deliberately conservative: below the minimum sample it reports
 * how far off it is rather than showing a percentage that would be read as a
 * result. The peeking caveat is stated on screen because the tool cannot
 * enforce it — checking repeatedly and stopping at the first significant
 * reading inflates the false-positive rate well past the nominal 5%.
 */

export type ArmRow = {
  key: string;
  name: string;
  exposures: number;
  conversions: number;
  rate: number | null;
};

export type ExperimentRow = {
  id: string;
  key: string;
  name: string;
  hypothesis: string | null;
  status: "DRAFT" | "RUNNING" | "STOPPED";
  startedAt: string | null;
  arms: ArmRow[];
  sections: number;
  reading:
    | { state: "no-data"; needed: string }
    | { state: "too-early"; needed: string }
    | { state: "no-difference"; pValue: number }
    | { state: "difference"; pValue: number; leader: string };
};

const STATUS_TONE = { DRAFT: "neutral", RUNNING: "success", STOPPED: "warning" } as const;

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  const ready = useHydrated();
  return (
    <Button type="submit" size="sm" disabled={pending || !ready}>
      {pending ? "Creating…" : "Create experiment"}
    </Button>
  );
}

function NewExperiment({ onDone }: { onDone: () => void }) {
  const [state, formAction] = useActionState<ExperimentActionState, FormData>(
    createExperimentAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on success
  }, [state]);

  return (
    <Card>
      <CardBody>
        <h2 className="font-display text-lg text-navy-800">New experiment</h2>
        <form action={formAction} className="mt-4 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name" required>
              {(aria) => <Input {...aria} name="name" placeholder="Homepage hero" required />}
            </Field>
            <Field id="key" label="Handle" required hint="Lower-case, dashes.">
              {(aria) => <Input {...aria} name="key" placeholder="homepage-hero" required />}
            </Field>
          </div>

          <Field
            id="hypothesis"
            label="What are you trying to find out?"
            hint="Recorded so the result is read against the question you asked, not one invented afterwards to fit the numbers."
          >
            {(aria) => (
              <Textarea
                {...aria}
                name="hypothesis"
                rows={2}
                placeholder="A shorter hero with one call to action will produce more enquiries."
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="controlName" label="Control" hint="The page as it is today.">
              {(aria) => <Input {...aria} name="controlName" defaultValue="Control" />}
            </Field>
            <Field id="variantName" label="Variant" hint="The change being tested.">
              {(aria) => <Input {...aria} name="variantName" defaultValue="Variant" />}
            </Field>
          </div>

          {state && !state.ok ? <Problem message={state.message} /> : null}

          <div className="flex items-center gap-2">
            <Submit />
            <Button type="button" size="sm" variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function Reading({ row }: { row: ExperimentRow }) {
  const { reading } = row;

  if (reading.state === "no-data" || reading.state === "too-early") {
    return (
      <p className="text-xs text-ink-muted">
        <span className="font-medium text-navy-800">No verdict yet.</span> {reading.needed}
      </p>
    );
  }

  if (reading.state === "no-difference") {
    return (
      <p className="text-xs text-ink-muted">
        <span className="font-medium text-navy-800">No difference detected.</span> p ={" "}
        {reading.pValue.toFixed(3)} — a gap this size would not be surprising if both arms
        performed identically.
      </p>
    );
  }

  return (
    <p className="text-xs text-ink-muted">
      <span className="font-medium text-navy-800">{reading.leader} is ahead.</span> p ={" "}
      {reading.pValue.toFixed(4)} — a gap this size would be unlikely if both arms performed
      identically.
    </p>
  );
}

export function ExperimentList({
  rows,
  canManage,
}: {
  rows: ExperimentRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (run: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    start(async () => {
      const result = await run();
      if (!result.ok) setError(result.message ?? "That did not work.");
      else router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex">
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            New experiment
          </Button>
        </div>
      ) : null}

      {creating ? (
        <NewExperiment
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      ) : null}

      <Problem message={error} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-white px-4 py-10 text-center">
          <p className="text-sm text-ink-subtle">
            No experiments. Create one, then attach bands to an arm from the page builder.
          </p>
        </div>
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <CardBody>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 font-display text-lg text-navy-800">
                    <FlaskConical size={15} aria-hidden="true" className="text-ink-subtle" />
                    {row.name}
                    <Badge tone={STATUS_TONE[row.status]}>{row.status.toLowerCase()}</Badge>
                  </h2>
                  <p className="mt-0.5 font-mono text-2xs text-ink-subtle">{row.key}</p>
                  {row.hypothesis ? (
                    <p className="mt-1.5 max-w-xl text-xs text-ink-muted">{row.hypothesis}</p>
                  ) : null}
                </div>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {row.status !== "RUNNING" ? (
                      <Button
                        size="sm"
                        disabled={pending || row.status === "STOPPED"}
                        onClick={() => act(() => setExperimentStatusAction(row.id, "RUNNING"))}
                      >
                        <Play size={13} aria-hidden="true" />
                        Start
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => act(() => setExperimentStatusAction(row.id, "STOPPED"))}
                      >
                        <Square size={13} aria-hidden="true" />
                        Stop
                      </Button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => deleteExperimentAction(row.id))}
                      className="rounded-sm p-1.5 text-ink-subtle hover:text-brand-red disabled:opacity-50"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      <span className="sr-only">Delete {row.name}</span>
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {row.arms.map((arm) => (
                  <div key={arm.key} className="rounded-md border border-line px-3 py-2.5">
                    <p className="text-sm font-medium text-navy-800">{arm.name}</p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {arm.exposures} visitor{arm.exposures === 1 ? "" : "s"} ·{" "}
                      {arm.conversions} lead{arm.conversions === 1 ? "" : "s"} ·{" "}
                      {/* A rate over nobody is not zero per cent. */}
                      {arm.rate === null ? "no rate yet" : `${(arm.rate * 100).toFixed(1)}%`}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3 border-t border-line pt-3">
                <Reading row={row} />
                {row.status === "RUNNING" ? (
                  <p className="mt-2 text-2xs text-ink-subtle">
                    Checking a running test repeatedly and stopping at the first significant
                    reading makes a false positive much more likely than the p-value suggests.
                    Decide the sample you need before you start, not after you look.
                  </p>
                ) : null}
                {row.sections === 0 ? (
                  <p className="mt-2 text-2xs text-warning">
                    No bands are attached to either arm, so both arms currently show the same
                    page. Attach one from the page builder.
                  </p>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ))
      )}

      <p className="max-w-2xl text-2xs text-ink-subtle">
        A verdict needs at least {MIN_EXPOSURES_PER_ARM} visitors in each arm and{" "}
        {MIN_CONVERSIONS_TOTAL} conversions between them. Below that this reports how far off it
        is rather than a number that would be read as a result.
      </p>
    </div>
  );
}
