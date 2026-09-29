"use client";

import * as React from "react";
import { CONTENT_STAGE_LABEL, CONTENT_STAGE_TONE } from "@/lib/projects/lifecycle";
import { POST_STATUS_TONE } from "@/lib/social/capabilities";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ExternalLink, Image as ImageIcon, Plus, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import type { ActionResult } from "@/lib/errors";
import type { ContentStage, InternalReviewStatus, SocialPostStatus, SocialProvider } from "@/generated/prisma/enums";
import { createContentAction } from "./actions";
import { BulkBar } from "./bulk-bar";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE } from "./[itemId]/review-panel";

export type VersionRow = {
  id: string;
  provider: SocialProvider;
  providerLabel: string;
  type: string;
  status: SocialPostStatus;
  caption: string | null;
  scheduledFor: string | null;
  externalUrl: string | null;
  lastError: string | null;
  /** Written by the AI and not yet saved by a person. */
  aiDraft: boolean;
  accountName: string | null;
  thumbnailUrl: string | null;
  mediaCount: number;
};

export type ContentItemRow = {
  id: string;
  title: string;
  stage: ContentStage;
  campaign: string | null;
  pillar: string | null;
  project: string;
  owner: string | null;
  scheduledFor: string | null;
  approvalStatus: string | null;
  /** The latest internal review round, when there has been one. */
  reviewStatus: InternalReviewStatus | null;
  versions: VersionRow[];
};

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function when(iso: string | null): string {
  return iso ? DATE.format(new Date(iso)) : "Not scheduled";
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create"}
    </Button>
  );
}

