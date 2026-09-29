"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { AlertCircle, FileText, Printer, Download, Send, Undo2 } from "lucide-react";
import { Button, Select, Textarea, useToast } from "@/components/ui";
import { generateReportAction, saveReportNotesAction, setReportPublishedAction } from "./actions";

/** Choosing a month and generating its report. */
export function GenerateReport({
  clientId,
  months,
  existing,
}: {
  clientId: string;
  months: { value: string; label: string }[];
  /** Month → status, for months that already have a report. */
  existing: Record<string, "DRAFT" | "PUBLISHED">;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState(months.find((m) => !existing[m.value])?.value ?? months[0]?.value ?? "");
  const status = existing[month];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">Month</span>
          <Select className="w-52" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
                {existing[m.value] ? ` — ${existing[m.value] === "PUBLISHED" ? "published" : "draft"}` : ""}
              </option>
            ))}
          </Select>
        </label>
        <Button
          size="sm"
          disabled={pending || !month || status === "PUBLISHED"}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await generateReportAction({ clientId, month });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.push(`/admin/clients/${clientId}/social/reports/${result.data.id}` as Route);
            })
          }
        >
          <FileText size={14} aria-hidden="true" />
          {pending ? "Generating…" : status === "DRAFT" ? "Regenerate draft" : "Generate report"}
        </Button>
      </div>
      {status === "PUBLISHED" ? <p className="text-2xs text-ink-subtle">That month is published. Unpublish it to regenerate.</p> : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Notes, publishing and downloads for one report. */
export function ReportActions({
  clientId,
  reportId,
  status,
  notes,
  canManage,
}: {
  clientId: string;
  reportId: string;
  status: "DRAFT" | "PUBLISHED";
  notes: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [text, setText] = React.useState(notes ?? "");

  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const result = await work();
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      push({ tone: "success", title: done });
      router.refresh();
    });

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/print/social-reports/${reportId}`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-navy-800 hover:border-navy-300"
        >
          <Printer size={13} aria-hidden="true" />
          Print or save as PDF
        </a>
        <a
          href={`/api/social/reports/${reportId}/csv`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-navy-800 hover:border-navy-300"
        >
          <Download size={13} aria-hidden="true" />
          Download CSV
        </a>
        {canManage ? (
          status === "DRAFT" ? (
            <Button size="sm" disabled={pending} onClick={() => run(() => setReportPublishedAction({ clientId, reportId, published: true }), "Published to the client's portal.")}>
              <Send size={14} aria-hidden="true" />
              Publish to client
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setReportPublishedAction({ clientId, reportId, published: false }), "Taken back from the portal.")}>
              <Undo2 size={14} aria-hidden="true" />
              Unpublish
            </Button>
          )
        ) : null}
      </div>
      {canManage && status === "DRAFT" ? (
        <div className="space-y-2">
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Notes for the client"
            placeholder="Optional notes for the client — what worked, what changes next month. The figures come from the data; do not add numbers here."
          />
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => saveReportNotesAction({ clientId, reportId, notes: text.trim() || null }), "Notes saved.")}>
            Save notes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
