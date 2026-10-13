"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { purgeClientAction, purgeLeadAction, restoreClientAction, restoreLeadAction } from "./actions";

/**
 * Restore and Delete permanently for one item in the bin. A permanent delete
 * always asks first; when the service would refuse it (a client's financial
 * records), the button says why instead of offering it.
 */
export function BinActions({
  kind,
  id,
  name,
  keptBecause = [],
}: {
  kind: "lead" | "client";
  id: string;
  name: string;
  keptBecause?: readonly string[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, start] = React.useTransition();

  const restore = () =>
    start(async () => {
      const result = await (kind === "lead" ? restoreLeadAction : restoreClientAction)({ id });
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      push({ tone: "success", title: `${name} restored.` });
      router.refresh();
    });

  const purge = () =>
    start(async () => {
      const result = await (kind === "lead" ? purgeLeadAction : purgeClientAction)({ id });
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      setConfirming(false);
      push({ tone: "success", title: `${name} deleted permanently.` });
      router.refresh();
    });

  const kept = keptBecause.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={restore}>
        <RotateCcw size={13} aria-hidden="true" />
        Restore<span className="sr-only"> {name}</span>
      </Button>
      {kept ? (
        <span className="text-2xs text-ink-subtle">Kept: {keptBecause.join(", ")}</span>
      ) : (
        <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirming(true)}>
          <Trash2 size={13} aria-hidden="true" />
          Delete permanently<span className="sr-only"> {name}</span>
        </Button>
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${name} permanently?`}
        description={
          kind === "lead"
            ? "The lead, its notes, tasks and timeline are removed for good. Opportunities and proposals raised from it stay, without the link. This cannot be undone."
            : "The client and everything that is only theirs — projects, content, SEO websites, social accounts and posts, messages — are removed for good. Its portal users are removed too. This cannot be undone."
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
          <Button variant="danger" disabled={pending} onClick={purge}>
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
