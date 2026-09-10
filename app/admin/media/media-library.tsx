"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Check,
  Copy,
  Crosshair,
  FileText,
  Film,
  Folder,
  FolderPlus,
  Link2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Uploader } from "./uploader";
import {
  createFolderAction,
  deleteFolderAction,
  deleteMediaAction,
  mediaUsageAction,
  updateMediaAction,
  type MediaActionState,
} from "./actions";
import type { MediaUsage } from "@/lib/services/media-usage.service";
import type { MediaType } from "@/generated/prisma/enums";

/** The media library: folders, a grid, and a detail panel. */

export type LibraryItem = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  type: MediaType;
  size: number;
  alt: string | null;
  title: string | null;
  caption: string | null;
  description: string | null;
  /** Focal point, whole percentages. Null means centre. */
  focalX: number | null;
  focalY: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  folder: { id: string; name: string } | null;
  uploadedBy: { id: string; name: string } | null;
  tags: { name: string; slug: string }[];
  versions: number;
};

export type LibraryFolder = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  count: number;
};

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Thumb({ item, className = "" }: { item: LibraryItem; className?: string }) {
  if (item.type === "IMAGE") {
    return (
      // Deliberately a plain img: these are arbitrary user uploads on a
      // third-party origin, and next/image would proxy and re-encode them.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.url}
        alt={item.alt ?? ""}
        loading="lazy"
        className={`h-full w-full object-contain ${className}`}
      />
    );
  }

  const Icon = item.type === "VIDEO" ? Film : FileText;
  return (
    <div className={`flex h-full w-full items-center justify-center ${className}`}>
      <Icon size={28} aria-hidden="true" className="text-ink-subtle" />
    </div>
  );
}

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