export function ContentList({
  clientId,
  items,
  campaigns,
  pillars,
  projects,
  staff,
  activeCampaign,
  activePillar,
  search,
  reviewPending,
  canCreate,
  permissions,
  aiTools,
}: {
  clientId: string;
  items: readonly ContentItemRow[];
  campaigns: readonly { id: string; name: string }[];
  pillars: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string; code: string }[];
  staff: readonly { id: string; name: string }[];
  activeCampaign: string | null;
  activePillar: string | null;
  search: string | null;
  /** Only ideas waiting for internal review. */
  reviewPending: boolean;
  canCreate: boolean;
  /** What the bulk actions may offer this person. */
  permissions: { review: boolean; send: boolean; edit: boolean; delete: boolean };
  /** The AI assists, when AI is configured and the user may use it. */
  aiTools?: React.ReactNode;
}) {
  const ready = useHydrated();
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const bulk = permissions.review || permissions.send || permissions.edit || permissions.delete;
  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]));
  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id));

  const base = `/admin/clients/${clientId}/social/content`;

  const filter = (next: { campaign?: string | null; pillar?: string | null; q?: string | null; review?: boolean }) => {
    const query = new URLSearchParams();
    const campaign = next.campaign === undefined ? activeCampaign : next.campaign;
    const pillar = next.pillar === undefined ? activePillar : next.pillar;
    const q = next.q === undefined ? search : next.q;
    const review = next.review === undefined ? reviewPending : next.review;
    if (campaign) query.set("campaign", campaign);
    if (pillar) query.set("pillar", pillar);
    if (q) query.set("q", q);
    if (review) query.set("review", "pending");
    setSelected([]);
    const suffix = query.toString();
    router.push((suffix ? `${base}?${suffix}` : base) as Route);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Campaign
            </span>
            <Select
              className="w-52"
              value={activeCampaign ?? ""}
              onChange={(event) => filter({ campaign: event.target.value || null })}
            >
              <option value="">Every campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </Select>
          </label>

          {pillars.length > 0 ? (
            <label className="block">
              <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                Pillar
              </span>
              <Select
                className="w-52"
                value={activePillar ?? ""}
                onChange={(event) => filter({ pillar: event.target.value || null })}
              >
                <option value="">Every pillar</option>
                {pillars.map((pillar) => (
                  <option key={pillar.id} value={pillar.id}>
                    {pillar.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Search
            </span>
            <Input
              className="w-52"
              defaultValue={search ?? ""}
              placeholder="Title"
              onKeyDown={(event) => {
                if (event.key === "Enter") filter({ q: event.currentTarget.value || null });
              }}
            />
          </label>

          <label className="flex h-10 items-center gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              className="size-4 accent-brand-red"
              checked={reviewPending}
              onChange={(event) => filter({ review: event.target.checked })}
            />
            Waiting for internal review
          </label>
        </div>

        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            {aiTools}
            <Button size="sm" disabled={!ready} onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" />
              New content
            </Button>
          </div>
        ) : null}
      </div>

      {bulk && items.length > 0 ? (
        selected.length > 0 ? (
          <BulkBar
            clientId={clientId}
            selected={selected}
            staff={staff}
            permissions={permissions}
            onClear={() => setSelected([])}
          />
        ) : (
          <label className="flex items-center gap-2 text-xs text-ink-subtle">
            <input
              type="checkbox"
              className="size-4 accent-brand-red"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : items.map((item) => item.id))}
            />
            Select all {items.length} for a bulk action
          </label>
        )
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-12 text-center text-sm text-ink-subtle">
          {reviewPending
            ? "Nothing is waiting for internal review."
            : activeCampaign || search
              ? "Nothing matches those filters."
              : "No social content yet. Start an idea, then write a version for each platform."}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {bulk ? (
                        <input
                          type="checkbox"
                          className="mt-1 size-4 shrink-0 accent-brand-red"
                          aria-label={`Select ${item.title}`}
                          checked={selected.includes(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                      ) : null}
                      <div className="min-w-0">
                        <CardTitle>
                          <Link
                            href={`${base}/${item.id}` as Route}
                            className="hover:text-brand-red"
                          >
                            {item.title}
                          </Link>
                        </CardTitle>
                        <p className="mt-1 text-xs text-ink-subtle">
                          {[item.campaign, item.pillar, item.project, item.owner, when(item.scheduledFor)]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.reviewStatus && item.reviewStatus !== "WITHDRAWN" && ["IDEA", "DRAFT", "INTERNAL_REVIEW"].includes(item.stage) ? (
                        <Badge tone={REVIEW_STATUS_TONE[item.reviewStatus]}>
                          {REVIEW_STATUS_LABEL[item.reviewStatus]}
                        </Badge>
                      ) : null}
                      <Badge tone={CONTENT_STAGE_TONE[item.stage]}>{CONTENT_STAGE_LABEL[item.stage]}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardBody>
                  {item.versions.length === 0 ? (
                    <p className="text-xs text-ink-subtle">
                      No platform versions yet.{" "}
                      <Link href={`${base}/${item.id}` as Route} className="text-brand-red underline underline-offset-4">
                        Write one
                      </Link>
                      .
                    </p>
                  ) : (
                    <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {item.versions.map((version) => (
                        <li
                          key={version.id}
                          className="flex gap-3 rounded-md border border-line px-3 py-2.5"
                        >
                          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-surface-sunken">
                            {version.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- an R2 URL for an arbitrary creative; next/image would need a remote pattern per bucket
                              <img
                                src={version.thumbnailUrl}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              <ImageIcon size={15} aria-hidden="true" className="text-ink-subtle" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-medium text-navy-800">
                                {version.providerLabel}
                              </span>
                              <Badge tone={POST_STATUS_TONE[version.status]}>
                                {version.status.toLowerCase()}
                              </Badge>
                              {version.aiDraft ? <Badge tone="warning">AI draft</Badge> : null}
                              {version.externalUrl ? (
                                <a
                                  href={version.externalUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="text-ink-subtle hover:text-brand-red"
                                  aria-label={`Open the ${version.providerLabel} post`}
                                >
                                  <ExternalLink size={12} aria-hidden="true" />
                                </a>
                              ) : null}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-2xs text-ink-muted">
                              {version.caption ?? "No caption yet."}
                            </p>
                            {version.lastError ? (
                              <p className="mt-1 flex items-start gap-1 text-2xs text-brand-red-text">
                                <TriangleAlert size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                                {version.lastError}
                              </p>
                            ) : (
                              <p className="mt-0.5 text-2xs text-ink-subtle">
                                {version.accountName ?? "No account chosen"} ·{" "}
                                {when(version.scheduledFor)}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CreateDialog
          clientId={clientId}
          projects={projects}
          campaigns={campaigns}
          pillars={pillars}
          staff={staff}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function CreateDialog({
  clientId,
  projects,
  campaigns,
  pillars,
  staff,
  onClose,
}: {
  clientId: string;
  projects: readonly { id: string; name: string; code: string }[];
  campaigns: readonly { id: string; name: string }[];
  pillars: readonly { id: string; name: string }[];
  staff: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    createContentAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) {
      onClose();
      router.refresh();
    }
  }, [state, onClose, router]);

  return (
    <Dialog
      open
      onClose={onClose}
      title="New social content"
      description="One idea. Its platform versions come next."
    >
      {projects.length === 0 ? (
        <p className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted">
          This client has no active project. Content hangs off a project, so create one first.
        </p>
      ) : (
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="clientId" value={clientId} />

          {state && !state.ok ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
            >
              <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{state.message}</span>
            </p>
          ) : null}

          <Field id="title" label="Title" required>
            {(aria) => <Input {...aria} name="title" placeholder="Diwali business growth post" />}
          </Field>

          <Field id="brief" label="Brief" hint="What this is for. The platform versions are written from it.">
            {(aria) => <Textarea {...aria} name="brief" rows={3} />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="projectId" label="Project" required>
              {(aria) => (
                <Select {...aria} name="projectId">
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.code} — {project.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="campaignId" label="Campaign">
              {(aria) => (
                <Select {...aria} name="campaignId">
                  <option value="">No campaign</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {pillars.length > 0 ? (
              <Field id="pillarId" label="Content pillar">
                {(aria) => (
                  <Select {...aria} name="pillarId">
                    <option value="">No pillar</option>
                    {pillars.map((pillar) => (
                      <option key={pillar.id} value={pillar.id}>
                        {pillar.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            <Field id="ownerId" label="Owner">
              {(aria) => (
                <Select {...aria} name="ownerId">
                  <option value="">Unassigned</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="scheduledFor" label="Target date" hint="When the idea is meant to go out.">
              {(aria) => <Input {...aria} name="scheduledFor" type="datetime-local" />}
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit />
          </div>
        </form>
      )}
    </Dialog>
  );
}
