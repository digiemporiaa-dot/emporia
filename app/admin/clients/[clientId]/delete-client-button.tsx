"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { deleteClientAction } from "../actions";

export type ClientDeletionImpact = {
  scheduledPosts: number;
  activeRetainers: number;
  portalUsers: number;
  openInvoices: number;
  activeProjects: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Move this client to the recycle bin. The confirmation says exactly what
 * stops, from counts read on the server, so nobody finds out afterwards.
 */
export function DeleteClientButton({
  clientId,
  name,
  impact,
}: {
  clientId: string;
  name: string;
  impact: ClientDeletionImpact;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();

  const stops = [
    impact.scheduledPosts ? `${plural(impact.scheduledPosts, "scheduled social post")} will be cancelled` : null,
    impact.activeRetainers ? `${plural(impact.activeRetainers, "active retainer")} will be paused` : null,
    impact.portalUsers ? `${plural(impact.portalUsers, "portal user")} will no longer be able to sign in` : null,
    impact.activeProjects ? `${plural(impact.activeProjects, "open project")} will leave the project lists` : null,
    impact.openInvoices
      ? `${plural(impact.openInvoices, "unpaid invoice")} will stay in Finance, but no payment reminders will be sent`
      : null,
  ].filter((line): line is string => line !== null);

  const confirm = () =>
    start(async () => {
      const result = await deleteClientAction({ id: clientId });
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      setOpen(false);
      push({ tone: "success", title: `${name} moved to the recycle bin.`, description: "Restore it from there if this was a mistake." });
      router.push("/admin/clients");
    });

  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        <Trash2 size={13} aria-hidden="true" />
        Delete client
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${name}?`}
        description="The client moves to the recycle bin and its work stops now. Restoring it brings the client back, but cancelled posts and paused retainers are restarted by hand."
      >
        <div className="space-y-4">
          {stops.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-navy-800">
              {stops.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Nothing is scheduled or running for this client.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={pending} onClick={confirm}>
              {pending ? "Deleting…" : "Move to recycle bin"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