export function MediaLibrary({
  items,
  folders,
  total,
  page,
  pages,
  canUpload,
  canEdit,
  canDelete,
  storageConfigured,
}: {
  items: LibraryItem[];
  folders: LibraryFolder[];
  total: number;
  page: number;
  pages: number;
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
  storageConfigured: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = React.useState<LibraryItem | null>(null);
  const [search, setSearch] = React.useState(searchParams.get("search") ?? "");
  const [newFolder, setNewFolder] = React.useState(false);

  const activeFolder = searchParams.get("folderId");
  const activeTag = searchParams.get("tag");
  const unusedOnly = searchParams.get("unused") === "1";

  const push = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    router.push(`/admin/media?${next.toString()}`);
  };

  React.useEffect(() => {
    // Keep the panel in step with fresh server data after an edit.
    if (!selected) return;
    const fresh = items.find((item) => item.id === selected.id);
    setSelected(fresh ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selected is the subject, not a dependency
  }, [items]);

  return (
    <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside>
        <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Folders
        </h2>
        <ul className="mt-2 space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => push({ folderId: undefined })}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                activeFolder ? "text-navy-700 hover:bg-navy-50" : "bg-navy-800 text-white"
              }`}
            >
              <Folder size={14} aria-hidden="true" />
              Everything
              <span className="ml-auto text-2xs tabular-nums opacity-70">{total}</span>
            </button>
          </li>
          {folders.map((folder) => (
            <li key={folder.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => push({ folderId: folder.id })}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  activeFolder === folder.id
                    ? "bg-navy-800 text-white"
                    : "text-navy-700 hover:bg-navy-50"
                }`}
              >
                <Folder size={14} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{folder.name}</span>
                <span className="ml-auto text-2xs tabular-nums opacity-70">{folder.count}</span>
              </button>
              {canDelete ? (
                <button
                  type="button"
                  onClick={async () => {
                    const result = await deleteFolderAction(folder.id);
                    if (!result.ok) window.alert(result.message);
                    else router.refresh();
                  }}
                  className="rounded-sm p-1 text-ink-subtle opacity-0 transition-opacity hover:text-brand-red group-hover:opacity-100"
                >
                  <Trash2 size={12} aria-hidden="true" />
                  <span className="sr-only">Delete the folder {folder.name}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        {canEdit ? (
          newFolder ? (
            <NewFolderForm parentId={activeFolder} onDone={() => setNewFolder(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setNewFolder(true)}
              className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-ink-muted hover:text-brand-red-text"
            >
              <FolderPlus size={13} aria-hidden="true" />
              New folder
            </button>
          )
        ) : null}
      </aside>

      <div className="min-w-0">
        {canUpload ? (
          <div className="mb-4">
            {storageConfigured ? null : (
              <p className="mb-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
                File storage is not configured, so uploads will be refused. Set the R2_* environment
                variables to enable them.
              </p>
            )}
            <Uploader folderId={activeFolder} />
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              push({ search: search.trim() || undefined });
            }}
            className="flex items-center gap-1.5"
          >
            <label htmlFor="media-search" className="sr-only">
              Search files
            </label>
            <div className="relative">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <input
                id="media-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, alt, caption or notes"
                className="h-9 w-56 rounded-md border border-line-strong pl-8 pr-2 text-sm focus:border-brand-red"
              />
            </div>
            <button
              type="submit"
              className="h-9 rounded-md border border-line-strong px-3 text-sm text-navy-800 hover:border-navy-300"
            >
              Search
            </button>
          </form>

          <label className="sr-only" htmlFor="media-type">
            Type
          </label>
          <select
            id="media-type"
            value={searchParams.get("type") ?? ""}
            onChange={(event) => push({ type: event.target.value || undefined })}
            className="h-9 rounded-md border border-line-strong bg-white px-2 text-sm text-ink focus:border-brand-red"
          >
            <option value="">Every type</option>
            <option value="IMAGE">Images</option>
            <option value="VIDEO">Video</option>
            <option value="DOCUMENT">Documents</option>
          </select>

          <button
            type="button"
            onClick={() => push({ unused: unusedOnly ? undefined : "1" })}
            aria-pressed={unusedOnly}
            className={`h-9 rounded-md border px-3 text-sm ${
              unusedOnly
                ? "border-brand-red bg-brand-red/5 text-brand-red-text"
                : "border-line-strong text-navy-800 hover:border-navy-300"
            }`}
          >
            Unused only
          </button>

          {activeTag ? (
            <button
              type="button"
              onClick={() => push({ tag: undefined })}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-brand-red bg-brand-red/5 px-3 text-sm text-brand-red-text"
            >
              #{activeTag}
              <X size={12} aria-hidden="true" />
              <span className="sr-only">Clear the tag filter</span>
            </button>
          ) : null}

          <p className="ml-auto text-xs text-ink-subtle">
            {total} file{total === 1 ? "" : "s"}
          </p>
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-line bg-white px-4 py-10 text-center">
            <p className="text-sm text-ink-subtle">
              {unusedOnly
                ? "Every file is used somewhere."
                : activeTag
                  ? "No files carry that tag."
                  : "Nothing here yet."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  aria-pressed={selected?.id === item.id}
                  className={`w-full overflow-hidden rounded-lg border bg-white text-left transition-colors ${
                    selected?.id === item.id
                      ? "border-brand-red"
                      : "border-line hover:border-navy-300"
                  }`}
                >
                  <div className="aspect-4/3 bg-surface-muted p-2">
                    <Thumb item={item} />
                  </div>
                  <div className="border-t border-line px-2.5 py-2">
                    <p className="truncate text-xs text-navy-800">{item.title || item.filename}</p>
                    <p className="text-2xs text-ink-subtle">
                      {human(item.size)}
                      {item.versions > 1 ? ` · v${item.versions}` : ""}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <nav
            aria-label="Pagination"
            className="mt-4 flex items-center justify-between gap-3 text-xs text-ink-subtle"
          >
            <PageButton disabled={page <= 1} onClick={() => push({ page: String(page - 1) })}>
              Previous
            </PageButton>
            <span className="tabular-nums">
              Page {page} of {pages}
            </span>
            <PageButton disabled={page >= pages} onClick={() => push({ page: String(page + 1) })}>
              Next
            </PageButton>
          </nav>
        ) : null}
      </div>

      {selected ? (
        <DetailPanel
          item={selected}
          folders={folders}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function PageButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red hover:text-brand-red disabled:border-line disabled:text-ink-subtle/60"
    >
      {children}
    </button>
  );
}

function NewFolderForm({ parentId, onDone }: { parentId: string | null; onDone: () => void }) {
  const [state, formAction] = useActionState<MediaActionState, FormData>(createFolderAction, null);

  React.useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="mt-2 space-y-2" noValidate>
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      <label className="sr-only" htmlFor="folder-name">
        Folder name
      </label>
      <Input id="folder-name" name="name" placeholder="Folder name" required />
      {state && !state.ok ? <Problem message={state.message} /> : null}
      <div className="flex gap-1.5">
        <Submit label="Create" />
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Click the picture to say what part of it matters.
 *
 * A crop throws away edges, and which edges are expendable is a property of the
 * photograph, not of the band it lands in. Setting it here means a portrait
 * keeps its face in every aspect ratio it is ever poured into, instead of an
 * editor discovering a decapitation on the live site.
 *
 * The value rides in hidden inputs that React renders on the server too, so a
 * form submitted before this component is interactive still posts the point the
 * file already had, rather than clearing it.
 */
function FocalPicker({
  item,
  formId,
  x,
  y,
  onChange,
}: {
  item: LibraryItem;
  /** The form these hidden inputs belong to, which is in a sibling column. */
  formId: string;
  x: number | null;
  y: number | null;
  onChange: (next: { x: number | null; y: number | null }) => void;
}) {
  const set = (event: React.MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const nextX = Math.round(((event.clientX - box.left) / box.width) * 100);
    const nextY = Math.round(((event.clientY - box.top) / box.height) * 100);
    onChange({
      x: Math.min(100, Math.max(0, nextX)),
      y: Math.min(100, Math.max(0, nextY)),
    });
  };

  return (
    <div>
      {/* The picker sits in the preview column and the fields it feeds are in
          the next one, so the inputs join the form by id rather than by being
          nested inside it. */}
      <input type="hidden" form={formId} name="focalX" value={x ?? ""} />
      <input type="hidden" form={formId} name="focalY" value={y ?? ""} />

      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-navy-800">
        <Crosshair size={13} aria-hidden="true" className="text-ink-subtle" />
        Focal point
      </p>

      <button
        type="button"
        onClick={set}
        aria-label="Set the focal point by clicking the image"
        className="relative block aspect-4/3 w-full cursor-crosshair overflow-hidden rounded-md border border-line bg-surface-muted"
      >
        <Thumb item={item} />
        {x !== null && y !== null ? (
          <span
            aria-hidden="true"
            style={{ left: `${x}%`, top: `${y}%` }}
            className="absolute -ml-2.5 -mt-2.5 h-5 w-5 rounded-full border-2 border-brand-red bg-white/40 shadow-sm"
          />
        ) : null}
      </button>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-2xs text-ink-subtle">
          {x === null || y === null ? "Centred, as every image was before." : `${x}% ${y}%`}
        </p>
        {x !== null || y !== null ? (
          <button
            type="button"
            onClick={() => onChange({ x: null, y: null })}
            className="text-2xs text-ink-subtle underline hover:text-brand-red-text"
          >
            Reset to centre
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Everything that shows this file.
 *
 * The counts that matter most — a band on a page — have no foreign key behind
 * them, so this is a query rather than a number the row already carries. It is
 * fetched when the panel opens, and it is what the delete guard is standing on:
 * showing the list beside the button is the difference between "you cannot" and
 * "here is what to fix first".
 */
function UsagePanel({ mediaId }: { mediaId: string }) {
  const [usage, setUsage] = React.useState<MediaUsage | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [loading, startLoad] = useTransition();

  React.useEffect(() => {
    setUsage(null);
    setFailed(false);
    startLoad(async () => {
      const result = await mediaUsageAction(mediaId);
      if (result.ok) setUsage(result.data);
      else setFailed(true);
    });
  }, [mediaId]);

  return (
    <div className="border-t border-line pt-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-navy-800">
        <Link2 size={13} aria-hidden="true" className="text-ink-subtle" />
        Used in
      </p>

      {loading || (!usage && !failed) ? (
        <p className="mt-1.5 text-2xs text-ink-subtle">Checking…</p>
      ) : failed ? (
        // Not "0 places": a check that did not run is not a file nobody uses,
        // and reporting it as one is how somebody deletes a live image.
        <p className="mt-1.5 text-2xs text-ink-subtle">Could not check just now.</p>
      ) : usage && usage.total === 0 ? (
        <p className="mt-1.5 text-2xs text-ink-subtle">Nothing references this file.</p>
      ) : usage ? (
        <ul className="mt-1.5 space-y-1 text-2xs text-ink">
          {usage.pages.map((page) => (
            <li key={page.id} className="flex items-baseline justify-between gap-2">
              <span className="truncate">
                {page.title}
                <span className="text-ink-subtle"> /{page.slug}</span>
              </span>
              <span className="shrink-0 text-ink-subtle">
                {page.sections} band{page.sections === 1 ? "" : "s"}
              </span>
            </li>
          ))}
          {usage.reusables.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{row.name}</span>
              <span className="shrink-0 text-ink-subtle">
                reusable · {row.placements} placement
                {row.placements === 1 ? "" : "s"}
              </span>
            </li>
          ))}
          {usage.entities.map((row) => (
            <li key={row.label} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{row.label}</span>
              <span className="shrink-0 text-ink-subtle">{row.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DetailPanel({
  item,
  folders,
  canEdit,
  canDelete,
  onClose,
}: {
  item: LibraryItem;
  folders: LibraryFolder[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<MediaActionState, FormData>(updateMediaAction, null);
  const [copied, setCopied] = React.useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [replacing, setReplacing] = React.useState(false);
  const [focal, setFocal] = React.useState<{
    x: number | null;
    y: number | null;
  }>({
    x: item.focalX,
    y: item.focalY,
  });
  const formId = React.useId();

  // A different file selected means a different point; without this the panel
  // would show the previous image's crosshair over the new picture.
  React.useEffect(() => {
    setFocal({ x: item.focalX, y: item.focalY });
  }, [item.id, item.focalX, item.focalY]);

  return (
    <aside
      aria-label={`Details for ${item.filename}`}
      className="rounded-lg border border-line bg-white p-4 lg:col-span-2"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 truncate font-display text-base text-navy-800">{item.filename}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1 text-ink-subtle hover:text-brand-red"
        >
          <X size={14} aria-hidden="true" />
          <span className="sr-only">Close the details panel</span>
        </button>
      </div>

      <div className="mt-3 grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div>
          {canEdit && item.type === "IMAGE" ? (
            <FocalPicker item={item} formId={formId} x={focal.x} y={focal.y} onChange={setFocal} />
          ) : (
            <div className="aspect-4/3 rounded-md border border-line bg-surface-muted p-2">
              <Thumb item={item} />
            </div>
          )}

          <dl className="mt-3 space-y-1 text-2xs text-ink-subtle">
            <div className="flex justify-between gap-3">
              <dt>Type</dt>
              <dd className="text-ink">{item.mimeType}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Size</dt>
              <dd className="tabular-nums text-ink">{human(item.size)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Added</dt>
              <dd className="text-ink">{DATE.format(new Date(item.createdAt))}</dd>
            </div>
            {item.uploadedBy ? (
              <div className="flex justify-between gap-3">
                <dt>By</dt>
                <dd className="text-ink">{item.uploadedBy.name}</dd>
              </div>
            ) : null}
            {item.versions > 1 ? (
              <div className="flex justify-between gap-3">
                <dt>Versions</dt>
                <dd className="text-ink">
                  <Badge tone="neutral">v{item.versions}</Badge>
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-3 flex items-center gap-1.5">
            <input
              readOnly
              aria-label="Public URL"
              value={item.url}
              className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-surface-muted px-2 font-mono text-2xs text-ink"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(item.url);
                setCopied(true);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-sm border border-line-strong px-2 text-2xs text-navy-800 hover:border-brand-red hover:text-brand-red-text"
            >
              {copied ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <Copy size={12} aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {canEdit ? (
            <form id={formId} action={formAction} className="space-y-3" noValidate>
              <input type="hidden" name="id" value={item.id} />

              <Field id="filename" label="Filename" required>
                {(aria) => (
                  <Input {...aria} name="filename" defaultValue={item.filename} required />
                )}
              </Field>

              <Field id="title" label="Title" hint="What you call it. The filename is what landed.">
                {(aria) => <Input {...aria} name="title" defaultValue={item.title ?? ""} />}
              </Field>

              <Field
                id="alt"
                label="Alt text"
                hint="What the image shows, for screen readers and SEO"
              >
                {(aria) => <Textarea {...aria} name="alt" rows={2} defaultValue={item.alt ?? ""} />}
              </Field>

              <Field
                id="caption"
                label="Caption"
                hint="Shown under the image where a band has none of its own — a credit set once."
              >
                {(aria) => <Input {...aria} name="caption" defaultValue={item.caption ?? ""} />}
              </Field>

              <Field
                id="description"
                label="Internal notes"
                hint="Where it came from, the licence, who is in it. Never shown publicly."
              >
                {(aria) => (
                  <Textarea
                    {...aria}
                    name="description"
                    rows={2}
                    defaultValue={item.description ?? ""}
                  />
                )}
              </Field>

              <Field id="tags" label="Tags" hint="Separated by commas. Shared with the CRM's tags.">
                {(aria) => (
                  <Input
                    {...aria}
                    name="tags"
                    defaultValue={item.tags.map((tag) => tag.name).join(", ")}
                    placeholder="hero, team, 2026"
                  />
                )}
              </Field>

              <Field id="folderId" label="Folder">
                {(aria) => (
                  <Select {...aria} name="folderId" defaultValue={item.folder?.id ?? ""}>
                    <option value="">No folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.path}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {state && !state.ok ? <Problem message={state.message} /> : null}
              {state?.ok ? (
                <p role="status" className="text-xs text-success">
                  Saved.
                </p>
              ) : null}

              <Submit label="Save" />
            </form>
          ) : null}

          <UsagePanel mediaId={item.id} />

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {canEdit ? (
              <Button size="sm" variant="secondary" onClick={() => setReplacing((r) => !r)}>
                {replacing ? "Cancel replacement" : "Replace with a new version"}
              </Button>
            ) : null}

            {canDelete ? (
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const result = await deleteMediaAction(item.id);
                    if (!result.ok) setError(result.message);
                    else {
                      onClose();
                      router.refresh();
                    }
                  });
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>

          <Problem message={error} />

          {replacing ? (
            <div>
              <p className="mb-2 text-2xs text-ink-subtle">
                The new file must be the same kind. The old version is kept, and anything already
                pointing at the previous URL keeps working.
              </p>
              <Uploader replacesId={item.id} compact onUploaded={() => setReplacing(false)} />
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
