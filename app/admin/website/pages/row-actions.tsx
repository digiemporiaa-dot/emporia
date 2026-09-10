"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, MoreHorizontal, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import {
  deletePageAction,
  duplicatePageAction,
  restorePageAction,
  setPageStatusAction,
} from "../actions";

/**
 * Row actions for the pages list.
 *
 * `"use client"` is genuine: this needs a confirmation dialog and pending
 * state. Every button here is a convenience — the server action behind each one
 * re-checks the permission, so hiding a button is not the control (CLAUDE.md 2
 * rule 2).
 */

type Props = {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  deleted: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canCreate: boolean;
  canDelete: boolean;
};

export function RowActions({
  id,
  title,
  status,
  deleted,
  canEdit,
  canPublish,
  canCreate,
  canDelete,
}: Props) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const run = (work: () => Promise<ActionResult<unknown>>, success: string) => {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        push({ tone: "success", title: success });
        router.refresh();
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
      }
      setOpen(false);
      setConfirmDelete(false);
    });
  };

  if (deleted) {
    return canDelete ? (
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(() => restorePageAction(id), "Page restored as a draft.")}
      >
        <RotateCcw size={13} aria-hidden="true" />
        Restore
      </Button>
    ) : null;
  }

  const items: { key: string; label: string; icon: React.ReactNode; run: () => void }[] = [];

  if (canPublish && status !== "PUBLISHED") {
    items.push({
      key: "publish",
      label: "Publish",
      icon: <Send size={13} aria-hidden="true" />,
      run: () => run(() => setPageStatusAction(id, "PUBLISHED"), "Page published."),
    });
  }
  if (canEdit && status === "PUBLISHED") {
    items.push({
      key: "unpublish",
      label: "Unpublish",
      icon: <Undo2 size={13} aria-hidden="true" />,
      run: () => run(() => setPageStatusAction(id, "DRAFT"), "Page moved back to draft."),
    });
  }
  if (canCreate) {
    items.push({
      key: "duplicate",
      label: "Duplicate",
      icon: <Copy size={13} aria-hidden="true" />,
      run: () => run(() => duplicatePageAction(id), "Page duplicated as a draft."),
    });
  }
  if (canDelete) {
    items.push({
      key: "delete",
      label: "Delete",
      icon: <Trash2 size={13} aria-hidden="true" />,
      run: () => setConfirmDelete(true),
    });
  }

  if (items.length === 0) return null;

  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          aria-label={`Actions for ${title}`}
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          <MoreHorizontal size={15} aria-hidden="true" />
        </Button>
      </div>

      {open ? (
        <Dialog open onClose={() => setOpen(false)} title={title} description="Page actions">
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={item.run}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-navy-800 hover:bg-surface-muted disabled:opacity-50"
                >
                  {item.icon}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}

      {confirmDelete ? (
        <Dialog
          open
          onClose={() => setConfirmDelete(false)}
          title="Delete this page?"
          description={`"${title}" stops serving immediately. It moves to the bin, where it can be restored — nothing is erased.`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => run(() => deletePageAction(id), "Page moved to the bin.")}
              >
                {pending ? "Deleting…" : "Delete page"}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-muted">
            If the page is live, its URL will start returning 404. Add a redirect if anything links
            to it.
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

/** Preview link, shown wherever a row or header offers one. */
export function PreviewLink({ id }: { id: string }) {
  return (
    <a
      href={`/admin/website/pages/${id}/preview`}
      className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-red-text"
    >
      <Eye size={12} aria-hidden="true" />
      Preview
    </a>
  );
}
