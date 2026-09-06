"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui";
import { billRetainersAction, markOverdueAction, sendRemindersAction } from "./actions";

/**
 * The jobs that would otherwise be a cron.
 *
 * Run by hand for now, and deliberately honest about what each one did — a
 * button that says "done" without saying how many is not much use.
 */
export function FinanceTools({ canBill, canRemind }: { canBill: boolean; canRemind: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; text: string }>) => {
    setMessage(null);
    start(async () => {
      setMessage(await fn());
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await markOverdueAction();
              return result.ok
                ? {
                    ok: true,
                    text:
                      result.data.count === 0
                        ? "Nothing has slipped past its due date."
                        : `${result.data.count} invoice${result.data.count === 1 ? "" : "s"} marked overdue.`,
                  }
                : { ok: false, text: result.message };
            })
          }
        >
          Check for overdue invoices
        </Button>

        {canBill ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await billRetainersAction();
                return result.ok
                  ? {
                      ok: true,
                      text:
                        result.data.raised.length === 0
                          ? "No retainer is due today."
                          : `Raised ${result.data.raised.join(", ")} as drafts.`,
                    }
                  : { ok: false, text: result.message };
              })
            }
          >
            Bill due retainers
          </Button>
        ) : null}

        {canRemind ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await sendRemindersAction();
                return result.ok
                  ? {
                      ok: true,
                      text:
                        result.data.sent.length === 0
                          ? "Nothing is due in the next few days."
                          : `Reminders attempted for ${result.data.sent.join(", ")}. Check the email log for what actually went.`,
                    }
                  : { ok: false, text: result.message };
              })
            }
          >
            Send payment reminders
          </Button>
        ) : null}
      </div>

      {message ? (
        message.ok ? (
          <p role="status" className="flex items-start gap-1.5 text-xs text-success">
            <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            {message.text}
          </p>
        ) : (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
            <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            {message.text}
          </p>
        )
      ) : null}

      <p className="border-t border-line pt-2 text-2xs text-ink-subtle">
        These run on demand. Scheduling them is the automation phase; nothing here pretends a cron
        exists.
      </p>
    </div>
  );
}
