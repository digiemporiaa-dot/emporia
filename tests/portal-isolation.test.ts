import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import * as portal from "@/lib/services/portal.service";
import { requireOwnership, requirePortalActor } from "@/lib/auth/rbac";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * The Phase 10 exit criterion: a client cannot read another client's records by
 * any route, id or parameter manipulation.
 *
 * Two complete clients are built — each with a project, tasks, content, an
 * approval, a proposal, a contract, an invoice, a payment, a campaign and a
 * message — and then every read in the portal service is called by client A
 * with client B's ids. Each must answer NotFound, never the row.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

type Fixture = {
  clientId: string;
  actor: PortalActor;
  projectId: string;
  taskId: string;
  contentItemId: string;
  approvalId: string;
  proposalId: string;
  contractId: string;
  invoiceId: string;
  campaignId: string;
  messageId: string;
};

describeDb("portal client isolation", () => {
  let prisma: PrismaClient;
  let staffId = "";
  let roleId = "";
  let a: Fixture;
  let b: Fixture;

  async function buildClient(label: string): Promise<Fixture> {
    const stamp = `${label}-${Date.now()}`;

    const client = await prisma.client.create({
      data: { name: `Isolation ${label}`, slug: `isolation-${stamp}` },
      select: { id: true },
    });

    const user = await prisma.user.create({
      data: {
        email: `portal-${stamp}@isolation.test`,
        name: `Portal ${label}`,
        passwordHash: "not-a-real-hash",
        type: "CLIENT",
        status: "ACTIVE",
        roleId,
        clientId: client.id,
      },
      select: { id: true },
    });

    const project = await prisma.project.create({
      data: {
        code: `PRJ-ISO-${stamp}`.slice(0, 40),
        name: `Isolation project ${label}`,
        clientId: client.id,
        managerId: staffId,
        status: "ACTIVE",
        budget: "100000.00",
        startsAt: new Date(),
      },
      select: { id: true },
    });

    const task = await prisma.projectTask.create({
      data: { projectId: project.id, title: `Task ${label}`, status: "TODO" },
      select: { id: true },
    });

    const contentItem = await prisma.contentCalendarItem.create({
      data: {
        projectId: project.id,
        clientId: client.id,
        channel: "INSTAGRAM",
        title: `Post ${label}`,
        stage: "CLIENT_REVIEW",
      },
      select: { id: true },
    });

    const approval = await prisma.approval.create({
      data: {
        clientId: client.id,
        projectId: project.id,
        contentItemId: contentItem.id,
        title: `Approval ${label}`,
        status: "PENDING",
        currentVersion: 1,
        requestedById: staffId,
        versions: {
          create: { version: 1, status: "PENDING", createdById: staffId, notes: `v1 ${label}` },
        },
      },
      select: { id: true },
    });

    const proposal = await prisma.proposal.create({
      data: {
        number: `PRO-ISO-${stamp}`.slice(0, 40),
        title: `Proposal ${label}`,
        clientId: client.id,
        status: "SENT",
        currency: "INR",
        subtotal: "1000.00",
        discountTotal: "0.00",
        taxTotal: "180.00",
        total: "1180.00",
        createdById: staffId,
        sentAt: new Date(),
        items: {
          create: {
            name: "Retainer",
            quantity: "1",
            unitPrice: "1000.00",
            discountRate: "0",
            taxRate: "18",
            lineTotal: "1180.00",
            order: 0,
          },
        },
      },
      select: { id: true },
    });

    const contract = await prisma.contract.create({
      data: {
        number: `CON-ISO-${stamp}`.slice(0, 40),
        clientId: client.id,
        title: `Contract ${label}`,
        status: "ACTIVE",
        value: "1180.00",
        startsAt: new Date(),
      },
      select: { id: true },
    });

    const invoice = await prisma.invoice.create({
      data: {
        number: `INV-ISO-${stamp}`.slice(0, 40),
        clientId: client.id,
        status: "SENT",
        dueAt: new Date(),
        subtotal: "1000.00",
        taxTotal: "180.00",
        total: "1180.00",
        paidTotal: "0.00",
        dueTotal: "1180.00",
      },
      select: { id: true },
    });

    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        clientId: client.id,
        amount: "1180.00",
        status: "CAPTURED",
        gateway: "BANK_TRANSFER",
        idempotencyKey: `iso-${stamp}`,
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: `Campaign ${label}`,
        clientId: client.id,
        platform: "GOOGLE_ADS",
        ownerId: staffId,
        status: "ACTIVE",
        budget: "50000.00",
        startsAt: new Date(),
      },
      select: { id: true },
    });

    const message = await prisma.clientMessage.create({
      data: {
        clientId: client.id,
        authorId: staffId,
        fromClient: false,
        body: `Hello ${label}`,
      },
      select: { id: true },
    });

    const actor: PortalActor = {
      userId: user.id,
      name: `Portal ${label}`,
      email: `portal-${stamp}@isolation.test`,
      type: "CLIENT",
      roleName: "CLIENT_USER",
      roleId,
      clientId: client.id,
      permissions: new Set<string>(),
      ip: null,
      userAgent: null,
    };

    return {
      clientId: client.id,
      actor,
      projectId: project.id,
      taskId: task.id,
      contentItemId: contentItem.id,
      approvalId: approval.id,
      proposalId: proposal.id,
      contractId: contract.id,
      invoiceId: invoice.id,
      campaignId: campaign.id,
      messageId: message.id,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const staff = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });
    staffId = staff.id;

    const role = await prisma.role.findUniqueOrThrow({
      where: { name: "CLIENT_USER" },
      select: { id: true },
    });
    roleId = role.id;

    a = await buildClient("A");
    b = await buildClient("B");
  });

  afterAll(async () => {
    const clientIds = [a.clientId, b.clientId];
    await prisma.clientMessage.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.payment.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.invoice.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.campaign.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.approvalVersion.deleteMany({
      where: { approval: { clientId: { in: clientIds } } },
    });
    await prisma.approval.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.contentCalendarItem.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.projectTask.deleteMany({ where: { project: { clientId: { in: clientIds } } } });
    await prisma.project.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.contract.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.proposalItem.deleteMany({
      where: { proposal: { clientId: { in: clientIds } } },
    });
    await prisma.proposal.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.$disconnect();
  });

  // ── Each client sees only its own ───────────────────────────────────────

  it("shows each client only its own records", async () => {
    const [projectsA, projectsB] = await Promise.all([
      portal.listProjects(a.actor),
      portal.listProjects(b.actor),
    ]);

    expect(projectsA).toHaveLength(1);
    expect(projectsB).toHaveLength(1);
    expect(projectsA[0]?.id).toBe(a.projectId);
    expect(projectsB[0]?.id).toBe(b.projectId);

    const contentA = await portal.listContent(a.actor);
    expect(contentA.map((item) => item.id)).toEqual([a.contentItemId]);

    const approvalsA = await portal.listApprovals(a.actor);
    expect(approvalsA.map((row) => row.id)).toEqual([a.approvalId]);

    const proposalsA = await portal.listProposals(a.actor);
    expect(proposalsA.map((row) => row.id)).toEqual([a.proposalId]);

    const contractsA = await portal.listContracts(a.actor);
    expect(contractsA.map((row) => row.id)).toEqual([a.contractId]);

    const invoicesA = await portal.listInvoices(a.actor);
    expect(invoicesA.map((row) => row.id)).toEqual([a.invoiceId]);

    const paymentsA = await portal.listPayments(a.actor);
    expect(paymentsA).toHaveLength(1);

    const campaignsA = await portal.listCampaigns(a.actor);
    expect(campaignsA.map((row) => row.id)).toEqual([a.campaignId]);

    const messagesA = await portal.listMessages(a.actor);
    expect(messagesA.map((row) => row.id)).toEqual([a.messageId]);
  });

  it("counts only its own on the dashboard", async () => {
    const data = await portal.dashboard(a.actor);
    expect(data.client.id).toBe(a.clientId);
    expect(data.projects).toHaveLength(1);
    expect(data.openApprovals).toBe(1);
    expect(data.outstandingInvoices).toBe(1);
    expect(data.outstandingTotal).toBe("1180.00");
    expect(data.contentAwaitingReview).toBe(1);
  });

  // ── Another client's id is a 404, never a 403 ───────────────────────────

  it("refuses another client's project by id", async () => {
    await expect(portal.getProject(a.actor, b.projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(portal.getProject(b.actor, a.projectId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses another client's approval by id", async () => {
    await expect(portal.getApproval(a.actor, b.approvalId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses another client's proposal by id", async () => {
    await expect(portal.getProposal(a.actor, b.proposalId)).rejects.toBeInstanceOf(NotFoundError);

    // And the refusal must not have moved the other client's proposal on.
    const untouched = await prisma.proposal.findUniqueOrThrow({
      where: { id: b.proposalId },
      select: { status: true },
    });
    expect(untouched.status).toBe("SENT");
  });

  it("refuses to decide another client's approval", async () => {
    await expect(
      portal.decideApproval(a.actor, b.approvalId, "APPROVED", null),
    ).rejects.toBeInstanceOf(NotFoundError);

    const untouched = await prisma.approval.findUniqueOrThrow({
      where: { id: b.approvalId },
      select: { status: true, decidedById: true },
    });
    expect(untouched.status).toBe("PENDING");
    expect(untouched.decidedById).toBeNull();
  });

  it("refuses to attach a message to another client's project", async () => {
    await expect(
      portal.sendMessage(a.actor, { body: "Trying it on", projectId: b.projectId }),
    ).rejects.toBeInstanceOf(ValidationError);

    const leaked = await prisma.clientMessage.count({ where: { projectId: b.projectId } });
    expect(leaked).toBe(0);
  });

  it("writes a message under the session's own client, whatever is asked for", async () => {
    const message = await portal.sendMessage(a.actor, { body: "Hello from A", projectId: null });

    const row = await prisma.clientMessage.findUniqueOrThrow({
      where: { id: message.id },
      select: { clientId: true, fromClient: true, authorId: true },
    });

    expect(row.clientId).toBe(a.clientId);
    expect(row.fromClient).toBe(true);
    expect(row.authorId).toBe(a.actor.userId);
  });

  // ── Forged sessions ────────────────────────────────────────────────────

  it("refuses a session that claims another client's user id", async () => {
    // The id of B's portal user with A's clientId: the profile lookup is scoped
    // by both, so it resolves to nothing rather than to B's account.
    const forged: PortalActor = { ...a.actor, userId: b.actor.userId };
    await expect(portal.getProfile(forged)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a staff actor at the type level", () => {
    const staffActor: Actor = {
      userId: staffId,
      name: "Staff",
      email: "staff@example.test",
      type: "STAFF",
      roleName: "ADMIN",
      roleId,
      clientId: null,
      permissions: new Set(["clients.view"]),
      ip: null,
      userAgent: null,
    };

    expect(() => requirePortalActor(staffActor)).toThrow(ForbiddenError);
    expect(() => requireOwnership(staffActor, a.clientId)).toThrow(ForbiddenError);
  });

  it("refuses ownership of another client", () => {
    expect(() => requireOwnership(a.actor, b.clientId)).toThrow(ForbiddenError);
    expect(() => requireOwnership(a.actor, a.clientId)).not.toThrow();
  });

  it("refuses an unauthenticated caller", () => {
    expect(() => requirePortalActor(null)).toThrow();
  });

  // ── Portal-specific rules ──────────────────────────────────────────────

  it("hides drafts: a proposal that was never sent is not visible", async () => {
    const draft = await prisma.proposal.create({
      data: {
        number: `PRO-DRAFT-${Date.now()}`,
        title: "Draft nobody should see",
        clientId: a.clientId,
        status: "DRAFT",
        currency: "INR",
        subtotal: "0",
        discountTotal: "0",
        taxTotal: "0",
        total: "0",
        createdById: staffId,
      },
      select: { id: true },
    });

    const listed = await portal.listProposals(a.actor);
    expect(listed.map((row) => row.id)).not.toContain(draft.id);
    await expect(portal.getProposal(a.actor, draft.id)).rejects.toBeInstanceOf(NotFoundError);

    await prisma.proposal.delete({ where: { id: draft.id } });
  });

  it("hides content that has not reached the client yet", async () => {
    const internal = await prisma.contentCalendarItem.create({
      data: {
        projectId: a.projectId,
        clientId: a.clientId,
        channel: "BLOG",
        title: "Internal draft",
        stage: "DRAFT",
      },
      select: { id: true },
    });

    const listed = await portal.listContent(a.actor);
    expect(listed.map((item) => item.id)).not.toContain(internal.id);

    await prisma.contentCalendarItem.delete({ where: { id: internal.id } });
  });

  it("records VIEWED when the client opens a sent proposal", async () => {
    const before = await prisma.proposal.findUniqueOrThrow({
      where: { id: a.proposalId },
      select: { status: true },
    });
    expect(before.status).toBe("SENT");

    const opened = await portal.getProposal(a.actor, a.proposalId);
    expect(opened.status).toBe("VIEWED");

    const after = await prisma.proposal.findUniqueOrThrow({
      where: { id: a.proposalId },
      select: { status: true },
    });
    expect(after.status).toBe("VIEWED");
  });

  it("lets a client decide its own approval, once", async () => {
    const decided = await portal.decideApproval(
      a.actor,
      a.approvalId,
      "CHANGES_REQUESTED",
      "Please redo the second frame.",
    );
    expect(decided.status).toBe("CHANGES_REQUESTED");

    const version = await prisma.approvalVersion.findFirstOrThrow({
      where: { approvalId: a.approvalId, version: 1 },
      select: { status: true, feedback: true },
    });
    expect(version.status).toBe("CHANGES_REQUESTED");
    expect(version.feedback).toBe("Please redo the second frame.");

    await expect(
      portal.decideApproval(a.actor, a.approvalId, "APPROVED", null),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("requires a reason when asking for changes", async () => {
    const fresh = await prisma.approval.create({
      data: {
        clientId: a.clientId,
        projectId: a.projectId,
        title: "Second approval",
        status: "PENDING",
        currentVersion: 1,
        requestedById: staffId,
        versions: { create: { version: 1, status: "PENDING", createdById: staffId } },
      },
      select: { id: true },
    });

    await expect(
      portal.decideApproval(a.actor, fresh.id, "CHANGES_REQUESTED", null),
    ).rejects.toBeInstanceOf(ValidationError);

    await prisma.approvalVersion.deleteMany({ where: { approvalId: fresh.id } });
    await prisma.approval.delete({ where: { id: fresh.id } });
  });

  it("marks the agency's messages read when the client opens the thread", async () => {
    await portal.listMessages(a.actor);

    const unread = await prisma.clientMessage.count({
      where: { clientId: a.clientId, fromClient: false, readAt: null },
    });
    expect(unread).toBe(0);

    // B's thread is untouched by A reading theirs.
    const unreadB = await prisma.clientMessage.count({
      where: { clientId: b.clientId, fromClient: false, readAt: null },
    });
    expect(unreadB).toBe(1);
  });
});
