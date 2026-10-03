"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as email from "@/lib/services/email.service";
import * as notifications from "@/lib/services/notification.service";
import * as emailSettings from "@/lib/services/email-settings.service";
import type { SafeEmailSettings } from "@/lib/services/email-settings.service";
import { smtpSettingsSchema, smtpTestSendSchema, templateUpdateSchema, testSendSchema } from "@/lib/validation/email";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("email");

export type EmailActionState = ActionResult<{ message: string }> | null;

export async function saveTemplateAction(
  _prev: EmailActionState,
  formData: FormData,
): Promise<EmailActionState> {
  try {
    const actor = await requireActor();
    const parsed = templateUpdateSchema.safeParse({
      key: formData.get("key"),
      name: formData.get("name"),
      subject: formData.get("subject"),
      html: formData.get("html"),
      text: formData.get("text") || null,
      isActive: formData.get("isActive") === "on",
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    await email.updateTemplate(actor, {
      key: parsed.data.key,
      name: parsed.data.name,
      subject: parsed.data.subject,
      html: parsed.data.html,
      text: parsed.data.text ?? null,
      isActive: parsed.data.isActive,
    });

    revalidatePath("/admin/settings/email");
    revalidatePath(`/admin/settings/email/${parsed.data.key}`);
    return { ok: true, data: { message: "Saved." } };
  } catch (error) {
    actionLog.warn({ err: error }, "template save refused");
    return toActionFailure(error);
  }
}

export async function sendTestAction(
  _prev: EmailActionState,
  formData: FormData,
): Promise<EmailActionState> {
  try {
    const actor = await requireActor();
    const parsed = testSendSchema.safeParse({
      key: formData.get("key"),
      to: formData.get("to"),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the address.",
      };
    }

    const outcome = await email.sendTestEmail(actor, parsed.data.key, parsed.data.to);

    revalidatePath("/admin/settings/email");

    // A failed send is reported as a failure, not a cheerful "sent".
    return outcome.ok
      ? { ok: true, data: { message: `Sent to ${parsed.data.to}.` } }
      : { ok: false, code: "INTEGRATION_NOT_CONFIGURED", message: outcome.error };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Zod's issues as `{ field: [message] }`, for inline errors beside each input. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export async function saveSmtpSettingsAction(input: unknown): Promise<ActionResult<{ settings: SafeEmailSettings; message: string }>> {
  try {
    const actor = await requireActor();
    const parsed = smtpSettingsSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form.", details: fieldErrors(parsed.error.issues) };
    }
    const settings = await emailSettings.saveEmailSettings(actor, parsed.data);
    revalidatePath("/admin/settings/email");
    return { ok: true, data: { settings, message: "Email settings saved successfully." } };
  } catch (error) {
    actionLog.warn({ code: (error as { code?: unknown })?.code }, "smtp settings save refused");
    return toActionFailure(error);
  }
}

/** Test connection: what is in the form now, nothing saved, nothing sent. */
export async function verifySmtpAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  try {
    const actor = await requireActor();
    const parsed = smtpSettingsSchema.safeParse({ ...(input as object), enabled: false });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form.", details: fieldErrors(parsed.error.issues) };
    }
    const result = await emailSettings.verifySmtpSettings(actor, parsed.data);
    return result.ok ? { ok: true, data: { message: result.message } } : { ok: false, code: "INTEGRATION_NOT_CONFIGURED", message: result.message };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Send a test: a real email through the saved settings. */
export async function sendSmtpTestAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  try {
    const actor = await requireActor();
    const parsed = smtpTestSendSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
    const result = await emailSettings.sendSmtpTestEmail(actor, parsed.data.to);
    revalidatePath("/admin/settings/email");
    return result.ok ? { ok: true, data: { message: result.message } } : { ok: false, code: "INTEGRATION_NOT_CONFIGURED", message: result.message };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function retryEmailAction(logId: string): Promise<ActionResult<{ message: string }>> {
  try {
    const actor = await requireActor();
    const outcome = await email.retryEmail(actor, logId);

    revalidatePath("/admin/settings/email");
    return outcome.ok
      ? { ok: true, data: { message: "Sent." } }
      : { ok: false, code: "INTEGRATION_NOT_CONFIGURED", message: outcome.error };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function markNotificationReadAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await notifications.markRead(actor, id);
    revalidatePath("/admin/notifications");
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<{ count: number }>> {
  try {
    const actor = await requireActor();
    const result = await notifications.markAllRead(actor);
    revalidatePath("/admin/notifications");
    return { ok: true, data: { count: result.updated } };
  } catch (error) {
    return toActionFailure(error);
  }
}
