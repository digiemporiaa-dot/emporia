"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, Trash2, X } from "lucide-react";
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
  useToast,
} from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import { useHydrated } from "@/lib/utils/hydrated";
import type {
  ContentStage,
  SocialPostStatus,
  SocialPostType,
  SocialProvider,
} from "@/generated/prisma/enums";
import { POST_STATUS_LABEL, POST_STATUS_TONE, POST_TYPE_LABEL } from "@/lib/social/capabilities";
import { deletePostAction, savePostAction, setPostStatusAction } from "../actions";

/**
 * The platform version editor.
 *
 * The rule the whole screen follows: **only offer what the platform accepts.**
 * The capability table arrives from the server and decides which fields render,
 * which formats the type picker lists, and what the caption counter counts
 * down from. There is no `provider === "INSTAGRAM"` branch anywhere in here —
 * add a platform to the table and this editor supports it.
 *
 * Hashtags count towards the caption limit because that is how the platforms
 * count them, so the counter does too. An editor should not discover at 7:30pm
 * that a caption which looked fine does not fit.
 */

export type EditorMedia = PickedMedia;

export type EditorPost = {
  id: string;
  provider: SocialProvider;
  type: string;
  status: SocialPostStatus;
  accountId: string | null;
  caption: string;
  headline: string;
  hashtags: readonly string[];
  mentions: readonly string[];
  callToAction: string;
  firstComment: string;
  linkUrl: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  lastError: string | null;
  media: EditorMedia[];
};

export type EditorProvider = {
  provider: SocialProvider;
  label: string;
  postTypes: string[];
  fields: string[];
  captionLimit: number | null;
  carouselLimit: number | null;
  accounts: { id: string; name: string; status: string }[];
};

/** Locked once it has gone out: the copy is the record of what was published. */
const LOCKED: readonly SocialPostStatus[] = ["PUBLISHING", "PUBLISHED"];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function VersionEditor({
  clientId,
  itemId,
  stage,
  posts,
  providers,
  canEdit,
  canDelete,
}: {
  clientId: string;
  itemId: string;
  stage: ContentStage;
  posts: readonly EditorPost[];
  providers: readonly EditorProvider[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const ready = useHydrated();
  const [adding, setAdding] = React.useState(false);
  /**
   * The version being written, which has no row yet.
   *
   * Held here rather than created on the server the moment somebody picks a
   * platform: a half-written Instagram caption should not be a database row
   * that someone has to clean up. It becomes one on its first save.
   */
  const [draft, setDraft] = React.useState<{ provider: SocialProvider; type: string } | null>(null);

  const draftProvider = draft
    ? (providers.find((entry) => entry.provider === draft.provider) ?? null)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy-800">
          Platform versions{posts.length > 0 ? ` (${posts.length})` : ""}
        </h3>
        {canEdit ? (
          <Button size="sm" disabled={!ready} onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden="true" />
            Add a version
          </Button>
        ) : null}
      </div>

      {posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-12 text-center text-sm text-ink-subtle">
          No versions yet. Add one per platform — each gets its own copy.
        </p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => {
            const provider = providers.find((entry) => entry.provider === post.provider);
            if (!provider) return null;
            return (
              <VersionCard
                key={post.id}
                clientId={clientId}
                itemId={itemId}
                stage={stage}
                post={post}
                provider={provider}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            );
          })}
        </div>
      )}

      {draftProvider ? (
        <VersionCard
          key={`draft-${draftProvider.provider}`}
          clientId={clientId}
          itemId={itemId}
          stage="DRAFT"
          post={emptyPost(draftProvider, draft?.type ?? "TEXT")}
          provider={draftProvider}
          canEdit
          canDelete={false}
          onDiscard={() => setDraft(null)}
        />
      ) : null}

      {adding ? (
        <AddVersionDialog
          providers={providers}
          onClose={() => setAdding(false)}
          onPick={(provider, type) => {
            setAdding(false);
            setDraft({ provider, type });
          }}
        />
      ) : null}
    </div>
  );
}

/** A version that exists only in the form, until its first save. */
function emptyPost(provider: EditorProvider, type: string): EditorPost {
  return {
    id: "",
    provider: provider.provider,
    type,
    status: "DRAFT",
    accountId: provider.accounts[0]?.id ?? null,
    caption: "",
    headline: "",
    hashtags: [],
    mentions: [],
    callToAction: "",
    firstComment: "",
    linkUrl: "",
    scheduledFor: null,
    publishedAt: null,
    externalUrl: null,
    lastError: null,
    media: [],
  };
}

