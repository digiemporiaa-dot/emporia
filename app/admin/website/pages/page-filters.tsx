"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

/**
 * Pages list filters.
 *
 * State lives in the URL rather than in component state, so a filtered view is
 * shareable and survives a refresh — and so the *server* does the filtering
 * (CLAUDE.md 12: never load a full table into the browser).
 */

const STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

export function PageFilters({ params }: { params: Record<string, unknown> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState(String(params["query"] ?? ""));

  const push = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Any filter change returns to page one; staying on page 7 of a
      // different result set is never what someone means.
      next.delete("page");
      router.push(`/admin/website/pages?${next.toString()}`);
    },
    [router, searchParams],
  );

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    push({ query: query.trim() || undefined });
  };

  const view = searchParams.get("view") ?? "active";
  const activeCount = ["query", "status"].filter((key) => searchParams.get(key)).length;

  const selectClass =
    "h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red";

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="flex items-center gap-1.5">
          <label htmlFor="page-search" className="sr-only">
            Search pages
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id="page-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, slug or internal name"
              className="h-9 w-64 rounded-md border border-line-strong bg-white pl-8 pr-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-red"
            />
          </div>
        </form>

        <label htmlFor="page-status" className="sr-only">
          Filter by status
        </label>
        <select
          id="page-status"
          className={selectClass}
          value={String(params["status"] ?? "")}
          onChange={(e) => push({ status: e.target.value || undefined })}
        >
          <option value="">Any status</option>
          {STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>

        <div
          className="flex items-center rounded-md border border-line-strong p-0.5"
          role="group"
          aria-label="View"
        >
          {(
            [
              { value: "active", label: "Pages" },
              { value: "deleted", label: "Bin" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => push({ view: option.value === "active" ? undefined : option.value })}
              className={
                view === option.value
                  ? "rounded-sm bg-navy-800 px-2.5 py-1 text-xs font-medium text-white"
                  : "rounded-sm px-2.5 py-1 text-xs text-ink-muted hover:text-navy-800"
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              push({ query: undefined, status: undefined });
            }}
            className="flex items-center gap-1 text-xs text-ink-muted hover:text-brand-red-text"
          >
            <X size={12} aria-hidden="true" />
            Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
