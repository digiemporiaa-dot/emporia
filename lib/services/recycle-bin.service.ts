import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission, requireStaff } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { visibilityFilter } from "@/lib/services/crm.service";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";

/**
 * The recycle bin for leads and clients.
 *
 * Deleting is two steps, as CLAUDE.md §7 asks for soft delete where history
 * matters:
 *
 * 1. **Delete** sets `deletedAt`. The record disappears from every list and
 *    stops being worked on, but nothing is lost: **Restore** brings it back.
 * 2. **Delete permanently**, from the bin only, removes the row for good.
 *
 * A client's financial record outlives it. Invoices, payments and contracts
 * have to be kept (GST, roughly six years), so a client that has any stays in
 * the bin and cannot be removed permanently — the bin says why.
 *
 * Deleting a client stops its work at once rather than leaving it to run:
 * scheduled social posts are cancelled, active retainers paused, and its
 * portal users can no longer sign in (enforced at sign-in and on every
 * request, in `lib/auth` and `lib/actor`). Restoring brings the client back
 * but does not quietly restart any of that: posts are rescheduled and
 * retainers resumed by a person.
 */

const binLog = log("recycle-bin");

/** How many leads one bulk delete may touch. A page of the list, with room. */
export const MAX_BULK_LEADS = 200;

function staffWith(actor: Actor, permission: "leads.delete" | "clients.delete") {
  requireStaff(actor);
  requirePermission(actor, permission);
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/**
 * Move leads to the bin. Leads the actor cannot see, and leads already in the
 * bin, are skipped rather than refused, so a bulk delete over a stale list
 * still does what it can. Returns how many were moved.
 */
export async function deleteLeads(actor: Actor, ids: readonly string[]): Promise<{ deleted: number }> {
  staffWith(actor, "leads.delete");
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new ValidationError("Choose at least one lead.");
  if (unique.length > MAX_BULK_LEADS) {
    throw new ValidationError(`Delete at most ${MAX_BULK_LEADS} leads at a time.`);
  }

  const leads = await db.lead.findMany({
    where: { id: { in: unique }, deletedAt: null, AND: [visibilityFilter(actor)] },
    select: { id: true, name: true, email: true, status: true },
  });
  if (leads.length === 0) return { deleted: 0 };

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) }, deletedAt: null }, data: { deletedAt: now } });
    for (const lead of leads) {
      await record(
        {
          actor,
          action: "DELETE",
          entityType: "Lead",
          entityId: lead.id,
          before: { name: lead.name, email: lead.email, status: lead.status },
          after: { inRecycleBin: true },
        },
        tx,
      );
    }
  });

  binLog.info({ count: leads.length, actorId: actor.userId }, "leads moved to the recycle bin");
  return { deleted: leads.length };
}

async function binnedLead(actor: Actor, id: string) {
  const lead = await db.lead.findFirst({
    where: { id, deletedAt: { not: null }, AND: [visibilityFilter(actor)] },
    select: { id: true, name: true, email: true, status: true },
  });
  if (!lead) throw new NotFoundError("That lead is not in the recycle bin.");
  return lead;
}

export async function restoreLead(actor: Actor, id: string) {
  staffWith(actor, "leads.delete");
  const lead = await binnedLead(actor, id);

  await db.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data: { deletedAt: null } });
    await record({ actor, action: "RESTORE", entityType: "Lead", entityId: id, after: { name: lead.name } }, tx);
  });
  return { id };
}

/**
 * Remove a lead for good. Its notes, tasks, activity and tags go with it;
 * opportunities and proposals raised from it stay, without the link — they
 * are sales records of their own.
 */