function VersionCard({
  clientId,
  itemId,
  stage,
  post,
  provider,
  canEdit,
  canDelete,
  onDiscard,
}: {
  clientId: string;
  itemId: string;
  stage: ContentStage;
  post: EditorPost;
  provider: EditorProvider;
  canEdit: boolean;
  canDelete: boolean;
  onDiscard?: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const [type, setType] = React.useState(post.type);
  const [accountId, setAccountId] = React.useState(post.accountId ?? "");
  const [caption, setCaption] = React.useState(post.caption);
  const [headline, setHeadline] = React.useState(post.headline);
  const [hashtags, setHashtags] = React.useState(post.hashtags.join(" "));
  const [callToAction, setCallToAction] = React.useState(post.callToAction);
  const [firstComment, setFirstComment] = React.useState(post.firstComment);
  const [linkUrl, setLinkUrl] = React.useState(post.linkUrl);
  const [scheduledFor, setScheduledFor] = React.useState(toLocalInput(post.scheduledFor));
  const [media, setMedia] = React.useState<EditorMedia[]>(post.media);

  const locked = LOCKED.includes(post.status);
  const editable = canEdit && !locked;
  const has = (field: string) => provider.fields.includes(field);

  const tags = hashtags
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#+/, "").trim())
    .filter(Boolean);

  // Counted exactly as the platform counts it: the tags ride in the caption.
  const used = caption.length + tags.reduce((sum, tag) => sum + tag.length + 2, 0);
  const overLimit = provider.captionLimit !== null && used > provider.captionLimit;

  const carouselOver =
    type === "CAROUSEL" && provider.carouselLimit !== null && media.length > provider.carouselLimit;

  const save = () => {
    setError(null);
    start(async () => {
      const result = await savePostAction({
        clientId,
        postId: post.id || null,
        post: {
          contentItemId: itemId,
          accountId: accountId || null,
          provider: provider.provider,
          type,
          caption: caption || "",
          headline: has("headline") ? headline : "",
          hashtags: tags,
          mentions: [],
          callToAction: has("callToAction") ? callToAction : "",
          firstComment: has("firstComment") ? firstComment : "",
          linkUrl: has("linkUrl") ? linkUrl : "",
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
          mediaIds: media.map((entry) => entry.id),
        },
      });

      if (result.ok) {
        push({ tone: "success", title: `${provider.label} version saved.` });
        onDiscard?.();
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  const schedule = (status: "SCHEDULED" | "DRAFT") => {
    setError(null);
    start(async () => {
      const result = await setPostStatusAction({ clientId, postId: post.id, status });
      if (result.ok) {
        push({ tone: "success", title: status === "SCHEDULED" ? "Scheduled." : "Back to draft." });
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  const remove = () => {
    start(async () => {
      const result = await deletePostAction({ clientId, postId: post.id });
      setConfirmDelete(false);
      if (result.ok) {
        push({ tone: "success", title: "Version removed." });
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {provider.label}
            {post.id ? "" : " — new"}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={POST_STATUS_TONE[post.status]}>{POST_STATUS_LABEL[post.status]}</Badge>
            {post.externalUrl ? (
              <a
                href={post.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs text-brand-red underline underline-offset-4"
              >
                View the live post
              </a>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {locked ? (
          <p className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-xs text-ink-muted">
            This version has gone out. Its copy is the record of what was published, so it can no
            longer be edited.
          </p>
        ) : null}

        {post.lastError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{post.lastError}</span>
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${post.id}-type`} label="Format">
            {(aria) => (
              <Select
                {...aria}
                value={type}
                disabled={!editable}
                onChange={(event) => setType(event.target.value)}
              >
                {/* Only the formats this platform's publishing API accepts. */}
                {provider.postTypes.map((option) => (
                  <option key={option} value={option}>
                    {POST_TYPE_LABEL[option as SocialPostType] ?? option}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            id={`${post.id}-account`}
            label="Post from"
            hint={
              provider.accounts.length === 0
                ? `No ${provider.label} account is connected for this client.`
                : undefined
            }
          >
            {(aria) => (
              <Select
                {...aria}
                value={accountId}
                disabled={!editable || provider.accounts.length === 0}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="">Choose an account</option>
                {provider.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.status === "NEEDS_RECONNECT" ? " (needs reconnecting)" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {has("headline") ? (
          <Field id={`${post.id}-headline`} label="Title">
            {(aria) => (
              <Input
                {...aria}
                value={headline}
                disabled={!editable}
                onChange={(event) => setHeadline(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        {has("caption") ? (
          <Field id={`${post.id}-caption`} label="Caption">
            {(aria) => (
              <>
                <Textarea
                  {...aria}
                  rows={5}
                  value={caption}
                  disabled={!editable}
                  onChange={(event) => setCaption(event.target.value)}
                />
                {provider.captionLimit !== null ? (
                  <p className="mt-1 text-2xs">
                    <span className={overLimit ? "text-brand-red-text" : "text-ink-subtle"}>
                      {used} / {provider.captionLimit} including hashtags
                    </span>
                  </p>
                ) : null}
              </>
            )}
          </Field>
        ) : null}

        {has("hashtags") ? (
          <Field
            id={`${post.id}-hashtags`}
            label="Hashtags"
            hint="Separated by spaces. The hash is optional."
          >
            {(aria) => (
              <Input
                {...aria}
                value={hashtags}
                disabled={!editable}
                onChange={(event) => setHashtags(event.target.value)}
                placeholder="#diwali #offers"
              />
            )}
          </Field>
        ) : null}

        {has("callToAction") ? (
          <Field id={`${post.id}-cta`} label="Call to action">
            {(aria) => (
              <Input
                {...aria}
                value={callToAction}
                disabled={!editable}
                onChange={(event) => setCallToAction(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        {has("linkUrl") ? (
          <Field id={`${post.id}-link`} label="Link">
            {(aria) => (
              <Input
                {...aria}
                type="url"
                value={linkUrl}
                disabled={!editable}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://"
              />
            )}
          </Field>
        ) : null}

        {has("firstComment") ? (
          <Field
            id={`${post.id}-firstComment`}
            label="First comment"
            hint="Posted straight after, where the platform supports it."
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={2}
                value={firstComment}
                disabled={!editable}
                onChange={(event) => setFirstComment(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        <div>
          <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Creative
            {provider.carouselLimit !== null && type === "CAROUSEL"
              ? ` (up to ${provider.carouselLimit})`
              : ""}
          </span>
          {media.length > 0 ? (
            <ul className="mb-2 flex flex-wrap gap-2">
              {media.map((entry, index) => (
                <li key={`${entry.id}-${index}`} className="relative">
                  <span className="block size-16 overflow-hidden rounded-sm border border-line bg-surface-sunken">
                    {/* eslint-disable-next-line @next/next/no-img-element -- an R2 URL for an arbitrary creative */}
                    <img src={entry.url} alt="" className="size-full object-cover" />
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      aria-label={`Remove creative ${index + 1}`}
                      onClick={() => setMedia((list) => list.filter((_, at) => at !== index))}
                      className="absolute -right-1.5 -top-1.5 rounded-full border border-line bg-white p-0.5 text-ink-muted hover:text-brand-red"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {editable ? (
            <MediaPicker
              name={`${post.id}-media`}
              label="Add a creative"
              accept="ANY"
              onChange={(picked) => {
                if (picked) setMedia((list) => [...list, picked]);
              }}
            />
          ) : null}
          {carouselOver ? (
            <p className="mt-1 text-2xs text-brand-red-text">
              {provider.label} takes at most {provider.carouselLimit} in a carousel.
            </p>
          ) : null}
        </div>

        <Field
          id={`${post.id}-scheduledFor`}
          label="Go out at"
          hint="Your own clock. Stored and published in UTC."
        >
          {(aria) => (
            <Input
              {...aria}
              type="datetime-local"
              value={scheduledFor}
              disabled={!editable}
              onChange={(event) => setScheduledFor(event.target.value)}
            />
          )}
        </Field>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button disabled={pending || overLimit || carouselOver} onClick={save}>
              {pending ? "Saving…" : "Save version"}
            </Button>

            {post.id && post.status === "DRAFT" ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => schedule("SCHEDULED")}
                title={
                  stage === "APPROVED" || stage === "SCHEDULED"
                    ? undefined
                    : "The client has not approved this yet."
                }
              >
                Schedule
              </Button>
            ) : null}
            {post.id && post.status === "SCHEDULED" ? (
              <Button variant="secondary" disabled={pending} onClick={() => schedule("DRAFT")}>
                Unschedule
              </Button>
            ) : null}

            {onDiscard ? (
              <Button variant="ghost" disabled={pending} onClick={onDiscard}>
                Discard
              </Button>
            ) : null}

            {post.id && canDelete ? (
              <Button
                variant="danger"
                className="ml-auto"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} aria-hidden="true" />
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardBody>

      {confirmDelete ? (
        <Dialog
          open
          onClose={() => setConfirmDelete(false)}
          title={`Remove the ${provider.label} version?`}
          description="The idea and its other versions are kept."
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={pending} onClick={remove}>
              Remove
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function AddVersionDialog({
  providers,
  onClose,
  onPick,
}: {
  providers: readonly EditorProvider[];
  onClose: () => void;
  onPick: (provider: SocialProvider, type: string) => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a platform version"
      description="Each version has its own copy, format and schedule."
    >
      <ul className="space-y-2">
        {providers.map((provider) => (
          <li key={provider.provider}>
            <button
              type="button"
              onClick={() => onPick(provider.provider, provider.postTypes[0] ?? "TEXT")}
              className="w-full rounded-md border border-line px-3.5 py-3 text-left hover:border-brand-red hover:bg-red-50/40"
            >
              <span className="block text-sm font-medium text-navy-800">{provider.label}</span>
              <span className="mt-0.5 block text-xs text-ink-subtle">
                {provider.accounts.length === 0
                  ? "No account connected — you can still write the copy"
                  : `${provider.accounts.length} account${provider.accounts.length === 1 ? "" : "s"} connected`}
                {" · "}
                {provider.postTypes.length} formats
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
