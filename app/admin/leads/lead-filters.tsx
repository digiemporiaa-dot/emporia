"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import type { LeadStatus } from "@/generated/prisma/enums";

/**
 * List filters.
 *
 * State lives in the URL rather than in component state, so a filtered view is
 * shareable and survives a refresh — and so the server does the filtering.
 */

type Option = { id: string; name: string };

export function LeadFilters({
  params,
  sources,
  services,
  cities,
  staff,
  stages,
}: {
  params: Record<string, unknown>;
  sources: readonly Option[];
  services: readonly Option[];
  cities: readonly Option[];
  staff: readonly Option[];
  stages: readonly LeadStatus[];
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
      // Any filter change returns to page one; staying on page 7 of a
      // different result set is never what someone means.
      next.delete("page");
      router.push(`/admin/leads?${next.toString()}`);
    },
    [router, searchParams],
  );

  const onSearch = (event: React.FormEvent) => {
    event.preventDefault();
    push({ search: search.trim() || undefined });
  };

  const activeCount = ["status", "priority", "sourceId", "serviceId", "cityId", "assignedToId", "unassigned", "search"]
    .filter((key) => searchParams.get(key))
    .length;

  const selectClass =
    "h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red";

  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="flex items-center gap-1.5">
          <label htmlFor="lead-search" className="sr-only">
            Search leads
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id="lead-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, phone, company"
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

        <label className="sr-only" htmlFor="filter-status">
          Status
        </label>
        <select
          id="filter-status"
          className={selectClass}
          value={searchParams.get("status") ?? ""}
          onChange={(e) => push({ status: e.target.value || undefined })}
        >
          <option value="">All statuses</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {stage.toLowerCase()}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-priority">
          Priority
        </label>
        <select
          id="filter-priority"
          className={selectClass}
          value={searchParams.get("priority") ?? ""}
          onChange={(e) => push({ priority: e.target.value || undefined })}
        >
          <option value="">Any priority</option>
          {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
            <option key={p} value={p}>
              {p.toLowerCase()}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-source">
          Source
        </label>
        <select
          id="filter-source"
          className={selectClass}
          value={searchParams.get("sourceId") ?? ""}
          onChange={(e) => push({ sourceId: e.target.value || undefined })}
        >
          <option value="">Any source</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-service">
          Service
        </label>
        <select
          id="filter-service"
          className={selectClass}
          value={searchParams.get("serviceId") ?? ""}
          onChange={(e) => push({ serviceId: e.target.value || undefined })}
        >
          <option value="">Any service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-city">
          City
        </label>
        <select
          id="filter-city"
          className={selectClass}
          value={searchParams.get("cityId") ?? ""}
          onChange={(e) => push({ cityId: e.target.value || undefined })}
        >
          <option value="">Any city</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Only rendered for actors who can see the whole team; a rep has
            nobody else to filter by. */}
        {staff.length > 0 ? (
          <>
            <label className="sr-only" htmlFor="filter-owner">
              Owner
            </label>
            <select
              id="filter-owner"
              className={selectClass}
              value={searchParams.get("unassigned") ? "__unassigned__" : (searchParams.get("assignedToId") ?? "")}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "__unassigned__") push({ unassigned: "true", assignedToId: undefined });
                else push({ assignedToId: value || undefined, unassigned: undefined });
              }}
            >
              <option value="">Any owner</option>
              <option value="__unassigned__">Unassigned</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label className="sr-only" htmlFor="filter-sort">
          Sort
        </label>
        <select
          id="filter-sort"
          className={selectClass}
          value={`${searchParams.get("sort") ?? "createdAt"}:${searchParams.get("direction") ?? "desc"}`}
          onChange={(e) => {
            const [sort, direction] = e.target.value.split(":");
            push({ sort, direction });
          }}
        >
          <option value="createdAt:desc">Newest first</option>
          <option value="createdAt:asc">Oldest first</option>
          <option value="score:desc">Highest score</option>
          <option value="score:asc">Lowest score</option>
          <option value="name:asc">Name A–Z</option>
          <option value="status:asc">Status</option>
        </select>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              router.push("/admin/leads");
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-muted hover:bg-surface-muted hover:text-brand-red-text"
          >
            <X size={14} aria-hidden="true" />
            Clear {activeCount}
          </button>
        ) : null}
      </div>
    </div>
  );
}