export async function purgeLead(actor: Actor, id: string) {
  staffWith(actor, "leads.delete");
  const lead = await binnedLead(actor, id);

  await db.$transaction(async (tx) => {
    await record(
      {
        actor,
        action: "DELETE",
        entityType: "Lead",
        entityId: id,
        before: { name: lead.name, email: lead.email, status: lead.status },
        after: { permanent: true },
      },
      tx,
    );
    await tx.lead.delete({ where: { id } });
  });

  binLog.info({ leadId: id, actorId: actor.userId }, "lead deleted permanently");
  return { id };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** What deleting a client will stop — shown in the confirmation before it happens. */
export async function clientDeletionImpact(actor: Actor, id: string) {
  staffWith(actor, "clients.delete");
  const client = await db.client.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, isInternal: true },
  });
  if (!client) throw new NotFoundError("That client does not exist.");

  const [scheduledPosts, activeRetainers, portalUsers, openInvoices, activeProjects] = await Promise.all([
    db.socialPost.count({ where: { clientId: id, status: "SCHEDULED" } }),
    db.retainer.count({ where: { clientId: id, status: "ACTIVE" } }),
    db.user.count({ where: { clientId: id, type: "CLIENT", status: "ACTIVE" } }),
    db.invoice.count({ where: { clientId: id, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } }),
    db.project.count({ where: { clientId: id, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } } }),
  ]);
  return { ...client, scheduledPosts, activeRetainers, portalUsers, openInvoices, activeProjects };
}

/**
 * Move a client to the bin and stop its work.
 *
 * Refused for the agency's own client: the website, its SEO and its social
 * accounts hang off it.
 */
export async function deleteClient(actor: Actor, id: string) {
  staffWith(actor, "clients.delete");
  const client = await db.client.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, status: true, isInternal: true },
  });
  if (!client) throw new NotFoundError("That client does not exist.");
  if (client.isInternal) {
    throw new ValidationError("This is the agency's own client and cannot be deleted.");
  }

  const result = await db.$transaction(async (tx) => {
    // Conditional on still being live, so two deletes at once stop the work once.
    const { count } = await tx.client.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (count === 0) throw new NotFoundError("That client does not exist.");

    const posts = await tx.socialPost.updateMany({
      where: { clientId: id, status: "SCHEDULED" },
      data: { status: "CANCELLED" },
    });
    const retainers = await tx.retainer.updateMany({
      where: { clientId: id, status: "ACTIVE" },
      data: { status: "PAUSED" },
    });
    // A half-finished account connection would otherwise sit waiting.
    await tx.socialPendingConnection.deleteMany({ where: { clientId: id } });

    const stopped = { scheduledPostsCancelled: posts.count, retainersPaused: retainers.count };
    await record(
      {
        actor,
        action: "DELETE",
        entityType: "Client",
        entityId: id,
        before: { name: client.name, status: client.status },
        after: { inRecycleBin: true, ...stopped },
      },
      tx,
    );
    return stopped;
  });

  binLog.info({ clientId: id, ...result, actorId: actor.userId }, "client moved to the recycle bin");
  return { id, ...result };
}

async function binnedClient(id: string) {
  const client = await db.client.findFirst({
    where: { id, deletedAt: { not: null } },
    select: { id: true, name: true, status: true },
  });
  if (!client) throw new NotFoundError("That client is not in the recycle bin.");
  return client;
}

export async function restoreClient(actor: Actor, id: string) {
  staffWith(actor, "clients.delete");
  const client = await binnedClient(id);

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id }, data: { deletedAt: null } });
    await record({ actor, action: "RESTORE", entityType: "Client", entityId: id, after: { name: client.name } }, tx);
  });
  return { id };
}

/** Why a binned client cannot be removed for good, or an empty list when it can. */
export async function purgeBlockers(clientIds: readonly string[]) {
  const ids = [...clientIds];
  const [invoices, payments, contracts] = await Promise.all([
    // Soft-deleted invoices count too: they are still the record.
    db.invoice.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _count: { _all: true } }),
    db.payment.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _count: { _all: true } }),
    db.contract.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _count: { _all: true } }),
  ]);
  const count = (rows: { clientId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.clientId === id)?._count._all ?? 0;

  return new Map(
    ids.map((id) => {
      const reasons: string[] = [];
      const i = count(invoices, id);
      const p = count(payments, id);
      const c = count(contracts, id);
      if (i) reasons.push(`${i} invoice${i === 1 ? "" : "s"}`);
      if (p) reasons.push(`${p} payment${p === 1 ? "" : "s"}`);
      if (c) reasons.push(`${c} contract${c === 1 ? "" : "s"}`);
      return [id, reasons];
    }),
  );
}

