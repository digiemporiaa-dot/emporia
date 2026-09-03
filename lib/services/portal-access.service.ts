import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { hashPassword } from "@/lib/auth/password";
import { env } from "@/lib/config/env";
import { emailPortalInvite } from "@/lib/services/alerts.service";
import type { Actor } from "@/lib/actor/types";
import type { InvitePortalUserInput } from "@/lib/validation/portal";

/**
 * Portal access: staff invite a client's people, and those people activate
 * their own accounts.
 *
 * The invitation is emailed to the invitee, and the outcome of that send is
 * returned alongside the link. If mail is not configured — or the send fails —
 * the caller still has a real, single-use link to pass on by hand, and the
 * failure is visible in the email log rather than swallowed.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteUrl(token: string): string {
  const base = env().SITE_URL.replace(/\/$/, "");
  return `${base}/auth/invite/${token}`;
}

export async function listPortalUsers(actor: Actor, clientId: string) {
  requirePermission(actor, "clients.view");

  return db.user.findMany({
    where: { clientId, type: "CLIENT" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      inviteExpires: true,
    },
  });
}

/**
 * Create (or re-invite) a portal account for one of a client's people.
 *
 * The account is created with no password and status INVITED: it cannot sign in
 * until the invitee sets one, and `authorize` already refuses a passwordless or
 * non-ACTIVE user.
 */
export async function invitePortalUser(actor: Actor, input: InvitePortalUserInput) {
  requirePermission(actor, "users.create");

  const client = await db.client.findFirst({
    where: { id: input.clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new ValidationError("That client does not exist.");

  const role = await db.role.findUnique({ where: { name: "CLIENT_USER" }, select: { id: true } });
  if (!role) throw new ValidationError("The portal role is missing. Run the seed.");

  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, type: true, clientId: true, status: true },
  });

  if (existing && (existing.type !== "CLIENT" || existing.clientId !== input.clientId)) {
    // Never move an account between clients, and never turn a staff account
    // into a portal account: both would hand someone another scope.
    throw new ConflictError("That email address already belongs to another account.");
  }

  const token = newToken();
  const expires = new Date(Date.now() + INVITE_TTL_MS);

  const user = await withAudit(
    {
      actor,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "User",
      entityId: existing?.id ?? input.email,
    },
    (tx) =>
      existing
        ? tx.user.update({
            where: { id: existing.id },
            data: {
              name: input.name,
              inviteToken: token,
              inviteExpires: expires,
              // Re-inviting someone who never activated leaves them INVITED;
              // it never demotes an active account.
              status: existing.status === "ACTIVE" ? "ACTIVE" : "INVITED",
            },
            select: { id: true, email: true, status: true },
          })
        : tx.user.create({
            data: {
              email: input.email,
              name: input.name,
              type: "CLIENT",
              status: "INVITED",
              roleId: role.id,
              clientId: input.clientId,
              inviteToken: token,
              inviteExpires: expires,
            },
            select: { id: true, email: true, status: true },
          }),
  );

  const url = inviteUrl(token);

  const email = await emailPortalInvite({
    to: input.email,
    name: input.name,
    invitedBy: actor.name || "Your account manager",
    inviteUrl: url,
    expiresAt: expires,
  });

  // The link is returned either way: a staff member who sees that the mail
  // failed can still send it themselves.
  return { ...user, inviteUrl: url, expiresAt: expires, email };
}

export async function revokePortalUser(actor: Actor, userId: string) {
  requirePermission(actor, "users.edit");

  const user = await db.user.findFirst({
    where: { id: userId, type: "CLIENT" },
    select: { id: true, status: true, clientId: true },
  });
  if (!user) throw new NotFoundError("That portal account does not exist.");

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "User",
      entityId: userId,
      before: { status: user.status },
    },
    (tx) =>
      tx.user.update({
        where: { id: userId },
        // Suspended, not deleted: their messages, approvals and decisions stay
        // attributable. The session check refuses a non-ACTIVE user at login.
        data: { status: "SUSPENDED", inviteToken: null, inviteExpires: null },
        select: { id: true, status: true },
      }),
  );
}

/** The invitee's own view of their token, before they set a password. */
export async function inviteeFor(token: string) {
  const user = await db.user.findUnique({
    where: { inviteToken: token },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      inviteExpires: true,
      client: { select: { name: true } },
    },
  });

  if (!user || !user.inviteExpires || user.inviteExpires < new Date()) return null;
  if (user.status === "SUSPENDED") return null;

  return user;
}

/**
 * Activate an invited account.
 *
 * The token is single-use: it is cleared in the same update that sets the
 * password, so a leaked link cannot be replayed.
 */
export async function acceptInvite(token: string, password: string, ip: string | null) {
  const user = await db.user.findUnique({
    where: { inviteToken: token },
    select: { id: true, status: true, inviteExpires: true, clientId: true },
  });

  if (!user || !user.inviteExpires || user.inviteExpires < new Date()) {
    throw new ValidationError("That invitation has expired. Ask for a new one.");
  }
  if (user.status === "SUSPENDED") {
    throw new ValidationError("That invitation is no longer valid.");
  }

  const passwordHash = await hashPassword(password);

  const activated = await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      status: "ACTIVE",
      inviteToken: null,
      inviteExpires: null,
    },
    select: { id: true, email: true },
  });

  await record({
    actor: {
      userId: activated.id,
      name: "",
      email: activated.email,
      type: "CLIENT",
      roleName: "CLIENT_USER",
      roleId: null,
      clientId: user.clientId,
      permissions: new Set<string>(),
      ip,
      userAgent: null,
    },
    action: "UPDATE",
    entityType: "User",
    entityId: activated.id,
    after: { status: "ACTIVE", by: "invitee" },
  });

  return activated;
}
