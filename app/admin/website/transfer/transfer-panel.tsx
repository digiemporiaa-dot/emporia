"use client";

import * as React from "react";
import { AlertCircle, ArrowUpFromLine, CheckCircle2, Download, Upload } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Select,
  Table,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import type { Column, ImportPlan } from "@/lib/transfer/types";
import type { TransferType } from "@/lib/transfer/columns";
import { commitImportAction, planImportAction } from "./actions";

/**
 * Export, then preview, then import.
 *
 * The preview is the point of the screen. An import that just runs is an
 * import nobody can check, and the row an operator most needs to see is the
 * one they did not intend — so the table shows every row's fate, errors first,
 * and the confirm button is not offered at all while any row is wrong.
 */

export type TransferOption = {
  type: TransferType;
  label: string;
  plural: string;
  columns: readonly Column[];
  omits: readonly string[];
  naturalKey: string | null;
  canImport: boolean;
  canCreate: boolean;
};

/** Matches the service's cap, so an oversized file is refused before upload. */
const MAX_BYTES = 2_000_000;

const OUTCOME_LABEL = {
  create: "Create",
  update: "Update",
  unchanged: "No change",
  error: "Error",
} as const;

const OUTCOME_TONE = {
  create: "text-success",
  update: "text-navy-700",
  unchanged: "text-ink-subtle",
  error: "text-brand-red-text",
} as const;

