"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import {
  cancelInvoiceAction,
  recordPaymentAction,
  refundPaymentAction,
  sendInvoiceAction,
  type FinanceActionState,
} from "../../actions";
import type { InvoiceStatus } from "@/generated/prisma/enums";

/**
 * The things you can do to an invoice.
 *
 * Recording a payment and issuing a refund are separate, confirmed forms
 * rather than inline buttons: both move money, and neither should be one
 * mis-click away. Every one of them is re-checked server-side — what is
 * rendered here only decides what is worth showing.
 */

function Result({ state }: { state: FinanceActionState }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p role="status" className="flex items-start gap-1.5 text-xs text-success">
        <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
        Done.
      </p>
    );
  }
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {state.message}
    </p>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function InvoiceLifecycle({
  invoiceId,
  status,
  canSend,
  canEdit,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  canSend: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.ok) router.refresh();
      else setError(result.message ?? "That did not work.");
    });

  const sendable = status === "DRAFT";
  const cancellable = status === "DRAFT" || status === "SENT" || status === "OVERDUE";

  if (!sendable && !cancellable) {
    return (
      <p className="text-xs text-ink-subtle">
        {status === "PAID"
          ? "Settled in full. Refund a payment below if money has to go back."
          : "This invoice is closed."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
          <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {sendable && canSend ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => sendInvoiceAction(invoiceId))}
          className="w-full"
        >
          Send to the client
        </Button>
      ) : null}

      {cancellable && canEdit ? (
        cancelling ? (
          <div className="space-y-2 rounded-md border border-line bg-surface-sunken p-2.5">
            <label htmlFor="cancel-reason" className="block text-xs text-navy-800">
              Why is it being cancelled?
            </label>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Kept in the audit trail, not printed on the invoice"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => run(() => cancelInvoiceAction(invoiceId, reason.trim()))}
              >
                Cancel the invoice
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setCancelling(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => setCancelling(true)}
          >
            Cancel invoice
          </Button>
        )
      ) : null}
    </div>
  );
}

const MANUAL_GATEWAYS = [
  ["BANK_TRANSFER", "Bank transfer"],
  ["UPI", "UPI"],
  ["CHEQUE", "Cheque"],
  ["CASH", "Cash"],
  ["OTHER", "Other"],
] as const;

export function RecordPayment({
  invoiceId,
  outstanding,
  currency,
}: {
  invoiceId: string;
  outstanding: string;
  currency: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<FinanceActionState, FormData>(
    recordPaymentAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="invoiceId" value={invoiceId} />

      <p className="text-xs text-ink-subtle">
        {formatMoney(outstanding, currency)} outstanding. Money that arrived by bank transfer,
        cheque or UPI is recorded here; anything paid through the gateway records itself.
      </p>

      <Field id="payment-amount" label="Amount" required>
        {(aria) => (
          <Input
            {...aria}
            name="amount"
            inputMode="decimal"
            defaultValue={outstanding}
            required
          />
        )}
      </Field>

      <Field id="payment-gateway" label="How it arrived" required>
        {(aria) => (
          <Select {...aria} name="gateway" defaultValue="BANK_TRANSFER">
            {MANUAL_GATEWAYS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="payment-reference" label="Reference" hint="UTR, cheque number, anything traceable">
        {(aria) => <Input {...aria} name="reference" maxLength={120} />}
      </Field>

      <Field id="payment-received" label="Received on">
        {(aria) => (
          <Input
            {...aria}
            name="receivedAt"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        )}
      </Field>

      <Result state={state} />
      <Submit label="Record payment" />
    </form>
  );
}

export function RefundPayment({
  paymentId,
  amount,
  currency,
}: {
  paymentId: string;
  amount: string;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState<FinanceActionState, FormData>(
    refundPaymentAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-2xs font-medium text-ink-muted underline underline-offset-2 hover:text-brand-red"
      >
        Refund
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-line bg-surface-sunken p-2.5">
      <input type="hidden" name="paymentId" value={paymentId} />

      <p className="text-2xs text-ink-subtle">
        Refunding puts the amount back on the invoice as outstanding. A gateway payment is refunded
        through the gateway; anything else is only recorded here, so move the money yourself.
      </p>

      <label className="block text-2xs text-navy-800" htmlFor={`refund-amount-${paymentId}`}>
        Amount (up to {formatMoney(amount, currency)})
      </label>
      <Input id={`refund-amount-${paymentId}`} name="amount" inputMode="decimal" defaultValue={amount} required />

      <label className="block text-2xs text-navy-800" htmlFor={`refund-reason-${paymentId}`}>
        Reason
      </label>
      <Input id={`refund-reason-${paymentId}`} name="reason" maxLength={500} />

      <Result state={state} />

      <div className="flex gap-2">
        <Submit label="Refund" />
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
