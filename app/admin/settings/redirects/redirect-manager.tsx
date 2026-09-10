"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Plus, Search, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import {
  deleteRedirectAction,
  saveRedirectAction,
  type RedirectActionState,
} from "./actions";

/**
 * Redirect management.
 *
 * The engine has existed since the SEO phase — loop detection at write time,
 * resolution from the catch-all route, hit counting. What was missing was
 * anywhere to use it, so redirects could only be created by writing to the
 * database. This is that screen.
 */

export type RedirectRow = {
  id: string;
  fromPath: string;
  toPath: string;
  permanent: boolean;
  isActive: boolean;
  hits: number;
  lastHitAt: string | null;
};

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

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
  const ready = useHydrated();
  return (
    <Button type="submit" size="sm" disabled={pending || !ready}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function RedirectForm({
  row,
  onDone,
}: {
  row: RedirectRow | null;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<RedirectActionState, FormData>(
    saveRedirectAction,
    null,
  );
  // `details` is `unknown` on the wire, so it is narrowed here rather than
  // asserted: a failure shape that is not the field map simply yields no
  // per-field errors, and the message still shows.
  const fieldErrors =
    state && !state.ok && state.details && typeof state.details === "object"
      ? (state.details as Record<string, string[] | undefined>)
      : null;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  React.useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on a successful save
  }, [state]);

  return (
    <Card>
      <CardBody>
        <h2 className="font-display text-lg text-navy-800">
          {row ? "Edit redirect" : "New redirect"}
        </h2>

        <form action={formAction} className="mt-4 space-y-4" noValidate>
          {row ? <input type="hidden" name="id" value={row.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="fromPath"
              label="Old address"
              required
              hint="The path that no longer exists, e.g. /old-service."
              error={err("fromPath")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  name="fromPath"
                  defaultValue={row?.fromPath ?? ""}
                  placeholder="/old-service"
                  required
                />
              )}
            </Field>

            <Field
              id="toPath"
              label="Send them to"
              required
              hint="A path on this site, or a full URL to leave it."
              error={err("toPath")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  name="toPath"
                  defaultValue={row?.toPath ?? ""}
                  placeholder="/services/seo"
                  required
                />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                name="permanent"
                defaultChecked={row ? row.permanent : true}
                className="h-4 w-4 rounded-sm border-line-strong text-brand-red"
              />
              Permanent
            </label>
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={row ? row.isActive : true}
                className="h-4 w-4 rounded-sm border-line-strong text-brand-red"
              />
              Active
            </label>
          </div>

          <p className="text-2xs text-ink-subtle">
            Permanent tells search engines to move the ranking to the new address, and is what you
            want after renaming a page. Temporary leaves the old address ranking. This application
            serves 308 and 307 rather than 301 and 302 — search engines treat each pair
            identically.
          </p>

          {state && !state.ok ? <Problem message={state.message} /> : null}

          <div className="flex items-center gap-2">
            <Submit label={row ? "Save redirect" : "Create redirect"} />
            <Button type="button" size="sm" variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function RedirectManager({
  rows,
  total,
  canEdit,
}: {
  rows: RedirectRow[];
  total: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editing, setEditing] = React.useState<RedirectRow | null | "new">(null);
  const [search, setSearch] = React.useState(searchParams.get("search") ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = useTransition();

  const active = searchParams.get("active") ?? "all";

  const push = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    router.push(`/admin/settings/redirects?${next.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            push({ search: search.trim() || undefined });
          }}
          className="flex items-center gap-1.5"
        >
          <label htmlFor="redirect-search" className="sr-only">
            Search redirects
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id="redirect-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Either address"
              className="h-9 w-56 rounded-md border border-line-strong pl-8 pr-2 text-sm focus:border-brand-red"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md border border-line-strong px-3 text-sm text-navy-800 hover:border-navy-300"
          >
            Search
          </button>
        </form>

        <label className="sr-only" htmlFor="redirect-active">
          Status
        </label>
        <select
          id="redirect-active"
          value={active}
          onChange={(event) => push({ active: event.target.value })}
          className="h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red"
        >
          <option value="all">Active and off</option>
          <option value="on">Active only</option>
          <option value="off">Switched off</option>
        </select>

        {canEdit ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} aria-hidden="true" />
            New redirect
          </Button>
        ) : null}

        <p className="ml-auto text-xs text-ink-subtle">
          {total} redirect{total === 1 ? "" : "s"}
        </p>
      </div>

      {editing ? (
        <RedirectForm
          row={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <Problem message={error} />

      <TableWrap label="Redirects">
        <Table>
          <THead>
            <TR>
              <TH>Old address</TH>
              <TH>Sends to</TH>
              <TH>Type</TH>
              <TH className="text-right">Hits</TH>
              <TH>Last used</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TableEmpty
                colSpan={6}
                title="No redirects"
                description="Add one after renaming a page, so its old address keeps working and its ranking moves with it."
              />
            ) : (
              rows.map((row) => (
                <TR key={row.id}>
                  <TD className="font-mono text-xs text-navy-800">{row.fromPath}</TD>
                  <TD className="font-mono text-xs text-ink-subtle">
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowRight size={12} aria-hidden="true" />
                      {row.toPath}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={row.permanent ? "neutral" : "warning"}>
                        {row.permanent ? "Permanent" : "Temporary"}
                      </Badge>
                      {row.isActive ? null : <Badge tone="warning">Off</Badge>}
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums">{row.hits}</TD>
                  <TD className="text-xs text-ink-subtle">
                    {row.lastHitAt ? DATE.format(new Date(row.lastHitAt)) : "Never"}
                  </TD>
                  <TD>
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditing(row)}
                          className="rounded-sm px-2 py-1 text-xs text-navy-800 hover:text-brand-red"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setError(null);
                            start(async () => {
                              const result = await deleteRedirectAction(row.id);
                              if (!result.ok) setError(result.message);
                              else router.refresh();
                            });
                          }}
                          className="rounded-sm p-1 text-ink-subtle hover:text-brand-red disabled:opacity-50"
                        >
                          <Trash2 size={13} aria-hidden="true" />
                          <span className="sr-only">Delete the redirect from {row.fromPath}</span>
                        </button>
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  );
}
