"use client";

import * as React from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { PROVIDER_LABEL, POST_STATUS_LABEL, POST_TYPE_LABEL } from "@/lib/social/capabilities";
import { CONTENT_STAGE_LABEL, CONTENT_STAGES } from "@/lib/projects/lifecycle";
import type { CalendarView } from "@/lib/social/calendar";
import type {
  SocialPostStatus,
  SocialPostType,
  SocialProvider,
} from "@/generated/prisma/enums";

/**
 * Everything above the grid: which view, which period, and which subset.
 *
 * All of it is URL state. The view and the month a planner is looking at are
 * part of what they would send a colleague, and the back button ought to walk
 * back through the months they paged past rather than leaving the page.
 */

export type ToolbarOptions = {
  providers: SocialProvider[];
  types: SocialPostType[];
  campaigns: { id: string; name: string }[];
  pillars: { id: string; name: string }[];
  projects: { id: string; name: string; code: string }[];
  staff: { id: string; name: string }[];
};

export type ToolbarState = {
  view: CalendarView;
  date: string | null;
  provider: string | null;
  type: string | null;
  status: string | null;
  stage: string | null;
  campaignId: string | null;
  pillarId: string | null;
  projectId: string | null;
  ownerId: string | null;
};

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "list", label: "List" },
];

const STATUSES: SocialPostStatus[] = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
];

export function CalendarToolbar({
  base,
  state,
  options,
  title,
  previous,
  next,
  today,
  zone,
  count,
}: {
  base: string;
  state: ToolbarState;
  options: ToolbarOptions;
  title: string;
  previous: string;
  next: string;
  today: string;
  zone: string;
  count: number;
}) {
  const router = useRouter();

  const go = React.useCallback(
    (patch: Partial<ToolbarState>) => {
      const merged = { ...state, ...patch };
      const query = new URLSearchParams();
      // `month` and an absent date are the defaults; leaving them out keeps the
      // common URL short enough to read.
      if (merged.view !== "month") query.set("view", merged.view);
      for (const key of [
        "date",
        "provider",
        "type",
        "status",
        "stage",
        "campaignId",
        "pillarId",
        "projectId",
        "ownerId",
      ] as const) {
        const value = merged[key];
        if (value) query.set(key, value);
      }
      const suffix = query.toString();
      router.push((suffix ? `${base}?${suffix}` : base) as Route);
    },
    [base, router, state],
  );

  const filtered =
    state.provider ||
    state.type ||
    state.status ||
    state.stage ||
    state.campaignId ||
    state.pillarId ||
    state.projectId ||
    state.ownerId;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-line">
            <button
              type="button"
              aria-label="Previous period"
              onClick={() => go({ date: previous })}
              className="flex h-8 w-8 items-center justify-center text-ink-muted hover:bg-surface-muted hover:text-navy-800"
            >
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go({ date: state.view === "month" || state.view === "list" ? null : today })}
              className="h-8 border-x border-line px-3 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-navy-800"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next period"
              onClick={() => go({ date: next })}
              className="flex h-8 w-8 items-center justify-center text-ink-muted hover:bg-surface-muted hover:text-navy-800"
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>

          <div>
            <h2 className="text-lg text-navy-800">{title}</h2>
            <p className="text-2xs text-ink-subtle">
              {count} post{count === 1 ? "" : "s"} · times shown in {zone}
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Calendar view"
          className="flex items-center rounded-md border border-line p-0.5"
        >
          {VIEWS.map((view) => (
            <button
              key={view.value}
              type="button"
              aria-pressed={state.view === view.value}
              onClick={() => go({ view: view.value })}
              className={
                state.view === view.value
                  ? "rounded-sm bg-navy-800 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-sm px-3 py-1 text-xs text-ink-muted hover:text-navy-800"
              }
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Filter label="Platform" value={state.provider} onChange={(v) => go({ provider: v })} all="Every platform">
          {options.providers.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_LABEL[provider]}
            </option>
          ))}
        </Filter>

        <Filter label="Format" value={state.type} onChange={(v) => go({ type: v })} all="Every format">
          {options.types.map((type) => (
            <option key={type} value={type}>
              {POST_TYPE_LABEL[type]}
            </option>
          ))}
        </Filter>

        <Filter label="Stage" value={state.stage} onChange={(v) => go({ stage: v })} all="Every stage">
          {CONTENT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {CONTENT_STAGE_LABEL[stage]}
            </option>
          ))}
        </Filter>

        <Filter label="Status" value={state.status} onChange={(v) => go({ status: v })} all="Every status">
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {POST_STATUS_LABEL[status]}
            </option>
          ))}
        </Filter>

        {options.campaigns.length > 0 ? (
          <Filter
            label="Campaign"
            value={state.campaignId}
            onChange={(v) => go({ campaignId: v })}
            all="Every campaign"
          >
            {options.campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Filter>
        ) : null}

        {options.pillars.length > 0 ? (
          <Filter
            label="Pillar"
            value={state.pillarId}
            onChange={(v) => go({ pillarId: v })}
            all="Every pillar"
          >
            {options.pillars.map((pillar) => (
              <option key={pillar.id} value={pillar.id}>
                {pillar.name}
              </option>
            ))}
          </Filter>
        ) : null}

        {options.projects.length > 0 ? (
          <Filter
            label="Project"
            value={state.projectId}
            onChange={(v) => go({ projectId: v })}
            all="Every project"
          >
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} — {project.name}
              </option>
            ))}
          </Filter>
        ) : null}

        <Filter label="Owner" value={state.ownerId} onChange={(v) => go({ ownerId: v })} all="Anyone">
          {options.staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Filter>

        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              go({
                provider: null,
                type: null,
                status: null,
                stage: null,
                campaignId: null,
                pillarId: null,
                projectId: null,
                ownerId: null,
              })
            }
          >
            <RotateCcw size={13} aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  all,
  children,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  all: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </span>
      <Select
        className="w-40"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{all}</option>
        {children}
      </Select>
    </label>
  );
}
