"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Button, Card, CardBody, Dialog, Input, useToast } from "@/components/ui";
import {
  compareVersionAction,
  deleteVersionAction,
  restoreVersionAction,
  saveVersionAction,
} from "../../actions";
import type { VersionDiff } from "@/lib/services/page-version.service";

/**
 * Version history.
 *
 * The builder writes straight to the database, so an edit is live the moment it
 * is saved and there is no undo — this is the undo. Every entry is a complete
 * snapshot, taken on publish and on demand.
 *
 * Restoring is offered without ceremony because it is not a one-way door: the
 * state being replaced becomes a version first, so restoring the wrong one is
 * itself undoable. The comparison is offered *before* restoring for the same
 * reason a diff is offered before a merge — reading "three sections changed" is
 * cheaper than reading the page.
 */

export type VersionEntry = {
  id: string;
  version: number;
  reason: string | null;
  createdAt: string;
  author: string | null;
};

function Diff({ diff }: { diff: VersionDiff }) {
  if (diff.identical) {
    return <p className="text-xs text-ink-subtle">Nothing has changed since this version.</p>;
  }

  const KIND: Record<string, string> = {
    added: "Added",
    removed: "Removed",
    changed: "Changed",
    moved: "Moved",
  };

  return (
    <div className="space-y-3 text-sm">
      {diff.fields.length > 0 ? (
        <div>
          <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Page details
          </p>
          <ul className="space-y-1">
            {diff.fields.map((field) => (
              <li key={field.field} className="text-ink-muted">
                <span className="text-navy-800">{field.field}</span>: {field.from || "—"} →{" "}
                <span className="text-navy-800">{field.to || "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diff.sections.length > 0 ? (
        <div>
          <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Sections
          </p>
          <ul className="space-y-1">
            {diff.sections.map((section, index) => (
              <li key={`${index}-${section.label}`} className="text-ink-muted">
                <span className="text-navy-800">{KIND[section.kind] ?? section.kind}</span>{" "}
                {section.label}{" "}
                <span className="text-ink-subtle">(position {section.position})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function VersionPanel({
  pageId,
  versions,
  canEdit,
  canDelete,
}: {
  pageId: string;
  versions: readonly VersionEntry[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [reason, setReason] = React.useState("");
  const [comparing, setComparing] = React.useState<{ version: number; diff: VersionDiff } | null>(
    null,
  );
  const [confirmRestore, setConfirmRestore] = React.useState<number | null>(null);

  const run = (work: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    startTransition(async () => {
      const result = (await work()) as { ok: boolean; message?: string };
      if (result.ok) {
        push({ tone: "success", title: success });
        router.refresh();
        return;
      }
      push({ tone: "error", title: "That did not work.", description: result.message });
    });
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg text-navy-800">
            <History size={16} aria-hidden="true" className="text-ink-subtle" />
            Version history
          </h2>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <Input
                value={reason}
                aria-label="What this version is"
                placeholder="Before the rewrite"
                className="w-52"
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => run(() => saveVersionAction(pageId, reason), "Version saved.")}
              >
                Save a version
              </Button>
            </div>
          ) : null}
        </div>

        {versions.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-xs text-ink-subtle">
            No versions yet. One is taken automatically every time this page is published.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {versions.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-10 shrink-0 text-xs tabular-nums text-ink-subtle">
                  v{entry.version}
                </span>
                <div className="min-w-40 flex-1">
                  <p className="text-sm text-navy-800">{entry.reason ?? "Saved"}</p>
                  <p className="text-xs text-ink-subtle">
                    {entry.createdAt}
                    {entry.author ? ` · ${entry.author}` : ""}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await compareVersionAction(pageId, entry.version);
                      if (result.ok) setComparing({ version: entry.version, diff: result.data });
                      else
                        push({
                          tone: "error",
                          title: "Could not compare",
                          description: result.message,
                        });
                    })
                  }
                >
                  Compare
                </Button>

                {canEdit ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => setConfirmRestore(entry.version)}
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    Restore
                  </Button>
                ) : null}

                {canDelete ? (
                  <button
                    type="button"
                    aria-label={`Delete version ${entry.version}`}
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => deleteVersionAction(pageId, entry.version),
                        `Version ${entry.version} deleted.`,
                      )
                    }
                    className="rounded-sm p-1.5 text-ink-subtle hover:text-brand-red disabled:opacity-30"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Dialog
        open={comparing !== null}
        onClose={() => setComparing(null)}
        title={`What changed since v${comparing?.version ?? ""}`}
        description="Compared against what this page says right now."
      >
        {comparing ? <Diff diff={comparing.diff} /> : null}
        <div className="mt-5 flex justify-end">
          <Button type="button" variant="secondary" onClick={() => setComparing(null)}>
            Close
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirmRestore !== null}
        onClose={() => setConfirmRestore(null)}
        title={`Restore v${confirmRestore ?? ""}?`}
      >
        <p className="text-sm text-ink-muted">
          This page&rsquo;s sections are replaced with what that version said. What is here now is
          saved as a version first, so this can be undone. It does not change whether the page is
          published.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmRestore(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              const version = confirmRestore;
              setConfirmRestore(null);
              if (version === null) return;
              run(() => restoreVersionAction(pageId, version), `Restored v${version}.`);
            }}
          >
            Restore
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
