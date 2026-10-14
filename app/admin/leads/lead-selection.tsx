"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { deleteLeadsAction } from "./actions";

/**
 * Bulk selection on the leads table.
 *
 * The table stays a Server Component: this provider only remembers which ids
 * are ticked, and the checkboxes and the action bar read it. Selection is per
 * page — changing page or filters renders a fresh provider.
 */

type Selection = {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  setMany: (ids: readonly string[], on: boolean) => void;
};

const SelectionContext = React.createContext<Selection | null>(null);

function useSelection(): Selection {
  const value = React.useContext(SelectionContext);
  if (!value) throw new Error("Lead selection used outside its provider.");
  return value;
}

export function LeadSelection({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { push } = useToast();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = React.useState(false);
  const [pending, start] = React.useTransition();

  const value = React.useMemo<Selection>(
    () => ({
      selected,
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setMany: (ids, on) =>
        setSelected((current) => {
          const next = new Set(current);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
    }),
    [selected],
  );

  const count = selected.size;

  const confirm = () =>
    start(async () => {
      const result = await deleteLeadsAction({ ids: [...selected] });
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      setConfirming(false);
      setSelected(new Set());
      push({
        tone: "success",
        title: `${result.data.deleted} ${result.data.deleted === 1 ? "lead" : "leads"} moved to the recycle bin.`,
        description: "Restore them from there if this was a mistake.",
      });
      router.refresh();
    });

  return (
    <SelectionContext.Provider value={value}>
      {count > 0 ? (
        <div
          role="region"
          aria-label="Selected leads"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-strong bg-surface-muted px-3.5 py-2.5"
        >
          <p className="text-sm text-navy-800">
            {count} {count === 1 ? "lead" : "leads"} selected
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
              <Trash2 size={13} aria-hidden="true" />
              Delete selected
            </Button>
          </div>
        </div>
      ) : null}
      {children}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${count} ${count === 1 ? "lead" : "leads"}?`}
        description="They leave every list and the pipeline, and stay in the recycle bin, where they can be restored or deleted permanently."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep them
          </Button>
          <Button variant="danger" disabled={pending} onClick={confirm}>
            {pending ? "Deleting…" : "Move to recycle bin"}
          </Button>
        </div>
      </Dialog>
    </SelectionContext.Provider>
  );
}

const BOX = "size-4 cursor-pointer accent-brand-red";

export function SelectAllLeads({ ids }: { ids: readonly string[] }) {
  const { selected, setMany } = useSelection();
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  const some = !all && ids.some((id) => selected.has(id));
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={BOX}
      checked={all}
      disabled={ids.length === 0}
      aria-label="Select every lead on this page"
      onChange={(event) => setMany(ids, event.target.checked)}
    />
  );
}

export function SelectLead({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      className={BOX}
      checked={selected.has(id)}
      aria-label={`Select ${name}`}
      onChange={() => toggle(id)}
    />
  );
}
