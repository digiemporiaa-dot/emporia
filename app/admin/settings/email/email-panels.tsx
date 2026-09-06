"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, RotateCw } from "lucide-react";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import {
  retryEmailAction,
  saveTemplateAction,
  sendTestAction,
  verifyMailerAction,
  type EmailActionState,
} from "./actions";
import type { EmailStatus } from "@/generated/prisma/enums";

/** Email settings: the template editor, a test send, and the log. */

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function MailerCheck({ configured }: { configured: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="space-y-2">
      {configured ? null : (
        <p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
          No mail server is configured, so every send will be recorded as failed. Set the SMTP_*
          environment variables.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setResult(null);
            start(async () => {
              const outcome = await verifyMailerAction();
              setResult(
                outcome.ok
                  ? { ok: true, message: outcome.data.message }
                  : { ok: false, message: outcome.message },
              );
            });
          }}
        >
          {pending ? "Checking…" : "Test the connection"}
        </Button>

        {result ? (
          result.ok ? (
            <span role="status" className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 size={13} aria-hidden="true" />
              {result.message}
            </span>
          ) : (
            <Problem message={result.message} />
          )
        ) : null}
      </div>
    </div>
  );
}

export function TemplateEditor({
  template,
  variables,
  globals,
}: {
  template: {
    key: string;
    name: string;
    subject: string;
    html: string;
    text: string | null;
    isActive: boolean;
  };
  variables: Record<string, string>;
  globals: Record<string, string>;
}) {
  const [state, formAction] = useActionState<EmailActionState, FormData>(saveTemplateAction, null);
  const [test, testAction] = useActionState<EmailActionState, FormData>(sendTestAction, null);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="key" value={template.key} />

        <Field id="name" label="Name" required>
          {(aria) => <Input {...aria} name="name" defaultValue={template.name} required />}
        </Field>

        <Field id="subject" label="Subject" required>
          {(aria) => <Input {...aria} name="subject" defaultValue={template.subject} required />}
        </Field>

        <Field id="html" label="HTML" required hint="Inline styles only — mail clients are not browsers">
          {(aria) => (
            <Textarea
              {...aria}
              name="html"
              rows={18}
              defaultValue={template.html}
              className="font-mono text-2xs"
              required
            />
          )}
        </Field>

        <Field id="text" label="Plain text" hint="Left empty, it is derived from the HTML">
          {(aria) => (
            <Textarea
              {...aria}
              name="text"
              rows={6}
              defaultValue={template.text ?? ""}
              className="font-mono text-2xs"
            />
          )}
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={template.isActive}
            className="size-4 rounded border-border text-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/40"
          />
          Send this email
        </label>

        {state && !state.ok ? <Problem message={state.message} /> : null}
        {state?.ok ? (
          <p role="status" className="text-xs text-success">
            {state.data.message}
          </p>
        ) : null}

        <Submit label="Save template" />
      </form>

      <div className="space-y-5">
        <section className="rounded-lg border border-line bg-white p-3">
          <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
            Variables
          </h2>
          <dl className="mt-2 space-y-2">
            {Object.entries({ ...variables, ...globals }).map(([name, description]) => (
              <div key={name}>
                <dt>
                  <code className="rounded-sm bg-surface-sunken px-1 py-0.5 font-mono text-2xs text-navy-800">
                    {`{{${name}}}`}
                  </code>
                </dt>
                <dd className="mt-0.5 text-2xs text-ink-subtle">{description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-t border-line pt-2 text-2xs text-ink-subtle">
            Anything else is refused when you save: a template referring to a variable nothing
            supplies would send with the placeholder still in it.
          </p>
        </section>

        <section className="rounded-lg border border-line bg-white p-3">
          <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
            Send a test
          </h2>
          <form action={testAction} className="mt-2 space-y-2" noValidate>
            <input type="hidden" name="key" value={template.key} />
            <label className="sr-only" htmlFor="test-to">
              Where to send the test
            </label>
            <Input id="test-to" name="to" type="email" placeholder="you@example.com" required />
            {test && !test.ok ? <Problem message={test.message} /> : null}
            {test?.ok ? (
              <p role="status" className="text-xs text-success">
                {test.data.message}
              </p>
            ) : null}
            <Submit label="Send test" />
          </form>
          <p className="mt-2 text-2xs text-ink-subtle">
            Variables come through as their own names in brackets, so nothing in the test pretends
            to be real data.
          </p>
        </section>
      </div>
    </div>
  );
}

const TONE: Record<EmailStatus, "neutral" | "navy" | "success" | "red"> = {
  QUEUED: "neutral",
  SENT: "success",
  FAILED: "red",
  BOUNCED: "red",
};

export function EmailLogTable({
  rows,
  total,
  page,
  pages,
  failures,
  canRetry,
}: {
  rows: {
    id: string;
    to: string;
    subject: string;
    status: EmailStatus;
    error: string | null;
    templateKey: string | null;
    createdAt: string;
    sentAt: string | null;
  }[];
  total: number;
  page: number;
  pages: number;
  failures: number;
  canRetry: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  const push = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    router.push(`/admin/settings/email?${next.toString()}`);
  };

  const when = (value: string) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="log-status">
          Status
        </label>
        <select
          id="log-status"
          value={searchParams.get("status") ?? ""}
          onChange={(event) => push({ status: event.target.value || undefined })}
          className="h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red"
        >
          <option value="">Every status</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="QUEUED">Queued</option>
          <option value="BOUNCED">Bounced</option>
        </select>

        {failures > 0 ? (
          <button
            type="button"
            onClick={() => push({ status: "FAILED" })}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-100 bg-red-50 px-2.5 text-xs text-brand-red-text"
          >
            <AlertCircle size={13} aria-hidden="true" />
            {failures} failed
          </button>
        ) : (
          <span className="text-xs text-ink-subtle">No failures.</span>
        )}

        <p className="ml-auto text-xs text-ink-subtle">{total} logged</p>
      </div>

      {message ? (
        message.ok ? (
          <p role="status" className="mb-2 text-xs text-success">
            {message.text}
          </p>
        ) : (
          <div className="mb-2">
            <Problem message={message.text} />
          </div>
        )
      ) : null}

      <div className="relative overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-2xs uppercase tracking-widest text-ink-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">To</th>
              <th scope="col" className="px-3 py-2 font-semibold">Subject</th>
              <th scope="col" className="px-3 py-2 font-semibold">Template</th>
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 font-semibold">When</th>
              <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Retry</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line" aria-busy={pending}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-subtle">
                  Nothing sent yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-xs text-ink">{row.to}</td>
                  <td className="px-3 py-2">
                    <span className="text-navy-800">{row.subject}</span>
                    {row.error ? (
                      <span className="block text-2xs text-brand-red-text">{row.error}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-2xs text-ink-subtle">
                    {row.templateKey?.replace(/_/g, " ").toLowerCase() ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={TONE[row.status]}>{row.status.toLowerCase()}</Badge>
                  </td>
                  <td className="px-3 py-2 text-2xs text-ink-subtle">
                    {when(row.sentAt ?? row.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canRetry && row.status !== "SENT" ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setMessage(null);
                          start(async () => {
                            const outcome = await retryEmailAction(row.id);
                            setMessage(
                              outcome.ok
                                ? { ok: true, text: outcome.data.message }
                                : { ok: false, text: outcome.message },
                            );
                            router.refresh();
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-sm border border-line-strong px-1.5 py-1 text-2xs text-navy-800 hover:border-brand-red hover:text-brand-red-text"
                      >
                        <RotateCw size={11} aria-hidden="true" />
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-xs text-ink-subtle">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => push({ page: String(page - 1) })}
            className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 disabled:border-line disabled:text-ink-subtle/60"
          >
            Previous
          </button>
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => push({ page: String(page + 1) })}
            className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 disabled:border-line disabled:text-ink-subtle/60"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
