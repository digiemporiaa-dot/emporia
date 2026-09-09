"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

/**
 * Delete, behind a confirmation dialog.
 *
 * A real dialog rather than `window.confirm`: the native one is unstyled, not
 * focus-managed the way the rest of the admin is, and cannot say *why* a delete
 * might be refused. The refusal path matters here — several services decline a
 * delete when published content depends on the row, and the reason they give is
 * the useful part (CLAUDE.md 12).
 */
export function DeleteButton({
  id,
  label,
  description,
  action,
  redirectTo,
}: {
  id: string;
  /** What is being deleted, for the dialog title and the toast. */
  label: string;
  description: string;
  action: (id: string) => Promise<ActionResult<{ id: string }>>;
  /** Where to go afterwards. Omit to stay and refresh. */
  redirectTo?: Route;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const run = () => {
    startTransition(async () => {
      const result = await action(id);
      if (!result.ok) {
        toast.push({ tone: "error", title: "Could not delete", description: result.message });
        setOpen(false);
        return;
      }
      toast.push({ tone: "success", title: `${label} deleted.` });
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  };

  return (
    <>
      <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
        <Trash2 size={14} aria-hidden="true" />
        Delete
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={`Delete ${label}?`}>
        <p className="text-sm text-ink-muted">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={run} disabled={pending}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
