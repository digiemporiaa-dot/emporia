"use client";

import * as React from "react";
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
import type { ContentStage, SocialPostStatus, SocialProvider } from "@/generated/prisma/enums";
import { createContentAction } from "./actions";

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
  accountName: string | null;
  thumbnailUrl: string | null;
  mediaCount: number;
};

export type ContentItemRow = {
  id: string;
  title: string;
  stage: ContentStage;
  campaign: string | null;
  project: string;
  owner: string | null;
  scheduledFor: string | null;
  approvalStatus: string | null;
  versions: VersionRow[];
};

const STAGE_LABEL: Record<ContentStage, string> = {
  IDEA: "Idea",
  DRAFT: "Draft",
  INTERNAL_REVIEW: "Internal review",
  CLIENT_REVIEW: "Client review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
};

const STAGE_TONE: Record<ContentStage, "neutral" | "navy" | "warning" | "success"> = {
  IDEA: "neutral",
  DRAFT: "neutral",
  INTERNAL_REVIEW: "navy",
  CLIENT_REVIEW: "warning",
  APPROVED: "success",
  SCHEDULED: "navy",
  PUBLISHED: "success",
};

export const STATUS_TONE: Record<SocialPostStatus, "neutral" | "navy" | "warning" | "success" | "red"> =
  {
    DRAFT: "neutral",
    SCHEDULED: "navy",
    PUBLISHING: "warning",
    PUBLISHED: "success",
    FAILED: "red",
    CANCELLED: "neutral",
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
  projects,
  staff,
  activeCampaign,
  search,
  canCreate,
}: {
  clientId: string;
  items: readonly ContentItemRow[];
  campaigns: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string; code: string }[];
  staff: readonly { id: string; name: string }[];
  activeCampaign: string | null;
  search: string | null;
  canCreate: boolean;
}) {
  const ready = useHydrated();
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);

  const base = `/admin/clients/${clientId}/social/content`;

  const filter = (next: { campaign?: string | null; q?: string | null }) => {
    const query = new URLSearchParams();
    const campaign = next.campaign === undefined ? activeCampaign : next.campaign;
    const q = next.q === undefined ? search : next.q;
    if (campaign) query.set("campaign", campaign);
    if (q) query.set("q", q);
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
        </div>

        {canCreate ? (
          <Button size="sm" disabled={!ready} onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            New content
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-12 text-center text-sm text-ink-subtle">
          {activeCampaign || search
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
                        {[item.campaign, item.project, item.owner, when(item.scheduledFor)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Badge tone={STAGE_TONE[item.stage]}>{STAGE_LABEL[item.stage]}</Badge>
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
                              <Badge tone={STATUS_TONE[version.status]}>
                                {version.status.toLowerCase()}
                              </Badge>
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
  staff,
  onClose,
}: {
  clientId: string;
  projects: readonly { id: string; name: string; code: string }[];
  campaigns: readonly { id: string; name: string }[];
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
