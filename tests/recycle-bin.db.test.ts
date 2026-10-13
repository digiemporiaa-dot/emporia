import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  MAX_BULK_LEADS,
  binnedClients,
  binnedLeads,
  clientDeletionImpact,
  deleteClient,
  deleteLeads,
  purgeClient,
  purgeLead,
  restoreClient,
  restoreLead,
} from "@/lib/services/recycle-bin.service";
import { getLead, listLeads } from "@/lib/services/crm.service";
import { getClient, listClients, acceptProposal } from "@/lib/services/sales.service";
import { listProjects } from "@/lib/services/project.service";
import { publishDuePosts } from "@/lib/services/social-publish.service";
import { resolveClientScope, resolveScopeFilter } from "@/lib/social/scope";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import type { Actor } from "@/lib/actor/types";

/**
 * The recycle bin for leads and clients.
 *
 * A deleted record has to disappear from the work as well as the lists, come
 * back intact when restored, and only be removed for good from the bin — and
 * never take a client's financial record with it.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const TAG = `bin-${Date.now()}`;

function staff(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Admin",
    email: "admin@emporia.test",
    type: "STAFF",
    roleName: "ADMIN",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const ADMIN = [
  "leads.view",
  "leads.view.team",
  "leads.delete",
  "clients.view",
  "clients.create",
  "clients.delete",
  "projects.view",
  "projects.view.team",
  "proposals.edit",
  "social.view",
];

describeDb("recycle bin", () => {
  let staffId = "";
  let admin: Actor;
  let sourceId = "";
  const clients: string[] = [];

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    admin = staff(staffId, ADMIN);
    sourceId = (await db.leadSource.findFirstOrThrow({ select: { id: true } })).id;
  });

  afterAll(async () => {
    await db.lead.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.proposal.deleteMany({ where: { number: { startsWith: TAG } } });
    await db.invoice.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: clients } } });
    await db.project.deleteMany({ where: { clientId: { in: clients } } });
    await db.retainer.deleteMany({ where: { clientId: { in: clients } } });
    await db.seoProperty.deleteMany({ where: { clientId: { in: clients } } });
    await db.user.deleteMany({ where: { email: { endsWith: `-${TAG}@x.test` } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
  });

  const lead = async (name: string) =>
    (await db.lead.create({ data: { name: `${TAG} ${name}`, sourceId }, select: { id: true } })).id;

  async function client(name: string, extra: { isInternal?: boolean } = {}) {
    const row = await db.client.create({
      data: { name: `${TAG} ${name}`, slug: `${TAG}-${name.toLowerCase().replace(/\W+/g, "-")}`, ownerId: staffId, ...extra },
      select: { id: true },
    });
    clients.push(row.id);
    return row.id;
  }

  async function scheduledPost(clientId: string, projectId: string, at = new Date(Date.now() + 3_600_000)) {
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${TAG} post`, channel: "LINKEDIN", stage: "APPROVED" },
      select: { id: true },
    });
    return db.socialPost.create({
      data: { contentItemId: item.id, clientId, provider: "LINKEDIN", type: "TEXT", status: "SCHEDULED", caption: "Hi", hashtags: [], scheduledFor: at },
      select: { id: true },
    });
  }

  const project = async (clientId: string, code: string) =>
    (
      await db.project.create({
        data: { code: `${TAG}-${code}`.slice(0, 20), name: `${TAG} project`, clientId, managerId: staffId, startsAt: new Date() },
        select: { id: true },
      })
    ).id;

  // -------------------------------------------------------------------------
  // Who
  // -------------------------------------------------------------------------

  it("is an admin's job: only ADMIN holds the delete permissions, and nobody else gets in", async () => {
    for (const permission of ["leads.delete", "clients.delete"]) {
      const holders = Object.entries(ROLE_PERMISSIONS)
        .filter(([, list]) => (list as string[]).includes(permission))
        .map(([role]) => role);
      expect(holders).toEqual(["ADMIN"]);
    }

    const id = await lead("Who");
    const sales = staff(staffId, ["leads.view", "leads.view.team", "leads.edit"]);
    await expect(deleteLeads(sales, [id])).rejects.toBeInstanceOf(ForbiddenError);
    const portal: Actor = { ...admin, type: "CLIENT", clientId: clients[0] ?? "c", permissions: new Set(ADMIN) };
    await expect(deleteLeads(portal, [id])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(binnedLeads(sales)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Leads
  // -------------------------------------------------------------------------

  it("moves leads to the bin in bulk: gone from the list and the detail, audited, and repeat-safe", async () => {
    const a = await lead("Bulk A");
    const b = await lead("Bulk B");

    expect(await deleteLeads(admin, [a, b, a])).toEqual({ deleted: 2 });
    // Already in the bin: nothing more to move.
    expect(await deleteLeads(admin, [a])).toEqual({ deleted: 0 });

    const list = await listLeads(admin, { search: `${TAG} Bulk` });
    expect(list.rows.map((r) => r.id)).not.toContain(a);
    await expect(getLead(admin, a)).rejects.toBeInstanceOf(NotFoundError);

    const audit = await db.auditLog.count({ where: { entityType: "Lead", entityId: { in: [a, b] }, action: "DELETE" } });
    expect(audit).toBe(2);

    const bin = await binnedLeads(admin);
    const row = bin.rows.find((r) => r.id === a);
    expect(row?.deletedBy).toBeTruthy();
  });

  it("refuses an empty or oversized bulk delete", async () => {
    await expect(deleteLeads(admin, [])).rejects.toBeInstanceOf(ValidationError);
    const many = Array.from({ length: MAX_BULK_LEADS + 1 }, (_, i) => `x${i}`);
    await expect(deleteLeads(admin, many)).rejects.toBeInstanceOf(ValidationError);
  });

  it("restores a lead to every list as it was", async () => {
    const id = await lead("Restore");
    await db.leadNote.create({ data: { leadId: id, authorId: staffId, body: "Called them" } });
    await deleteLeads(admin, [id]);
    await restoreLead(admin, id);

    const back = await getLead(admin, id);
    expect(back.id).toBe(id);
    expect(await db.leadNote.count({ where: { leadId: id } })).toBe(1);
    // Restoring twice: it is no longer in the bin.
    await expect(restoreLead(admin, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes a lead permanently only from the bin; its proposals outlive it", async () => {
    const id = await lead("Purge");
    await expect(purgeLead(admin, id)).rejects.toBeInstanceOf(NotFoundError);

    const proposal = await db.proposal.create({
      data: { number: `${TAG}-P1`, title: "Retainer", leadId: id, createdById: staffId },
      select: { id: true },
    });
    await deleteLeads(admin, [id]);
    await purgeLead(admin, id);

    expect(await db.lead.count({ where: { id } })).toBe(0);
    const kept = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id }, select: { leadId: true } });
    expect(kept.leadId).toBeNull();
  });

  it("refuses to accept a proposal whose lead is in the bin", async () => {
    const id = await lead("Proposal");
    const proposal = await db.proposal.create({
      data: { number: `${TAG}-P2`, title: "Retainer", leadId: id, status: "SENT", createdById: staffId },
      select: { id: true },
    });
    await deleteLeads(admin, [id]);
    await expect(acceptProposal(admin, proposal.id)).rejects.toBeInstanceOf(ValidationError);
    expect(await db.client.count({ where: { name: `${TAG} Proposal` } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  it("will not delete the agency's own client", async () => {
    const id = await client("Ours", { isInternal: true });
    await expect(deleteClient(admin, id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("deleting a client stops its work and hides it everywhere", async () => {
    const id = await client("Stopping");
    const projectId = await project(id, "STOP");
    const post = await scheduledPost(id, projectId);
    const retainer = await db.retainer.create({
      data: { clientId: id, name: "Monthly", amount: "50000.00", startsAt: new Date(), nextBillingAt: new Date() },
      select: { id: true },
    });

    const impact = await clientDeletionImpact(admin, id);
    expect(impact).toMatchObject({ scheduledPosts: 1, activeRetainers: 1, activeProjects: 1 });

    const result = await deleteClient(admin, id);
    expect(result).toMatchObject({ scheduledPostsCancelled: 1, retainersPaused: 1 });

    expect((await db.socialPost.findUniqueOrThrow({ where: { id: post.id }, select: { status: true } })).status).toBe("CANCELLED");
    expect((await db.retainer.findUniqueOrThrow({ where: { id: retainer.id }, select: { status: true } })).status).toBe("PAUSED");

    // Gone from the client list, the client page, every per-client screen,
    // the project list and the agency-wide social scope.
    expect((await listClients(admin)).map((c) => c.id)).not.toContain(id);
    await expect(getClient(admin, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveClientScope(admin, id)).rejects.toBeInstanceOf(NotFoundError);
    const projects = await listProjects(admin, { search: `${TAG}-STOP` });
    expect(projects.rows.map((p) => p.id)).not.toContain(projectId);
    expect(await resolveScopeFilter(admin, null)).toEqual({ client: { deletedAt: null } });
  });

  it("the scheduler leaves a binned client's posts alone, retries included", async () => {
    const id = await client("Scheduler");
    const projectId = await project(id, "SCHED");
    const post = await scheduledPost(id, projectId, new Date(Date.now() - 60_000));
    await deleteClient(admin, id);
    // Put it back as a due retry, the one path the cancellation does not cover.
    await db.socialPost.update({ where: { id: post.id }, data: { status: "FAILED", attemptCount: 1 } });

    const run = await publishDuePosts(new Date(), async (provider) => new UnconfiguredSocialProvider(provider));
    // Never even attempted: it is not in the run's outcomes at all.
    expect(run.failed.map((f) => f.postId)).not.toContain(post.id);
    const after = await db.socialPost.findUniqueOrThrow({ where: { id: post.id }, select: { status: true, attemptCount: true } });
    expect(after).toEqual({ status: "FAILED", attemptCount: 1 });
  });

  it("restoring a client brings it back but restarts nothing by itself", async () => {
    const id = await client("Restoring");
    const projectId = await project(id, "REST");
    const post = await scheduledPost(id, projectId);
    await deleteClient(admin, id);
    await restoreClient(admin, id);

    expect((await getClient(admin, id)).id).toBe(id);
    expect((await db.socialPost.findUniqueOrThrow({ where: { id: post.id }, select: { status: true } })).status).toBe("CANCELLED");
  });

  it("keeps a client with financial records in the bin, deleted invoices included", async () => {
    const id = await client("Ledger");
    await db.invoice.create({
      data: { clientId: id, number: `${TAG}-INV`, status: "CANCELLED", dueAt: new Date(), total: "100.00", deletedAt: new Date() },
    });
    await deleteClient(admin, id);

    await expect(purgeClient(admin, id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.client.count({ where: { id } })).toBe(1);

    const row = (await binnedClients(admin)).find((c) => c.id === id);
    expect(row?.keptBecause).toEqual(["1 invoice"]);
  });

  it("deletes a client permanently with what is only theirs, and detaches its portal users", async () => {
    const id = await client("Purge");
    await expect(purgeClient(admin, id)).rejects.toBeInstanceOf(NotFoundError);

    const projectId = await project(id, "PURGE");
    await db.projectTask.create({ data: { projectId, title: "Kick-off" } });
    await scheduledPost(id, projectId);
    await db.retainer.create({
      data: { clientId: id, name: "Monthly", amount: "1000.00", startsAt: new Date(), nextBillingAt: new Date() },
    });
    await db.seoProperty.create({ data: { clientId: id, domain: `${TAG}.example`, displayName: "Site" } });
    const roleId = (await db.role.findFirstOrThrow({ where: { name: "CLIENT_USER" }, select: { id: true } })).id;
    const portalUser = await db.user.create({
      data: { email: `purge-${TAG}@x.test`, name: "Portal", type: "CLIENT", status: "ACTIVE", clientId: id, roleId, passwordHash: "x" },
      select: { id: true },
    });

    await deleteClient(admin, id);
    await purgeClient(admin, id);

    expect(await db.client.count({ where: { id } })).toBe(0);
    expect(await db.project.count({ where: { id: projectId } })).toBe(0);
    expect(await db.seoProperty.count({ where: { clientId: id } })).toBe(0);
    const user = await db.user.findUniqueOrThrow({
      where: { id: portalUser.id },
      select: { clientId: true, status: true, email: true, passwordHash: true },
    });
    expect(user).toEqual({ clientId: null, status: "SUSPENDED", email: `removed-${portalUser.id}@deleted.invalid`, passwordHash: null });
    // Clean up the detached user here; it no longer matches the email suffix.
    await db.user.delete({ where: { id: portalUser.id } });
  });
});
