"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { deleteLeadsAction } from "../actions";

/** Move this lead to the recycle bin, after a confirmation. */
export function DeleteLeadButton({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();

  const confirm = () =>
    start(async () => {
      const result = await deleteLeadsAction({ ids: [leadId] });
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      setOpen(false);
      push({ tone: "success", title: `${name} moved to the recycle bin.`, description: "Restore it from there if this was a mistake." });
      router.push("/admin/leads");
    });

  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        <Trash2 size={13} aria-hidden="true" />
        Delete
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${name}?`}
        description="The lead leaves every list and the pipeline. It stays in the recycle bin, where it can be restored or deleted permanently."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="danger" disabled={pending} onClick={confirm}>
            {pending ? "Deleting…" : "Move to recycle bin"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
