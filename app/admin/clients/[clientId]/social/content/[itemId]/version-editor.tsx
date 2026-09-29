"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
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
import { AIDraft } from "@/components/admin/ai-draft";
import { useHydrated } from "@/lib/utils/hydrated";
import { X_LINK_LENGTH, textLength, type LengthRule } from "@/lib/social/text-length";
import type {
  ContentStage,
  SocialPostStatus,
  SocialPostType,
  SocialProvider,
} from "@/generated/prisma/enums";
import { POST_STATUS_LABEL, POST_STATUS_TONE, POST_TYPE_LABEL } from "@/lib/social/capabilities";
import {
  assistCopyAction,
  deletePostAction,
  publishNowAction,
  draftCaptionAction,
  savePostAction,
  setPostStatusAction,
} from "../actions";

/** What an assist sends back, less the model name the badge shows. */
type SocialAssistResult = {
  caption?: string;
  hashtags?: string[];
  callToAction?: string;
  ctaLine?: string;
  forbiddenUsed: string[];
  model: string;
};

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
  /** The last attempt may already be live; only the queue can resolve it. */
  ambiguous: boolean;
  /** Written by the AI and not yet saved by a person. */
  aiDraft: boolean;
  media: EditorMedia[];
  /** Publication attempts, newest first. Empty until something is tried. */
  attempts: EditorAttempt[];
};

export type EditorAttempt = {
  id: string;
  attempt: number;
  status: string;
  error: string | null;
  at: string | null;
  /** Who pressed it, or null for the scheduler. */
  by: string | null;
};

export type EditorProvider = {
  provider: SocialProvider;
  label: string;
  postTypes: string[];
  fields: string[];
  captionLimit: number | null;
  /** How the limit is counted, and whether the link rides in the text (X). */
  lengthRule: LengthRule;
  linkInText: boolean;
  carouselLimit: number | null;
  /** A fixed set of buttons, where the platform has one. Empty means free text. */
  callToActionOptions: { value: string; label: string }[];
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
  canPublish,
  aiReady,
}: {
  clientId: string;
  itemId: string;
  stage: ContentStage;
  posts: readonly EditorPost[];
  providers: readonly EditorProvider[];
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
  aiReady: boolean;
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

  /** Other saved versions with a caption — what "Create a LinkedIn version from…" can start from. */
  const siblingsOf = (id: string) =>
    posts
      .filter((other) => other.id !== id && other.id && other.caption.trim())
      .map((other) => ({
        id: other.id,
        label: providers.find((entry) => entry.provider === other.provider)?.label ?? other.provider,
      }));

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
                siblings={siblingsOf(post.id)}
                canEdit={canEdit}
                canDelete={canDelete}
                canPublish={canPublish}
                aiReady={aiReady}
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
          siblings={siblingsOf("")}
          canEdit
          canDelete={false}
          canPublish={false}
          aiReady={aiReady}
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
    ambiguous: false,
    aiDraft: false,
    media: [],
    attempts: [],
  };
}

