"use client";

import * as React from "react";
import { useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Search } from "lucide-react";
import {
  Badge,
  Button,
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
import { CONTENT_REGISTRY, type ContentHit, type ContentType } from "@/lib/cms/registry";
import { bulkAction } from "./actions";
import type { BulkOutcome } from "@/lib/services/cms-bulk.service";

/**
 * The content library.
 *
 * One screen that searches every content type and acts on the results. It
 * exists instead of bolting selection onto six separate list screens: those
 * keep working, and a selection that spans types — publish these four pages and
 * this case study — only makes sense somewhere all of them appear.
 */

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const STATE_TONE = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
} as const;

const STATE_LABEL = {
  PUBLISHED: "Live",
  DRAFT: "Draft",
  ARCHIVED: "Archived",
} as const;

function key(hit: { type: ContentType; id: string }) {
  return `${hit.type}:${hit.id}`;
}

export function LibraryTable({
  rows,
  total,
  countsByType,
  available,
}: {
  rows: ContentHit[];
  total: number;
  countsByType: Partial<Record<ContentType, number>>;
  available: ContentType[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [outcome, setOutcome] = React.useState<BulkOutcome | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState(searchParams.get("q") ?? "");

  // The selection is keyed by type and id, and the rows change under it when a
  // filter moves. Anything no longer on screen is dropped rather than acted on
  // invisibly.
  React.useEffect(() => {
    setSelected((current) => {
      const visible = new Set(rows.map(key));
      const next = new Set([...current].filter((entry) => visible.has(entry)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const push = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [name, value] of Object.entries(updates)) {
      if (!value) next.delete(name);
      else next.set(name, value);
    }
    next.delete("page");
    router.push(`/admin/website/library?${next.toString()}`);
  };

  const toggle = (hit: ContentHit) =>
    setSelected((current) => {
      const next = new Set(current);
      const entry = key(hit);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });

  const allShown = rows.length > 0 && rows.every((row) => selected.has(key(row)));

  const run = (action: "publish" | "unpublish" | "archive") => {
    setError(null);
    setOutcome(null);
    const targets = rows.filter((row) => selected.has(key(row))).map((row) => ({
      type: row.type,
      id: row.id,
    }));

    start(async () => {
      const result = await bulkAction({ action, targets });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOutcome(result.data);
      setSelected(new Set());
      router.refresh();
    });
  };

  const activeType = searchParams.get("type") ?? "";
  const activeState = searchParams.get("state") ?? "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            push({ q: query.trim() || undefined });
          }}
          className="flex items-center gap-1.5"
        >
          <label htmlFor="library-search" className="sr-only">
            Search content
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id="library-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, address or body"
              className="h-9 w-64 rounded-md border border-line-strong pl-8 pr-2 text-sm focus:border-brand-red"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md border border-line-strong px-3 text-sm text-navy-800 hover:border-navy-300"
          >
            Search
          </button>
        </form>

        <label className="sr-only" htmlFor="library-type">
          Type
        </label>
        <select
          id="library-type"
          value={activeType}
          onChange={(event) => push({ type: event.target.value || undefined })}
          className="h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red"
        >
          <option value="">Every type</option>
          {available.map((type) => (
            <option key={type} value={type}>
              {CONTENT_REGISTRY[type].plural}
              {countsByType[type] ? ` (${countsByType[type]})` : ""}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="library-state">
          State
        </label>
        <select
          id="library-state"
          value={activeState}
          onChange={(event) => push({ state: event.target.value || undefined })}
          className="h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red"
        >
          <option value="">Any state</option>
          <option value="PUBLISHED">Live</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        <p className="ml-auto text-xs text-ink-subtle">
          {total} record{total === 1 ? "" : "s"}
        </p>
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-red/30 bg-brand-red/5 px-3.5 py-2.5">
          <p className="text-sm text-navy-800">
            {selected.size} selected
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !ready} onClick={() => run("publish")}>
              {pending ? "Working…" : "Publish"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !ready}
              onClick={() => run("unpublish")}
            >
              Unpublish
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !ready}
              onClick={() => run("archive")}
            >
              Archive
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div role="status" className="rounded-lg border border-line bg-white p-3.5">
          <p className="text-sm text-navy-800">
            {outcome.changed.length} changed
            {outcome.failed.length > 0 ? `, ${outcome.failed.length} refused` : ""}.
          </p>
          {outcome.failed.length > 0 ? (
            // Each refusal carries the record's own reason, so a thin local page
            // says it is thin rather than "failed".
            <ul className="mt-2 space-y-1 text-2xs text-ink-muted">
              {outcome.failed.map((row) => (
                <li key={key(row)}>
                  <span className="text-ink">{CONTENT_REGISTRY[row.type].label}</span> — {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <TableWrap label="Content">
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select everything on this page"
                  checked={allShown}
                  disabled={rows.length === 0}
                  onChange={() =>
                    setSelected(allShown ? new Set() : new Set(rows.map(key)))
                  }
                  className="h-4 w-4 rounded-sm border-line-strong text-brand-red"
                />
              </TH>
              <TH>Title</TH>
              <TH>Type</TH>
              <TH>Address</TH>
              <TH>State</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TableEmpty
                colSpan={6}
                title="Nothing matches"
                description="Try a different word, or widen the type and state filters."
              />
            ) : (
              rows.map((row) => (
                <TR key={key(row)}>
                  <TD>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.title}`}
                      checked={selected.has(key(row))}
                      onChange={() => toggle(row)}
                      className="h-4 w-4 rounded-sm border-line-strong text-brand-red"
                    />
                  </TD>
                  <TD>
                    <Link
                      // The registry builds the address from the type, so it is
                      // a real admin route even though its shape is not literal.
                      href={row.href as Route}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {row.title}
                    </Link>
                  </TD>
                  <TD className="text-xs text-ink-subtle">{CONTENT_REGISTRY[row.type].label}</TD>
                  <TD className="font-mono text-2xs text-ink-subtle">{row.slug ?? "—"}</TD>
                  <TD>
                    <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
                  </TD>
                  <TD className="text-xs text-ink-subtle">
                    {DATE.format(new Date(row.updatedAt))}
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
