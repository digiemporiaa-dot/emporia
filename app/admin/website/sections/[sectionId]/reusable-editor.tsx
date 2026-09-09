"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import type { PickedMedia } from "@/components/admin/media-picker";
import type { BlockType } from "@/lib/content/blocks";
import { BlockFields, type Content } from "../../pages/[pageId]/block-fields";
import { deleteReusableSectionAction, saveReusableSectionAction } from "../../actions";
import type { TaxonomyOptions } from "@/lib/content/taxonomy";

/**
 * Editing a reusable section.
 *
 * The count of pages it appears on is stated next to the save button rather
 * than tucked away, because this is the one edit in the CMS that changes pages
 * the editor is not looking at.
 */

type Section = {
  id: string;
  name: string;
  type: BlockType;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  isGlobal: boolean;
  content: unknown;
  placements: number;
};

type Usage = {
  sectionId: string;
  isVisible: boolean;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  pageStatus: string;
};

export function ReusableEditor({
  section,
  media,
  usages,
  taxonomy,
  canDelete,
}: {
  section: Section;
  media: Readonly<Record<string, PickedMedia>>;
  usages: readonly Usage[];
  /** A reusable section can be a dynamic block too, so it needs the pickers. */
  taxonomy: TaxonomyOptions;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [name, setName] = React.useState(section.name);
  const [status, setStatus] = React.useState(section.status);
  const [isGlobal, setIsGlobal] = React.useState(section.isGlobal);
  const [content, setContent] = React.useState<Content>(() => ({
    ...((section.content ?? {}) as Content),
  }));
  const [errors, setErrors] = React.useState<Record<string, string[]> | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const set = React.useCallback((patch: Content) => {
    setContent((current) => ({ ...current, ...patch }));
  }, []);

  const singleMedia = media[String((content as Record<string, unknown>)["mediaId"] ?? "")] ?? null;

  const save = async () => {
    setSaving(true);
    setErrors(null);
    const result = await saveReusableSectionAction(section.id, { name, status, isGlobal, content });
    setSaving(false);

    if (result.ok) {
      push({
        tone: "success",
        title: "Section saved.",
        description:
          status === "PUBLISHED" && result.data.placements > 0
            ? `Updated on ${result.data.placements} page${result.data.placements === 1 ? "" : "s"}.`
            : undefined,
      });
      router.refresh();
      return;
    }
    setErrors((result.details as Record<string, string[]> | undefined) ?? null);
    push({ tone: "error", title: "Check the section.", description: result.message });
  };

  const remove = () =>
    startTransition(async () => {
      const result = await deleteReusableSectionAction(section.id);
      if (result.ok) {
        push({
          tone: "success",
          title: "Section deleted.",
          description:
            result.data.detached > 0
              ? `${result.data.detached} placement${result.data.detached === 1 ? "" : "s"} kept their content and are now independent.`
              : undefined,
        });
        router.push("/admin/website/sections");
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
      }
    });

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Name" required>
            {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field
            id="status"
            label="Status"
            hint="Only a published section can be placed on a page."
          >
            {(aria) => (
              <Select
                {...aria}
                value={status}
                onChange={(e) => setStatus(e.target.value as Section["status"])}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </Select>
            )}
          </Field>
        </div>

        <label className="flex items-start gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={isGlobal}
            onChange={(e) => setIsGlobal(e.target.checked)}
            className="mt-0.5 size-4 rounded-xs border-line-strong text-brand-red"
          />
          <span>
            Global section
            <span className="mt-0.5 block text-xs text-ink-subtle">
              A standard band for the whole site. Listed first when placing one on a page.
            </span>
          </span>
        </label>

        <hr className="border-line" />

        <BlockFields
          type={section.type}
          content={content}
          set={set}
          errors={errors}
          media={singleMedia}
          cardMedia={media}
          taxonomy={taxonomy}
        />

        {section.placements > 0 && status === "PUBLISHED" ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3.5 py-3 text-sm text-warning"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              Saving updates this section on {section.placements} page
              {section.placements === 1 ? "" : "s"}.
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save section"}
          </Button>
          {canDelete ? (
            <Button variant="danger" disabled={pending} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} aria-hidden="true" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <aside className="lg:col-span-5">
        <div className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-navy-800">
            Used on {usages.length} page{usages.length === 1 ? "" : "s"}
          </h2>
          {usages.length === 0 ? (
            <p className="mt-2 text-xs text-ink-subtle">
              Not placed anywhere yet. Publish it, then add it from a page&apos;s builder.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {usages.map((usage) => (
                <li key={usage.sectionId} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/admin/website/pages/${usage.pageId}`}
                    className="min-w-0 flex-1 truncate text-sm text-navy-800 hover:text-brand-red"
                  >
                    {usage.pageTitle}
                  </Link>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!usage.isVisible ? (
                      <span className="text-2xs uppercase tracking-wide text-ink-subtle">
                        Hidden
                      </span>
                    ) : null}
                    <Badge tone={usage.pageStatus === "PUBLISHED" ? "success" : "neutral"}>
                      {usage.pageStatus === "PUBLISHED" ? "Live" : "Draft"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {confirmDelete ? (
        <Dialog
          open
          onClose={() => setConfirmDelete(false)}
          title="Delete this reusable section?"
          description={
            usages.length > 0
              ? `${usages.length} page${usages.length === 1 ? "" : "s"} will keep the content as an ordinary section. They will simply stop updating with this one.`
              : "It is not placed on any page."
          }
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" disabled={pending} onClick={remove}>
                Delete section
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-muted">No page loses a band.</p>
        </Dialog>
      ) : null}
    </div>
  );
}
