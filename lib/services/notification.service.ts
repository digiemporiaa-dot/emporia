import "server-only";
import { db } from "@/lib/db";
import { IntegrationNotConfiguredError, NotFoundError } from "@/lib/errors";
import { sendTemplate } from "@/lib/services/email.service";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { EmailTemplateKey, NotificationChannel } from "@/generated/prisma/enums";

/**
 * Notifications.
 *
 * In-app is a row; email goes through the one EmailService and is logged there.
 * WhatsApp, SMS and push are declared in the schema and deliberately refused
 * here: selecting one raises a typed "channel not configured" error rather than
 * quietly succeeding, so nobody builds a workflow on a channel that does not
 * deliver (CLAUDE.md 3, and 2 rule 5).
 */

const notifyLog = log("notify");

export type NotifyInput = {
  userId: string;
  title: string;
  body?: string | null;
  href?: string | null;
  entity?: { type: string; id: string } | null;
};

/** An in-app notification. Always available, never fails a caller's work. */
export async function notify(input: NotifyInput) {
  return db.notification.create({
    data: {
      userId: input.userId,
      channel: "IN_APP",
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
    },
    select: { id: true },
  });
}

/**
 * Notify someone in the app and by email, from one call.
 *
 * The in-app row is written first and never depends on the mail going out; the
 * email result is returned so a caller that cares can look.
 */
export async function notifyWithEmail(
  input: NotifyInput & { templateKey: EmailTemplateKey; variables: Record<string, string> },
) {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, status: true },
  });
  if (!user) throw new NotFoundError("That user does not exist.");

  const notification = await notify(input);

  // A suspended account still gets the in-app row for the record, but no mail.
  if (user.status !== "ACTIVE") {
    return { notification, email: null };
  }

  const email = await sendTemplate(input.templateKey, {
    to: user.email,
    variables: input.variables,
    entity: input.entity ?? null,
  });

  if (!email.ok) {
    notifyLog.warn({ userId: user.id, error: email.error }, "notification email failed");
  }

  return { notification, email };
}

/**
 * Channels that are architected but not implemented.
 *
 * Called with WHATSAPP, SMS or PUSH, this throws. It exists so the failure is
 * typed and loud at the call site instead of a silent no-op.
 */
export function assertChannelAvailable(channel: NotificationChannel): void {
  if (channel === "IN_APP" || channel === "EMAIL") return;

  throw new IntegrationNotConfiguredError(
    `${channel.toLowerCase()} notifications are not implemented. Use in-app or email.`,
  );
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listNotifications(actor: Actor, limit = 20) {
  return db.notification.findMany({
    // Scoped to the caller by construction: there is no parameter for whose
    // notifications to read.
    where: { userId: actor.userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    select: {
      id: true,
      title: true,
      body: true,
      href: true,
      readAt: true,
      createdAt: true,
      entityType: true,
      entityId: true,
    },
  });
}

export async function unreadCount(actor: Actor): Promise<number> {
  return db.notification.count({ where: { userId: actor.userId, readAt: null } });
}

export async function markRead(actor: Actor, id: string) {
  // Scoped by userId as well as id, so another user's notification is not
  // reachable by guessing.
  const result = await db.notification.updateMany({
    where: { id, userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });

  return { updated: result.count };
}

export async function markAllRead(actor: Actor) {
  const result = await db.notification.updateMany({
    where: { userId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });

  return { updated: result.count };
}