/**
 * Remove a binned client for good, with everything that is only theirs:
 * projects (and their tasks, content and time), retainers, SEO websites and
 * their data, social accounts and posts, onboarding, messages.
 *
 * Refused while invoices, payments or contracts exist. Portal users are not
 * deleted — media and messages may name them as author — but detached,
 * suspended and stripped of their email and password, so nothing of theirs
 * can sign in or be mailed.
 */
export async function purgeClient(actor: Actor, id: string) {
  staffWith(actor, "clients.delete");
  const client = await binnedClient(id);

  const blockers = (await purgeBlockers([id])).get(id) ?? [];
  if (blockers.length > 0) {
    throw new ConflictError(
      `${client.name} has ${blockers.join(", ")}. Financial records must be kept, so it stays in the recycle bin.`,
    );
  }

  await db.$transaction(async (tx) => {
    // Re-checked inside the transaction: an invoice raised a moment ago must
    // not be deleted with the client.
    const [invoices, payments, contracts] = await Promise.all([
      tx.invoice.count({ where: { clientId: id } }),
      tx.payment.count({ where: { clientId: id } }),
      tx.contract.count({ where: { clientId: id } }),
    ]);
    if (invoices + payments + contracts > 0) {
      throw new ConflictError("Financial records were just added for this client. It stays in the recycle bin.");
    }

    const portalUsers = await tx.user.findMany({ where: { clientId: id }, select: { id: true } });
    for (const user of portalUsers) {
      await tx.user.update({
        where: { id: user.id },
        data: {
          clientId: null,
          status: "SUSPENDED",
          email: `removed-${user.id}@deleted.invalid`,
          name: "Removed user",
          passwordHash: null,
        },
      });
    }

    await record(
      {
        actor,
        action: "DELETE",
        entityType: "Client",
        entityId: id,
        before: { name: client.name },
        after: { permanent: true, portalUsersRemoved: portalUsers.length },
      },
      tx,
    );

    // The relations that refuse to cascade, in dependency order, then the
    // client itself; everything else cascades from it.
    await tx.project.deleteMany({ where: { clientId: id } });
    await tx.retainer.deleteMany({ where: { clientId: id } });
    await tx.seoProperty.deleteMany({ where: { clientId: id } });
    await tx.client.delete({ where: { id } });
  });

  binLog.info({ clientId: id, actorId: actor.userId }, "client deleted permanently");
  return { id };
}

// ---------------------------------------------------------------------------
// The bin itself
// ---------------------------------------------------------------------------

const BIN_PAGE = 50;

/** Who moved each entity to the bin, from the audit trail. */
async function deletedBy(entityType: "Lead" | "Client", ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db.auditLog.findMany({
    where: { entityType, entityId: { in: ids }, action: "DELETE" },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, actor: { select: { name: true } } },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.entityId && !map.has(row.entityId) && row.actor) map.set(row.entityId, row.actor.name);
  }
  return map;
}

export async function binnedLeads(actor: Actor, page = 1) {
  staffWith(actor, "leads.delete");
  const where = { deletedAt: { not: null }, AND: [visibilityFilter(actor)] };
  const [total, rows] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy: { deletedAt: "desc" },
      skip: (Math.max(1, page) - 1) * BIN_PAGE,
      take: BIN_PAGE,
      select: { id: true, name: true, email: true, company: true, status: true, deletedAt: true },
    }),
  ]);
  const by = await deletedBy("Lead", rows.map((r) => r.id));
  return {
    total,
    pages: Math.max(1, Math.ceil(total / BIN_PAGE)),
    rows: rows.map((r) => ({ ...r, deletedBy: by.get(r.id) ?? null })),
  };
}

export async function binnedClients(actor: Actor) {
  staffWith(actor, "clients.delete");
  const rows = await db.client.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: 500,
    select: { id: true, name: true, industry: true, deletedAt: true },
  });
  const ids = rows.map((r) => r.id);
  const [by, blockers] = await Promise.all([deletedBy("Client", ids), purgeBlockers(ids)]);
  return rows.map((r) => ({ ...r, deletedBy: by.get(r.id) ?? null, keptBecause: blockers.get(r.id) ?? [] }));
}
