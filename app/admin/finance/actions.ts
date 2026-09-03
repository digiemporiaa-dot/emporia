"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as invoices from "@/lib/services/invoice.service";
import * as paymentsService from "@/lib/services/payment.service";
import * as retainers from "@/lib/services/retainer.service";
import {
  invoiceSchema,
  manualPaymentSchema,
  refundSchema,
  retainerSchema,
} from "@/lib/validation/finance";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("finance");

export type FinanceActionState = ActionResult<{ id: string }> | null;

function refresh(invoiceId?: string) {
  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/invoices");
  revalidatePath("/admin/finance/retainers");
  revalidatePath("/portal/invoices");
  if (invoiceId) revalidatePath(`/admin/finance/invoices/${invoiceId}`);
}

/** Line items travel as JSON so their order and rates survive intact. */
function parseItems(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveInvoiceAction(
  _prev: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = invoiceSchema.safeParse({
      ...raw,
      projectId: raw["projectId"] || null,
      contractId: raw["contractId"] || null,
      retainerId: raw["retainerId"] || null,
      notes: raw["notes"] || null,
      items: parseItems(formData.get("items")),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const invoice = id
      ? await invoices.updateInvoice(actor, id, parsed.data)
      : await invoices.createInvoice(actor, parsed.data);

    refresh(invoice.id);
    return { ok: true, data: { id: invoice.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveInvoice refused");
    return toActionFailure(error);
  }
}

export async function sendInvoiceAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await invoices.sendInvoice(actor, id);
    refresh(id);
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function cancelInvoiceAction(
  id: string,
  reason: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await invoices.cancelInvoice(actor, id, reason || null);
    refresh(id);
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function recordPaymentAction(
  _prev: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = manualPaymentSchema.safeParse({
      ...raw,
      reference: raw["reference"] || null,
      receivedAt: raw["receivedAt"] === "" ? undefined : raw["receivedAt"],
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    const result = await paymentsService.recordManualPayment(actor, parsed.data);
    refresh(parsed.data.invoiceId);
    return { ok: true, data: { id: result.paymentId } };
  } catch (error) {
    actionLog.warn({ err: error }, "recordPayment refused");
    return toActionFailure(error);
  }
}

export async function refundPaymentAction(
  _prev: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireActor();
    const parsed = refundSchema.safeParse({
      paymentId: formData.get("paymentId"),
      amount: formData.get("amount"),
      reason: formData.get("reason") || null,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    await paymentsService.refundPayment(
      actor,
      parsed.data.paymentId,
      parsed.data.amount,
      parsed.data.reason ?? null,
    );

    refresh();
    return { ok: true, data: { id: parsed.data.paymentId } };
  } catch (error) {
    actionLog.warn({ err: error }, "refund refused");
    return toActionFailure(error);
  }
}

export async function saveRetainerAction(
  _prev: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = retainerSchema.safeParse({
      ...raw,
      endsAt: raw["endsAt"] === "" ? null : raw["endsAt"],
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    const retainer = await retainers.createRetainer(actor, parsed.data);
    refresh();
    return { ok: true, data: { id: retainer.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function setRetainerStatusAction(
  id: string,
  status: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    if (status !== "ACTIVE" && status !== "PAUSED" && status !== "CANCELLED") {
      return { ok: false, code: "VALIDATION", message: "That is not a retainer status." };
    }

    await retainers.setRetainerStatus(actor, id, status);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function billRetainersAction(): Promise<ActionResult<{ raised: string[] }>> {
  try {
    const actor = await requireActor();
    const raised = await retainers.billDueRetainers(actor);
    refresh();
    return { ok: true, data: { raised: raised.map((row) => row.number) } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function sendRemindersAction(): Promise<ActionResult<{ sent: string[] }>> {
  try {
    const actor = await requireActor();
    const sent = await retainers.sendPaymentReminders(actor);
    refresh();
    return { ok: true, data: { sent } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function markOverdueAction(): Promise<ActionResult<{ count: number }>> {
  try {
    await requireActor();
    const count = await invoices.markOverdue();
    refresh();
    return { ok: true, data: { count } };
  } catch (error) {
    return toActionFailure(error);
  }
}