const ATTEMPT_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function VersionCard({
  clientId,
  itemId,
  stage,
  post,
  provider,
  canEdit,
  canDelete,
  canPublish,
  aiReady,
  onDiscard,
  siblings,
}: {
  clientId: string;
  itemId: string;
  stage: ContentStage;
  post: EditorPost;
  provider: EditorProvider;
  siblings: { id: string; label: string }[];
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
  aiReady: boolean;
  onDiscard?: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const [draft, setDraft] = React.useState<
    { caption: string; headline: string | null; hashtags: string[]; forbiddenUsed: string[]; model: string } | null
  >(null);
  const [instruction, setInstruction] = React.useState("");
  const [basedOn, setBasedOn] = React.useState("");
  const [assist, setAssist] = React.useState<
    ({ mode: "improve" | "hashtags" | "cta" } & SocialAssistResult) | null
  >(null);

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
  // The engine refuses anything the client has not signed off, so the button
  // says so rather than offering a click that comes back as an error.
  const approved = stage === "APPROVED" || stage === "SCHEDULED" || stage === "PUBLISHED";
  const has = (field: string) => provider.fields.includes(field);

  const tags = hashtags
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#+/, "").trim())
    .filter(Boolean);

  // Counted exactly as saving counts it (`textLength`, shared with the
  // validation): the tags ride in the caption, and on X so does the link, at
  // X's weighting. A counter that disagreed with the save would be a lie.
  const used = textLength(
    [caption, ...tags.map((tag) => `#${tag}`), ...(provider.linkInText && linkUrl.trim() ? [linkUrl.trim()] : [])].join(
      " ",
    ),
    provider.lengthRule,
  );
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

  const askForDraft = () => {
    setError(null);
    start(async () => {
      const result = await draftCaptionAction({
        itemId,
        provider: provider.provider,
        type,
        instruction: instruction.trim() || null,
        fromPostId: basedOn || null,
      });
      if (result.ok) setDraft(result.data);
      else setError(result.message);
    });
  };

  const askForAssist = (mode: "improve" | "hashtags" | "cta") => {
    setError(null);
    start(async () => {
      const result = await assistCopyAction({
        itemId,
        provider: provider.provider,
        mode,
        text: caption,
        instruction: instruction.trim() || null,
      });
      if (result.ok) setAssist({ mode, ...result.data });
      else setError(result.message);
    });
  };

  /** Put a suggestion in the form. Still unsaved — the person presses save. */
  const applyAssist = () => {
    if (!assist) return;
    if (assist.caption) setCaption(assist.caption);
    if (assist.hashtags) setHashtags(assist.hashtags.join(" "));
    if (assist.callToAction) setCallToAction(assist.callToAction);
    if (assist.ctaLine) setCaption((current) => (current.trim() ? `${current.trimEnd()}\n\n${assist.ctaLine}` : assist.ctaLine!));
    setAssist(null);
  };

  /** Put the draft in the form. Still unsaved — the person presses save. */
  const applyDraft = () => {
    if (!draft) return;
    setCaption(draft.caption);
    if (draft.headline !== null) setHeadline(draft.headline);
    if (draft.hashtags.length > 0) setHashtags(draft.hashtags.join(" "));
    setDraft(null);
    setInstruction("");
  };

  const publish = () => {
    setError(null);
    start(async () => {
      const result = await publishNowAction({ clientId, postId: post.id });
      if (result.ok) {
        push({ tone: "success", title: `Posted to ${provider.label}.` });
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
            {post.aiDraft ? (
              <Badge tone="warning" title="Written by the AI. Check it and save it before it can go to the client.">
                AI draft — check and save
              </Badge>
            ) : null}
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

        {editable && aiReady ? (
          <div className="rounded-md border border-line bg-surface-muted px-3 py-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                  Draft with AI
                </span>
                <Input
                  value={instruction}
                  placeholder="Optional steer — shorter, warmer, lead with the workshop…"
                  onChange={(event) => setInstruction(event.target.value)}
                />
              </label>
              {siblings.length > 0 ? (
                <label>
                  <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                    Based on
                  </span>
                  <Select value={basedOn} onChange={(event) => setBasedOn(event.target.value)} className="w-48">
                    <option value="">The brief</option>
                    {siblings.map((sibling) => (
                      <option key={sibling.id} value={sibling.id}>
                        The {sibling.label} version
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <Button variant="secondary" disabled={pending} onClick={askForDraft}>
                <Sparkles size={14} aria-hidden="true" />
                {pending ? "Drafting…" : basedOn ? `Create ${provider.label} version` : "Draft"}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Or</span>
              <Button size="sm" variant="ghost" disabled={pending || !caption.trim()} onClick={() => askForAssist("improve")}>
                Improve caption
              </Button>
              {has("hashtags") ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => askForAssist("hashtags")}>
                  Suggest hashtags
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => askForAssist("cta")}>
                Suggest a call to action
              </Button>
            </div>
            <p className="mt-1.5 text-2xs text-ink-subtle">
              Written from this idea&rsquo;s brief and the client&rsquo;s brand profile. It will not
              invent figures, offers or results — if the brief has no numbers, the caption has none.
            </p>
          </div>
        ) : null}

        {assist ? (
          <AIDraft model={assist.model} onDismiss={() => setAssist(null)}>
            <div className="space-y-2">
              {assist.caption ? <p className="whitespace-pre-wrap text-sm text-ink">{assist.caption}</p> : null}
              {assist.hashtags ? (
                <p className="text-xs text-navy-700">{assist.hashtags.map((tag) => `#${tag}`).join(" ")}</p>
              ) : null}
              {assist.callToAction ? (
                <p className="text-sm text-ink">
                  Button:{" "}
                  {provider.callToActionOptions.find((option) => option.value === assist.callToAction)?.label ??
                    assist.callToAction}
                </p>
              ) : null}
              {assist.ctaLine ? (
                <p className="text-sm text-ink">
                  <span className="text-2xs uppercase tracking-wide text-ink-subtle">Added to the caption: </span>
                  {assist.ctaLine}
                </p>
              ) : null}
              {assist.forbiddenUsed.length > 0 ? (
                <p role="alert" className="rounded-md border border-red-100 bg-red-50 px-2.5 py-2 text-xs text-brand-red-text">
                  Uses words on this client&apos;s forbidden list: {assist.forbiddenUsed.join(", ")}.
                </p>
              ) : null}
              <Button size="sm" onClick={applyAssist}>
                Use this
              </Button>
            </div>
          </AIDraft>
        ) : null}

        {draft ? (
          <AIDraft model={draft.model} onDismiss={() => setDraft(null)}>
            <div className="space-y-2">
              {draft.headline ? (
                <p className="text-sm font-medium text-navy-800">{draft.headline}</p>
              ) : null}
              <p className="whitespace-pre-wrap text-sm text-ink">{draft.caption}</p>
              {draft.hashtags.length > 0 ? (
                <p className="text-xs text-navy-700">
                  {draft.hashtags.map((tag) => `#${tag}`).join(" ")}
                </p>
              ) : null}
              {draft.forbiddenUsed.length > 0 ? (
                // Shown, not silently edited: the operator decides the rewrite.
                <p role="alert" className="rounded-md border border-red-100 bg-red-50 px-2.5 py-2 text-xs text-brand-red-text">
                  Uses words on this client&apos;s forbidden list: {draft.forbiddenUsed.join(", ")}. Rewrite
                  before saving.
                </p>
              ) : null}
              <p className="text-2xs text-ink-subtle">
                {draft.caption.length} of {provider.captionLimit ?? "—"} characters
              </p>
              <Button size="sm" onClick={applyDraft}>
                Put it in the form
              </Button>
            </div>
          </AIDraft>
        ) : null}

        {post.attempts.length > 0 ? (
          <details className="rounded-md border border-line bg-surface-muted px-3 py-2">
            <summary className="cursor-pointer text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              {post.attempts.length} publication attempt
              {post.attempts.length === 1 ? "" : "s"}
            </summary>
            <ol className="mt-2 space-y-1.5">
              {post.attempts.map((attempt) => (
                <li key={attempt.id} className="text-2xs text-ink-muted">
                  <span className="tabular-nums">#{attempt.attempt}</span>{" "}
                  <span className="font-medium">{attempt.status.toLowerCase()}</span>
                  {attempt.by ? ` · ${attempt.by}` : " · scheduler"}
                  {attempt.at ? ` · ${ATTEMPT_TIME.format(new Date(attempt.at))}` : null}
                  {attempt.error ? (
                    <span className="block text-brand-red-text">{attempt.error}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}

        {post.ambiguous ? (
          <p className="rounded-md border border-brand-red/30 bg-brand-red/5 px-3.5 py-3 text-xs text-brand-red-text">
            The last attempt may already be live on {provider.label}. Nothing will send it again
            until someone checks the account and records what happened in the{" "}
            <Link href="/admin/social/queue" className="underline underline-offset-2">
              publishing queue
            </Link>
            .
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
                      {used} / {provider.captionLimit}{" "}
                      {provider.lengthRule === "x-weighted"
                        ? `counted X's way: hashtags and the link (as ${X_LINK_LENGTH}) included, emoji twice`
                        : "including hashtags"}
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
            {(aria) =>
              provider.callToActionOptions.length > 0 ? (
                // The platform's own buttons, not free text it would refuse.
                <Select
                  {...aria}
                  value={callToAction}
                  disabled={!editable}
                  onChange={(event) => setCallToAction(event.target.value)}
                >
                  <option value="">No button</option>
                  {provider.callToActionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  {...aria}
                  value={callToAction}
                  disabled={!editable}
                  onChange={(event) => setCallToAction(event.target.value)}
                />
              )
            }
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

            {/* Publishing early and retrying a failure are the same act, so
                they are the same button with the honest label for each. */}
            {post.id && canPublish && !post.ambiguous && (post.status === "SCHEDULED" || post.status === "FAILED") ? (
              <Button
                variant="secondary"
                disabled={pending || !approved || !accountId}
                onClick={() => setConfirmPublish(true)}
                title={
                  !accountId
                    ? "Connect an account for this platform first."
                    : approved
                      ? undefined
                      : "The client has not approved this yet."
                }
              >
                <Send size={14} aria-hidden="true" />
                {post.status === "FAILED" ? "Try again" : "Publish now"}
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

      {confirmPublish ? (
        <Dialog
          open
          onClose={() => setConfirmPublish(false)}
          title={`Post to ${provider.label} now?`}
          description="This goes out immediately and cannot be taken back from here."
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmPublish(false)}>
              Not yet
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setConfirmPublish(false);
                publish();
              }}
            >
              {pending ? "Posting…" : "Post it"}
            </Button>
          </div>
        </Dialog>
      ) : null}

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
