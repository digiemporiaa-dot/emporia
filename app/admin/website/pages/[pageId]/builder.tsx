"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Blocks,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  Replace,
  Trash2,
  Unlink,
} from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import type { PickedMedia } from "@/components/admin/media-picker";
import {
  BLOCK_LIBRARY,
  blockDefinition,
  blockWarnings,
  isBlockType,
  type BlockType,
} from "@/lib/content/blocks";
import type { ActionResult } from "@/lib/errors";
import { BlockFields, type Content } from "./block-fields";
import { GridFields, LayoutFields, StyleFields } from "./style-fields";
import {
  addSectionAction,
  changeSectionTypeAction,
  detachSectionAction,
  insertReusableSectionAction,
  deleteSectionAction,
  duplicateSectionAction,
  reorderSectionsAction,
  saveSectionAction,
  setSectionVisibleAction,
} from "../../actions";

/**
 * The page builder.
 *
 * Reordering is available two ways on purpose. Dragging is the fast path;
 * Move up / Move down are real buttons, because HTML5 drag-and-drop is
 * unreachable by keyboard and inconsistent with screen readers, and "reorder
 * the page" cannot be a mouse-only capability (CLAUDE.md 12).
 *
 * Order is applied optimistically and then persisted; if the server rejects it,
 * the list is refreshed back to the truth rather than left showing a lie.
 */

export type BuilderSection = {
  id: string;
  type: string;
  order: number;
  name: string | null;
  isVisible: boolean;
  content: unknown;
  reusableSectionId: string | null;
};

export type InsertableReusable = {
  id: string;
  key: string;
  name: string;
  type: string;
  isGlobal: boolean;
};

type Props = {
  pageId: string;
  sections: readonly BuilderSection[];
  /** Every image any section references, keyed by media id. */
  media: Record<string, PickedMedia>;
  /** Published reusable sections available to place. */
  reusables: readonly InsertableReusable[];
  canEdit: boolean;
};

const GROUPS = ["Layout", "Text", "Media", "Data"] as const;

/**
 * Which tabs a block shows.
 *
 * Every block has Layout and Style — those edit the shared `band`, which every
 * block carries. Grid is only offered where there is a grid to configure, so
 * the tab is absent rather than present and inert.
 */
const HAS_GRID = new Set<BlockType>(["iconCards", "imageCards", "benefits", "logoGrid"]);

const TABS = ["Content", "Layout", "Grid", "Style"] as const;
type Tab = (typeof TABS)[number];

function summarise(section: BuilderSection): string {
  const content = (section.content ?? {}) as Record<string, unknown>;
  for (const key of ["text", "heading", "title", "body", "caption"]) {
    const value = content[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 80);
    }
  }
  return "";
}

