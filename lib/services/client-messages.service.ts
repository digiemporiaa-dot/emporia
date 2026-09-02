import "server-only";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import type { Actor } from "@/lib/actor/types";

/**
 * The agency's side of the client message thread.
 *
 * The portal half lives in portal.service.ts and is scoped by the session's own
 * clientId. Here the client is named explicitly, because staff legitimately
 * work across clients — so the permission check is what stands in for scope.
 */

export async function listMessages(actor: Actor, clientId: string) {
  requirePermission(actor, "clients.view");

  const messages = await db.clientMessage.findMany({
    where: { clientId },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: {
      id: true,
      body: true,
      fromClient: true,
      createdAt: true,
      readAt: true,
      author: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
    },
  });

  // Reading the thread marks the client's messages read.
  await db.clientMessage.updateMany({
    where: { clientId, fromClient: true, readAt: null },
    data: { readAt: new Date() },
  });

  return messages;
}

export async function replyToClient(
  actor: Actor,
  clientId: string,
  body: string,
  projectId: string | null,
) {
  requirePermission(actor, "clients.edit");

  const client = await db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError("That client does not exist.");

  if (projectId) {
    const project = await db.project.findFirst({
      where: { id: projectId, clientId },
      select: { id: true },
    });
    if (!project) throw new ValidationError("That project does not belong to this client.");
  }

  return db.clientMessage.create({
    data: {
      clientId,
      projectId: projectId || null,
      authorId: actor.userId,
      fromClient: false,
      body,
    },
    select: { id: true },
  });
}

/** Unread counts for the admin client list, keyed by client id. */
export async function unreadByClient(actor: Actor) {
  requirePermission(actor, "clients.view");

  const rows = await db.clientMessage.groupBy({
    by: ["clientId"],
    where: { fromClient: true, readAt: null },
    _count: true,
  });

  return new Map(rows.map((row) => [row.clientId, row._count]));
}