export function TransferPanel({ options }: { options: readonly TransferOption[] }) {
  const ready = useHydrated();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [type, setType] = React.useState<TransferType>(options[0]?.type ?? "service");
  const [csv, setCsv] = React.useState<string | null>(null);
  const [plan, setPlan] = React.useState<ImportPlan | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const option = options.find((entry) => entry.type === type) ?? options[0];

  /** Clear the file and its preview. The summary of a run that just happened
   *  survives on purpose: it is the only record the operator has of what the
   *  import did, and clearing it with the form would take it away as they read it. */
  const clearFile = () => {
    setCsv(null);
    setPlan(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const reset = () => {
    clearFile();
    setError(null);
    setDone(null);
  };

  const onFile = async (file: File | undefined) => {
    setPlan(null);
    setError(null);
    setDone(null);
    if (!file) {
      setCsv(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is bigger than 2 MB. Split it and import the parts.");
      setCsv(null);
      return;
    }
    setCsv(await file.text());
  };

  const preview = () => {
    if (!csv || !option) return;
    setError(null);
    setDone(null);
    start(async () => {
      const result = await planImportAction({ type: option.type, csv });
      if (result.ok) setPlan(result.data);
      else {
        setPlan(null);
        setError(result.message);
      }
    });
  };

  const apply = () => {
    if (!csv || !option) return;
    setError(null);
    start(async () => {
      const result = await commitImportAction({ type: option.type, csv });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const { created, updated, unchanged, stoppedAt } = result.data;
      if (stoppedAt) {
        setError(
          `Stopped at line ${stoppedAt.line}: ${stoppedAt.message} ${created} created and ${updated} updated before that; the rest were not applied.`,
        );
        setPlan(null);
        return;
      }
      setDone(
        `${created} created, ${updated} updated${unchanged > 0 ? `, ${unchanged} already up to date` : ""}.`,
      );
      push({ tone: "success", title: "Import applied." });
      clearFile();
    });
  };

  if (!option) return null;

  const blocked = plan !== null && plan.counts.error > 0;
  const nothingToDo = plan !== null && plan.counts.create === 0 && plan.counts.update === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What to move</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <label className="block max-w-xs">
            <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Content type
            </span>
            <Select
              value={type}
              onChange={(event) => {
                setType(event.target.value as TransferType);
                reset();
              }}
            >
              {options.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.plural}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            {/* A plain link, not a scripted download: the route sets the
                filename and the content type, so the browser does the rest. */}
            <a
              href={`/api/export/${option.type}`}
              download
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-white px-3 text-xs text-navy-800 hover:border-navy-300 hover:bg-surface-muted"
            >
              <Download size={14} aria-hidden="true" />
              Export {option.plural.toLowerCase()}
            </a>
            <p className="text-xs text-ink-subtle">
              Every column below, in this order. Edit it and bring the same file back.
            </p>
          </div>

          {option.omits.length > 0 ? (
            // Said plainly rather than discovered: a spreadsheet cannot carry
            // structured page content or an image, and a blank column that
            // wiped one would be the worst thing this screen could do.
            <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
              A spreadsheet cannot carry {list(option.omits)}. Those are left exactly as they are,
              whatever the file says.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Columns</CardTitle>
        </CardHeader>
        <CardBody>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Column</TH>
                  <TH>What it means</TH>
                </TR>
              </THead>
              <TBody>
                {option.columns.map((column) => (
                  <TR key={column.header}>
                    <TD className="whitespace-nowrap font-mono text-xs text-navy-800">
                      {column.header}
                    </TD>
                    <TD className="text-xs text-ink-muted">{column.note}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <p className="mt-3 text-xs text-ink-subtle">
            A column you leave out of the file changes nothing.{" "}
            {option.naturalKey
              ? `A row with no id is matched on its ${option.naturalKey}; if nothing matches, it is created.`
              : "A row with no id always creates a new record — this type has nothing unique to match on."}
          </p>
        </CardBody>
      </Card>

      {option.canImport ? (
        <Card>
          <CardHeader>
            <CardTitle>Import</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                aria-label="CSV file"
                onChange={(event) => void onFile(event.target.files?.[0])}
                className="block max-w-sm text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-muted file:px-3 file:py-1.5 file:text-xs file:text-navy-800 hover:file:border-brand-red"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!ready || pending || csv === null}
                onClick={preview}
              >
                <Upload size={14} aria-hidden="true" />
                {pending && plan === null ? "Reading…" : "Preview"}
              </Button>
            </div>

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
              >
                <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            ) : null}

            {done ? (
              <p
                role="status"
                className="flex items-start gap-2 rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
              >
                <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{done}</span>
              </p>
            ) : null}

            {plan ? (
              <PlanView
                plan={plan}
                label={option.label}
                canCreate={option.canCreate}
                blocked={blocked}
                nothingToDo={nothingToDo}
                pending={pending}
                onApply={apply}
              />
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <p className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted">
          You can export {option.plural.toLowerCase()} but not change them, so there is no import
          here.
        </p>
      )}
    </div>
  );
}

function PlanView({
  plan,
  label,
  canCreate,
  blocked,
  nothingToDo,
  pending,
  onApply,
}: {
  plan: ImportPlan;
  label: string;
  canCreate: boolean;
  blocked: boolean;
  nothingToDo: boolean;
  pending: boolean;
  onApply: () => void;
}) {
  // Errors first: they are the rows that decide whether this import happens,
  // and making somebody scroll a thousand rows to find three is not a preview.
  const rows = [...plan.rows].sort((a, b) => {
    const rank = (outcome: string) => (outcome === "error" ? 0 : 1);
    return rank(a.outcome) - rank(b.outcome) || a.line - b.line;
  });

  const missingCreate = plan.counts.create > 0 && !canCreate;

  return (
    <div className="space-y-3">
      <p className="text-sm text-navy-800">
        {plan.counts.create} to create · {plan.counts.update} to update · {plan.counts.unchanged}{" "}
        already up to date ·{" "}
        <span className={plan.counts.error > 0 ? "font-medium text-brand-red-text" : ""}>
          {plan.counts.error} with errors
        </span>
      </p>

      {plan.unknownHeaders.length > 0 ? (
        <p className="text-xs text-ink-subtle">
          Ignored {plan.unknownHeaders.length === 1 ? "a column" : "columns"} this type does not
          know: {plan.unknownHeaders.join(", ")}.
        </p>
      ) : null}

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH className="w-16">Line</TH>
              <TH className="w-24">Outcome</TH>
              <TH>{label}</TH>
              <TH>Detail</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={`${row.line}-${row.outcome}`}>
                <TD className="tabular-nums text-xs text-ink-subtle">{row.line}</TD>
                <TD className={`text-xs font-medium ${OUTCOME_TONE[row.outcome]}`}>
                  {OUTCOME_LABEL[row.outcome]}
                </TD>
                <TD className="max-w-xs truncate text-sm text-navy-800">{row.label}</TD>
                <TD className="text-xs text-ink-muted">
                  {row.outcome === "error" ? (
                    <ul className="space-y-0.5">
                      {row.errors.map((message) => (
                        <li key={message} className="text-brand-red-text">
                          {message}
                        </li>
                      ))}
                    </ul>
                  ) : row.outcome === "update" ? (
                    `Changes ${row.changed.join(", ")}.`
                  ) : row.outcome === "create" ? (
                    "A new record."
                  ) : (
                    "The file matches what is already there."
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      {blocked ? (
        <p className="text-sm text-brand-red-text">
          Fix those rows and preview again. Nothing is imported while any row has an error — a file
          half-applied is harder to recover from than one refused.
        </p>
      ) : nothingToDo ? (
        <p className="text-sm text-ink-muted">Nothing in that file changes anything.</p>
      ) : missingCreate ? (
        <p className="text-sm text-brand-red-text">
          That file creates records, and you may only change existing ones.
        </p>
      ) : (
        <Button type="button" disabled={pending} onClick={onApply}>
          <ArrowUpFromLine size={14} aria-hidden="true" />
          {pending ? "Importing…" : `Apply ${plan.counts.create + plan.counts.update} changes`}
        </Button>
      )}
    </div>
  );
}

function list(values: readonly string[]): string {
  if (values.length === 1) return values[0] as string;
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}
