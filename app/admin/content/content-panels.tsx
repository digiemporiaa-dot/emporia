"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Plus } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker } from "@/components/admin/media-picker";
import {
  CONTENT_CHANNEL_LABEL,
  CONTENT_STAGES,
  CONTENT_STAGE_LABEL,
} from "@/lib/projects/lifecycle";
import {
  saveContentItemAction,
  setContentStageAction,
  requestApprovalAction,
  type DeliveryActionState,
} from "../projects/actions";
import type { ContentChannel, ContentStage } from "@/generated/prisma/enums";

/** Content calendar controls. */

const CHANNELS = Object.keys(CONTENT_CHANNEL_LABEL) as ContentChannel[];

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
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function ContentFilters({
  projects,
  month,
}: {
  projects: readonly { id: string; label: string }[];
  month: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const push = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    router.push(`/admin/content?${next.toString()}`);
  };

  const selectClass =
    "h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3">
      <label className="sr-only" htmlFor="content-month">
        Month
      </label>
      <input
        id="content-month"
        type="month"
        value={month}
        onChange={(event) => push({ month: event.target.value })}
        className={selectClass}
      />

      <label className="sr-only" htmlFor="content-channel">
        Channel
      </label>
      <select
        id="content-channel"
        className={selectClass}
        value={searchParams.get("channel") ?? ""}
        onChange={(event) => push({ channel: event.target.value || undefined })}
      >
        <option value="">Every channel</option>
        {CHANNELS.map((channel) => (
          <option key={channel} value={channel}>
            {CONTENT_CHANNEL_LABEL[channel]}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="content-stage">
        Stage
      </label>
      <select
        id="content-stage"
        className={selectClass}
        value={searchParams.get("stage") ?? ""}
        onChange={(event) => push({ stage: event.target.value || undefined })}
      >
        <option value="">Every stage</option>
        {CONTENT_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {CONTENT_STAGE_LABEL[stage]}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="content-project">
        Project
      </label>
      <select
        id="content-project"
        className={selectClass}
        value={searchParams.get("projectId") ?? ""}
        onChange={(event) => push({ projectId: event.target.value || undefined })}
      >
        <option value="">Every project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="content-view">
        View
      </label>
      <select
        id="content-view"
        className={selectClass}
        value={searchParams.get("view") ?? "calendar"}
        onChange={(event) => push({ view: event.target.value })}
      >
        <option value="calendar">Calendar</option>
        <option value="board">Workflow board</option>
      </select>
    </div>
  );
}

export function ContentItemForm({
  projects,
  staff,
  item,
}: {
  projects: readonly { id: string; label: string }[];
  staff: readonly { id: string; name: string }[];
  item?: {
    id: string;
    projectId: string;
    channel: ContentChannel;
    title: string;
    brief: string | null;
    ownerId: string | null;
    scheduledFor: Date | null;
    media?: { id: string; url: string; filename: string; type: string } | null;
  };
}) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(
    saveContentItemAction,
    null,
  );
  const [open, setOpen] = React.useState(Boolean(item));

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" className="mr-1" />
        New item
      </Button>
    );
  }

  const scheduled = item?.scheduledFor
    ? new Date(item.scheduledFor.getTime() - item.scheduledFor.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line bg-white p-4" noValidate>
      {item ? <input type="hidden" name="id" value={item.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="content-item-projectId" label="Project" required>
          {(aria) => (
            <Select {...aria} name="projectId" defaultValue={item?.projectId ?? ""} required>
              <option value="">Choose a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="content-item-channel" label="Channel" required>
          {(aria) => (
            <Select {...aria} name="channel" defaultValue={item?.channel ?? "INSTAGRAM"} required>
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {CONTENT_CHANNEL_LABEL[channel]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field id="content-item-title" label="Title" required>
        {(aria) => <Input {...aria} name="title" defaultValue={item?.title} required />}
      </Field>

      <Field id="content-item-brief" label="Brief">
        {(aria) => <Textarea {...aria} name="brief" rows={3} defaultValue={item?.brief ?? ""} />}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="content-item-owner" label="Owner">
          {(aria) => (
            <Select {...aria} name="ownerId" defaultValue={item?.ownerId ?? ""}>
              <option value="">Unassigned</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="content-item-scheduledFor"
          label="Scheduled for"
          hint="Required before scheduling or publishing"
        >
          {(aria) => (
            <Input {...aria} name="scheduledFor" type="datetime-local" defaultValue={scheduled} />
          )}
        </Field>
      </div>

      <MediaPicker
        name="mediaId"
        label="Asset"
        accept="ANY"
        {...(item?.media ? { value: item.media } : {})}
        hint="What will be published"
      />

      {state && !state.ok ? <Problem message={state.message} /> : null}
      {state?.ok ? (
        <p role="status" className="text-xs text-success">
          Saved.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Submit label={item ? "Save item" : "Add item"} />
        {item ? null : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function StageControl({
  itemId,
  stage,
  canPublish,
}: {
  itemId: string;
  stage: ContentStage;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const move = (next: string) => {
    setError(null);
    start(async () => {
      const result = await setContentStageAction(itemId, next);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  const options = canPublish ? CONTENT_STAGES : CONTENT_STAGES.filter((s) => s !== "PUBLISHED");

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={`stage-${itemId}`}
        className="block text-2xs font-medium uppercase tracking-wide text-ink-subtle"
      >
        Stage
      </label>
      <Select
        id={`stage-${itemId}`}
        value={stage}
        disabled={pending}
        onChange={(event) => move(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {CONTENT_STAGE_LABEL[option]}
          </option>
        ))}
      </Select>
      <Problem message={error} />
    </div>
  );
}

export function RequestApprovalForm({ contentItemId }: { contentItemId: string }) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(
    requestApprovalAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-2.5" noValidate>
      <input type="hidden" name="contentItemId" value={contentItemId} />

      <Field id="approval-title" label="Approval" required>
        {(aria) => <Input {...aria} name="title" placeholder="What is being approved" required />}
      </Field>
      <Field id="approval-notes" label="Notes">
        {(aria) => <Textarea {...aria} name="notes" rows={2} />}
      </Field>

      <MediaPicker name="mediaId" label="Creative" accept="ANY" />

      {state && !state.ok ? <Problem message={state.message} /> : null}
      {state?.ok ? (
        <p role="status" className="text-xs text-success">
          Approval opened.
        </p>
      ) : null}

      <Submit label="Request approval" />
    </form>
  );
}
