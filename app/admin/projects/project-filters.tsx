"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL } from "@/lib/projects/lifecycle";

/**
 * Project list filters.
 *
 * State lives in the URL, so a filtered view is shareable, survives a refresh,
 * and is filtered by the server rather than in the browser.
 */

type Option = { id: string; name: string };

export function ProjectFilters({
  params,
  clients,
  staff,
}: {
  params: Record<string, unknown>;
  clients: readonly Option[];
  staff: readonly Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = React.useState(String(params["search"] ?? ""));

  const push = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Any filter change returns to page one.
      next.delete("page");
      router.push(`/admin/projects?${next.toString()}`);
    },
    [router, searchParams],
  );

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    push({ search: search.trim() || undefined });
  };

  const activeCount = ["status", "clientId", "managerId", "search"].filter((key) =>
    searchParams.get(key),
  ).length;

  const selectClass =
    "h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red";

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="flex items-center gap-1.5">
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id="project-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, code or client"
              className="h-9 w-60 rounded-md border border-line-strong pl-8 pr-2 text-sm focus:border-brand-red"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-md border border-line-strong px-3 text-sm text-navy-800 hover:border-navy-300"
          >
            Search
          </button>
        </form>

        <label className="sr-only" htmlFor="filter-project-status">
          Status
        </label>
        <select
          id="filter-project-status"
          className={selectClass}
          value={searchParams.get("status") ?? ""}
          onChange={(e) => push({ status: e.target.value || undefined })}
        >
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROJECT_STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-project-client">
          Client
        </label>
        <select
          id="filter-project-client"
          className={selectClass}
          value={searchParams.get("clientId") ?? ""}
          onChange={(e) => push({ clientId: e.target.value || undefined })}
        >
          <option value="">Any client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>

        {staff.length > 0 ? (
          <>
            <label className="sr-only" htmlFor="filter-project-manager">
              Manager
            </label>
            <select
              id="filter-project-manager"
              className={selectClass}
              value={searchParams.get("managerId") ?? ""}
              onChange={(e) => push({ managerId: e.target.value || undefined })}
            >
              <option value="">Any manager</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label className="sr-only" htmlFor="filter-project-sort">
          Sort
        </label>
        <select
          id="filter-project-sort"
          className={selectClass}
          value={searchParams.get("sort") ?? "createdAt"}
          onChange={(e) => push({ sort: e.target.value })}
        >
          <option value="createdAt">Newest first</option>
          <option value="dueAt">By due date</option>
          <option value="name">By name</option>
          <option value="status">By status</option>
        </select>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              router.push("/admin/projects");
            }}
            className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-sm text-ink-muted hover:text-brand-red-text"
          >
            <X size={14} aria-hidden="true" />
            Clear {activeCount}
          </button>
        ) : null}
      </div>
    </div>
  );
}