export function PageBuilder({ pageId, sections, media, reusables, canEdit }: Props) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = React.useTransition();

  // Local copy so a drag or a move reads instantly; the server is the truth and
  // `router.refresh()` reconciles.
  const [order, setOrder] = React.useState<BuilderSection[]>([...sections]);
  React.useEffect(() => setOrder([...sections]), [sections]);

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [retypingId, setRetypingId] = React.useState<string | null>(null);

  const run = (work: () => Promise<ActionResult<unknown>>, success: string) => {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        push({ tone: "success", title: success });
        router.refresh();
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
        router.refresh();
      }
    });
  };

  const commitOrder = (next: BuilderSection[]) => {
    setOrder(next);
    startTransition(async () => {
      const result = await reorderSectionsAction(
        pageId,
        next.map((section, index) => ({ id: section.id, order: index })),
      );
      if (!result.ok) {
        push({ tone: "error", title: "Could not save the new order.", description: result.message });
      }
      router.refresh();
    });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    commitOrder(next);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = order.findIndex((s) => s.id === dragId);
    const to = order.findIndex((s) => s.id === targetId);
    setDragId(null);
    if (from >= 0 && to >= 0) move(from, to);
  };

  const editing = order.find((section) => section.id === editingId) ?? null;
  const deleting = order.find((section) => section.id === confirmDeleteId) ?? null;
  const retyping = order.find((section) => section.id === retypingId) ?? null;

  return (
    <section aria-labelledby="builder-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="builder-heading" className="text-lg text-navy-800">
            Sections
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {order.length === 0
              ? "This page has no sections yet."
              : `${order.length} section${order.length === 1 ? "" : "s"}, in the order they appear.`}
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setAdding(true)} disabled={pending}>
            <Plus size={14} aria-hidden="true" />
            Add section
          </Button>
        ) : null}
      </div>

      {order.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-subtle">
          Add a section to start building this page.
        </p>
      ) : (
        <ol className="space-y-2">
          {order.map((section, index) => {
            const linked = Boolean(section.reusableSectionId);
            // A linked section is edited where it is authored; editing the copy
            // here would be overwritten by the next save of the original.
            const editable = isBlockType(section.type) && !linked;
            const summary = summarise(section);
            const warnings = blockWarnings(section.type, section.content);

            return (
              <li
                key={section.id}
                draggable={canEdit}
                onDragStart={() => setDragId(section.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => {
                  if (dragId) event.preventDefault();
                }}
                onDrop={() => onDrop(section.id)}
                className={[
                  "flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5",
                  dragId === section.id ? "border-brand-red opacity-60" : "border-line",
                  !section.isVisible ? "bg-surface-muted" : "",
                ].join(" ")}
              >
                {canEdit ? (
                  <span
                    aria-hidden="true"
                    className="cursor-grab text-ink-subtle active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical size={15} />
                  </span>
                ) : null}

                <span className="w-5 text-right text-xs tabular-nums text-ink-subtle">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy-800">
                    {section.name ?? section.type}
                    {linked ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-2xs font-normal uppercase tracking-wide text-navy-700">
                        <Blocks size={11} aria-hidden="true" />
                        reusable
                      </span>
                    ) : !isBlockType(section.type) ? (
                      <span className="ml-2 text-2xs font-normal uppercase tracking-wide text-ink-subtle">
                        built-in
                      </span>
                    ) : null}
                  </p>
                  {summary ? <p className="truncate text-xs text-ink-subtle">{summary}</p> : null}
                  {warnings.length > 0 ? (
                    // Incomplete is allowed while drafting; invisible is not.
                    <p className="truncate text-xs text-warning">{warnings.join(" · ")}</p>
                  ) : null}
                </div>

                {!section.isVisible ? (
                  <span className="shrink-0 text-2xs uppercase tracking-wide text-ink-subtle">
                    Hidden
                  </span>
                ) : null}

                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      label={`Move ${section.name ?? section.type} up`}
                      disabled={pending || index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ChevronUp size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`Move ${section.name ?? section.type} down`}
                      disabled={pending || index === order.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ChevronDown size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`${section.isVisible ? "Hide" : "Show"} ${section.name ?? section.type}`}
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => setSectionVisibleAction(pageId, section.id, !section.isVisible),
                          section.isVisible ? "Section hidden." : "Section shown.",
                        )
                      }
                    >
                      {section.isVisible ? (
                        <Eye size={14} aria-hidden="true" />
                      ) : (
                        <EyeOff size={14} aria-hidden="true" />
                      )}
                    </IconButton>
                    <IconButton
                      label={`Duplicate ${section.name ?? section.type}`}
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => duplicateSectionAction(pageId, section.id),
                          "Section duplicated.",
                        )
                      }
                    >
                      <Copy size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`Change the type of ${section.name ?? section.type}`}
                      disabled={pending || !editable}
                      onClick={() => setRetypingId(section.id)}
                    >
                      <Replace size={14} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`Edit ${section.name ?? section.type}`}
                      disabled={pending || !editable}
                      onClick={() => setEditingId(section.id)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </IconButton>
                    {linked ? (
                      <IconButton
                        label={`Unlink ${section.name ?? section.type} from its reusable section`}
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => detachSectionAction(pageId, section.id),
                            "Unlinked. This section is now independent.",
                          )
                        }
                      >
                        <Unlink size={14} aria-hidden="true" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      label={`Delete ${section.name ?? section.type}`}
                      disabled={pending}
                      onClick={() => setConfirmDeleteId(section.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </IconButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {adding ? (
        <AddSectionDialog
          reusables={reusables}
          onClose={() => setAdding(false)}
          onPick={(type) => {
            setAdding(false);
            run(() => addSectionAction(pageId, type), "Section added.");
          }}
          onPickReusable={(id) => {
            setAdding(false);
            run(() => insertReusableSectionAction(pageId, id), "Reusable section placed.");
          }}
        />
      ) : null}

      {editing && isBlockType(editing.type) ? (
        <SectionEditor
          key={editing.id}
          pageId={pageId}
          section={editing}
          type={editing.type}
          media={
            media[
              String(((editing.content ?? {}) as Record<string, unknown>)["mediaId"] ?? "")
            ] ?? null
          }
          cardMedia={media}
          onClose={() => setEditingId(null)}
          onSaved={(options) => {
            setEditingId(null);
            router.refresh();
            // The preview renders through the same code the public site uses,
            // so what an editor checks there is what will ship.
            if (options?.preview) {
              window.open(`/admin/website/pages/${pageId}/preview`, "_blank", "noopener");
            }
          }}
        />
      ) : null}

      {retyping ? (
        <ChangeTypeDialog
          current={retyping.type}
          onClose={() => setRetypingId(null)}
          onPick={(type) => {
            setRetypingId(null);
            run(
              () => changeSectionTypeAction(pageId, retyping.id, type),
              "Section type changed.",
            );
          }}
        />
      ) : null}

      {deleting ? (
        <Dialog
          open
          onClose={() => setConfirmDeleteId(null)}
          title="Delete this section?"
          description={`"${deleting.name ?? deleting.type}" is removed from the page. This cannot be undone from here.`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setConfirmDeleteId(null);
                  run(() => deleteSectionAction(pageId, deleting.id), "Section deleted.");
                }}
              >
                Delete section
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-muted">
            To take it off the page without losing the content, hide it instead.
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}

function IconButton({
  label,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className="rounded-sm p-1.5 text-ink-muted hover:bg-surface-muted hover:text-navy-800 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function AddSectionDialog({
  reusables,
  onClose,
  onPick,
  onPickReusable,
}: {
  reusables: readonly InsertableReusable[];
  onClose: () => void;
  onPick: (type: BlockType) => void;
  onPickReusable: (id: string) => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Add a section" description="Pick a block to add to the end of the page.">
      <div className="space-y-5">
        {reusables.length > 0 ? (
          <div>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
              Reusable
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {reusables.map((reusable) => (
                <li key={reusable.id}>
                  <button
                    type="button"
                    onClick={() => onPickReusable(reusable.id)}
                    className="w-full rounded-md border border-line px-3 py-2.5 text-left hover:border-brand-red hover:bg-red-50/40"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-navy-800">{reusable.name}</span>
                      {reusable.isGlobal ? (
                        <span className="text-2xs uppercase tracking-wide text-navy-700">
                          global
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-subtle">
                      Edited centrally — changes reach every page using it.
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {GROUPS.map((group) => {
          const blocks = BLOCK_LIBRARY.filter((block) => block.group === group);
          if (blocks.length === 0) return null;
          return (
            <div key={group}>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                {group}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {blocks.map((block) => (
                  <li key={block.type}>
                    <button
                      type="button"
                      onClick={() => onPick(block.type)}
                      className="w-full rounded-md border border-line px-3 py-2.5 text-left hover:border-brand-red hover:bg-red-50/40"
                    >
                      <span className="block text-sm font-medium text-navy-800">{block.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-subtle">
                        {block.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/**
 * Change one section into another block type.
 *
 * The copy, the band and the grid carry across where the new type has a field
 * for them; anything it does not is dropped. Said plainly here rather than
 * discovered afterwards.
 */
function ChangeTypeDialog({
  current,
  onClose,
  onPick,
}: {
  current: string;
  onClose: () => void;
  onPick: (type: BlockType) => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Change this section's type"
      description="Copy, layout and grid settings carry over where the new type has a field for them. Anything it does not is dropped."
    >
      <div className="space-y-5">
        {GROUPS.map((group) => {
          const blocks = BLOCK_LIBRARY.filter(
            (block) => block.group === group && block.type !== current,
          );
          if (blocks.length === 0) return null;
          return (
            <div key={group}>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                {group}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {blocks.map((block) => (
                  <li key={block.type}>
                    <button
                      type="button"
                      onClick={() => onPick(block.type)}
                      className="w-full rounded-md border border-line px-3 py-2.5 text-left hover:border-brand-red hover:bg-red-50/40"
                    >
                      <span className="block text-sm font-medium text-navy-800">{block.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-subtle">
                        {block.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

function SectionEditor({
  pageId,
  section,
  type,
  media,
  cardMedia,
  onClose,
  onSaved,
}: {
  pageId: string;
  section: BuilderSection;
  type: BlockType;
  media: PickedMedia | null;
  cardMedia: Readonly<Record<string, PickedMedia>>;
  onClose: () => void;
  onSaved: (options?: { preview?: boolean }) => void;
}) {
  const { push } = useToast();
  const [content, setContent] = React.useState<Content>(
    () => ({ ...((section.content ?? {}) as Content) }),
  );
  const [name, setName] = React.useState(section.name ?? "");
  const [errors, setErrors] = React.useState<Record<string, string[]> | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("Content");

  const set = React.useCallback((patch: Content) => {
    setContent((current) => ({ ...current, ...patch }));
  }, []);

  const definition = blockDefinition(type);
  const tabs = TABS.filter((candidate) => candidate !== "Grid" || HAS_GRID.has(type));

  const save = async (options?: { preview?: boolean }) => {
    setSaving(true);
    setErrors(null);
    const result = await saveSectionAction(pageId, section.id, content, name.trim() || null);
    setSaving(false);

    if (result.ok) {
      push({ tone: "success", title: "Section saved." });
      onSaved(options);
      return;
    }
    // Field errors come back from the service's zod parse, so the message lands
    // on the input that caused it.
    setErrors((result.details as Record<string, string[]> | undefined) ?? null);
    push({ tone: "error", title: "Check the section.", description: result.message });
    // A rejected field is rarely on the tab you are looking at.
    setTab("Content");
  };

  const backgroundMedia =
    cardMedia[
      String(
        (((content["band"] ?? {}) as Content)["background"] as Content | undefined)?.["mediaId"] ??
          "",
      )
    ] ?? null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={section.name ?? definition.label}
      description="Changes are saved to this page when you press Save."
      className="max-w-3xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => void save({ preview: true })}
          >
            Save and preview
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save section"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {definition.presets && definition.presets.length > 0 ? (
          <div>
            <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Start from
            </p>
            <div className="flex flex-wrap gap-2">
              {definition.presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  // A preset seeds settings; it never clears the copy already
                  // written, so trying one is not a decision to undo.
                  onClick={() => set({ ...preset.defaults })}
                  className="rounded-full border border-line px-3 py-1 text-xs text-navy-800 hover:border-brand-red hover:bg-red-50/40"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Label in the builder
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-9.5 w-full rounded-md border border-line-strong bg-white px-3 text-sm text-ink focus:border-brand-red"
          />
        </label>

        {/*
          A real tablist: arrow keys move between tabs, and each panel is
          associated with the tab that controls it. A row of divs that change a
          state variable is not a tab strip to a screen reader (CLAUDE.md 12).
        */}
        <div role="tablist" aria-label="Section settings" className="flex gap-1 border-b border-line">
          {tabs.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              id={`tab-${candidate}`}
              aria-selected={tab === candidate}
              aria-controls={`panel-${candidate}`}
              tabIndex={tab === candidate ? 0 : -1}
              onClick={() => setTab(candidate)}
              onKeyDown={(event) => {
                const index = tabs.indexOf(candidate);
                if (event.key === "ArrowRight") setTab(tabs[(index + 1) % tabs.length]!);
                if (event.key === "ArrowLeft") {
                  setTab(tabs[(index - 1 + tabs.length) % tabs.length]!);
                }
              }}
              className={[
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                tab === candidate
                  ? "border-brand-red font-medium text-navy-800"
                  : "border-transparent text-ink-muted hover:text-navy-800",
              ].join(" ")}
            >
              {candidate}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
          className="focus-visible:outline-none"
        >
          {tab === "Content" ? (
            <BlockFields
              type={type}
              content={content}
              set={set}
              errors={errors}
              media={media}
              cardMedia={cardMedia}
            />
          ) : null}
          {tab === "Layout" ? <LayoutFields content={content} set={set} /> : null}
          {tab === "Grid" ? (
            <GridFields
              content={content}
              set={set}
              legacyColumns={
                typeof content["columns"] === "number" ? (content["columns"] as number) : undefined
              }
            />
          ) : null}
          {tab === "Style" ? (
            <StyleFields content={content} set={set} backgroundMedia={backgroundMedia} />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
