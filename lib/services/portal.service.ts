import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { div, mul, toMoneyString } from "@/lib/money";
import { rangeFilter, type DateRange } from "@/lib/analytics/range";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { PortalActor } from "@/lib/actor/types";
import type { PortalMessageInput, PortalProfileInput } from "@/lib/validation/portal";
import type { ProposalStatus } from "@/generated/prisma/enums";

/**
 * The client portal's only data access.
 *
 * The rule this module exists to enforce: **every query is scoped by
 * `actor.clientId`, taken from the session, and no function here accepts a
 * client id from its caller** (CLAUDE.md 2 rule 3). A record id supplied by the
 * browser is always resolved together with that scope, so another client's row
 * is indistinguishable from one that does not exist — a 404, never a 403 that
 * confirms it is there.
 *
 * `PortalActor` has a non-nullable `clientId`, so a staff actor cannot be
 * passed into any of this by accident: the type system rejects it.
 */

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function dashboard(actor: PortalActor) {
  const clientId = actor.clientId;

  const [client, projects, openApprovals, unreadMessages, invoices, contentDue] = await Promise.all([
    db.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { id: true, name: true, status: true, createdAt: true },
    }),
    db.project.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        health: true,
        dueAt: true,
        _count: { select: { tasks: true } },
      },
    }),
    db.approval.count({ where: { clientId, status: "PENDING" } }),
    db.clientMessage.count({ where: { clientId, fromClient: false, readAt: null } }),
    db.invoice.aggregate({
      where: { clientId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      _sum: { dueTotal: true },
      _count: true,
    }),
    db.contentCalendarItem.count({
      where: { clientId, stage: "CLIENT_REVIEW" },
    }),
  ]);

  if (!client) throw new NotFoundError("That account is no longer active.");

  return {
    client,
    projects,
    openApprovals,
    unreadMessages,
    contentAwaitingReview: contentDue,
    outstandingInvoices: invoices._count,
    // Money leaves as a fixed-precision string; a Decimal would not survive the
    // RSC boundary and must never become a JS number.
    outstandingTotal: toMoneyString(invoices._sum.dueTotal ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Projects and tasks
// ---------------------------------------------------------------------------

export async function listProjects(actor: PortalActor) {
  const rows = await db.project.findMany({
    where: { clientId: actor.clientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      health: true,
      startsAt: true,
      dueAt: true,
      completedAt: true,
      service: { select: { name: true } },
      manager: { select: { name: true } },
      _count: { select: { tasks: true, milestones: true } },
    },
  });

  return rows;
}

export async function getProject(actor: PortalActor, id: string) {
  // Resolved by id AND clientId together: another client's project is a
  // NotFoundError, exactly like one that does not exist.
  const project = await db.project.findFirst({
    where: { id, clientId: actor.clientId },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      health: true,
      startsAt: true,
      dueAt: true,
      completedAt: true,
      service: { select: { name: true } },
      manager: { select: { name: true } },
      milestones: {
        orderBy: [{ order: "asc" }, { dueAt: "asc" }],
        select: { id: true, title: true, dueAt: true, status: true },
      },
      tasks: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          parentId: true,
          milestone: { select: { id: true, title: true } },
        },
      },
    },
  });

  if (!project) throw new NotFoundError("That project does not exist.");

  // Deliberately omitted: budget, time entries, internal comments, assignee
  // names and estimates. The portal shows progress, not the agency's costs or
  // who is working on what.
  return project;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export async function listContent(actor: PortalActor) {
  return db.contentCalendarItem.findMany({
    where: {
      clientId: actor.clientId,
      // Ideas and internal drafts are not the client's business until the work
      // is put in front of them.
      stage: { in: ["CLIENT_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"] },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
    take: 300,
    select: {
      id: true,
      channel: true,
      title: true,
      brief: true,
      stage: true,
      scheduledFor: true,
      publishedAt: true,
      project: { select: { id: true, code: true, name: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function listApprovals(actor: PortalActor) {
  return db.approval.findMany({
    where: { clientId: actor.clientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      currentVersion: true,
      createdAt: true,
      decidedAt: true,
      project: { select: { id: true, code: true, name: true } },
      contentItem: { select: { id: true, title: true, channel: true } },
    },
  });
}

export async function getApproval(actor: PortalActor, id: string) {
  const approval = await db.approval.findFirst({
    where: { id, clientId: actor.clientId },
    select: {
      id: true,
      title: true,
      status: true,
      currentVersion: true,
      createdAt: true,
      decidedAt: true,
      project: { select: { id: true, code: true, name: true } },
      contentItem: { select: { id: true, title: true, channel: true } },
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          notes: true,
          status: true,
          feedback: true,
          createdAt: true,
          // The creative itself. Only the file, never who uploaded it.
          media: { select: { id: true, url: true, filename: true, type: true, alt: true } },
        },
      },
    },
  });

  if (!approval) throw new NotFoundError("That approval does not exist.");
  return approval;
}

/**
 * The client's own decision on the current version.
 *
 * This is the same row a staff decision writes, so the two cannot disagree.
 * A client may approve or ask for changes; rejecting outright is a
 * conversation, not a button.
 */
export async function decideApproval(
  actor: PortalActor,
  approvalId: string,
  decision: "APPROVED" | "CHANGES_REQUESTED",
  feedback: string | null,
) {
  const approval = await db.approval.findFirst({
    where: { id: approvalId, clientId: actor.clientId },
    select: { id: true, status: true, currentVersion: true, contentItemId: true },
  });

  if (!approval) throw new NotFoundError("That approval does not exist.");
  if (approval.status !== "PENDING") {
    throw new ConflictError("That version has already been decided.");
  }
  if (decision === "CHANGES_REQUESTED" && !feedback) {
    throw new ValidationError("Say what needs to change.");
  }

  const result = await db.$transaction(async (tx) => {
    await tx.approvalVersion.update({
      where: { approvalId_version: { approvalId, version: approval.currentVersion } },
      data: { status: decision, feedback },
    });

    return tx.approval.update({
      where: { id: approvalId },
      data: { status: decision, decidedById: actor.userId, decidedAt: new Date() },
      select: { id: true, status: true },
    });
  });

  await record({
    actor,
    action: "STATUS_CHANGE",
    entityType: "Approval",
    entityId: approvalId,
    before: { status: approval.status },
    after: { status: decision, by: "client" },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Documents: proposals and contracts
// ---------------------------------------------------------------------------

/** Proposals the client has actually been sent — never a draft. */
const VISIBLE_PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "SENT",
  "VIEWED",
  "NEGOTIATION",
  "ACCEPTED",
  "REJECTED",
];

export async function listProposals(actor: PortalActor) {
  const rows = await db.proposal.findMany({
    where: { clientId: actor.clientId, status: { in: [...VISIBLE_PROPOSAL_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      currency: true,
      total: true,
      sentAt: true,
      validUntil: true,
    },
  });

  return rows.map((row) => ({ ...row, total: toMoneyString(row.total) }));
}

/**
 * A proposal as the client sees it.
 *
 * Opening it is what moves a SENT proposal to VIEWED — the Phase 8 lifecycle
 * says VIEWED is recorded by the client opening the document and is never set
 * by staff.
 */
export async function getProposal(actor: PortalActor, id: string) {
  const proposal = await db.proposal.findFirst({
    where: { id, clientId: actor.clientId, status: { in: [...VISIBLE_PROPOSAL_STATUSES] } },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      currency: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      total: true,
      sentAt: true,
      validUntil: true,
      items: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          quantity: true,
          unitPrice: true,
          discountRate: true,
          taxRate: true,
          lineTotal: true,
        },
      },
    },
  });

  if (!proposal) throw new NotFoundError("That proposal does not exist.");

  if (proposal.status === "SENT") {
    await db.proposal.update({ where: { id: proposal.id }, data: { status: "VIEWED" } });
    await record({
      actor,
      action: "STATUS_CHANGE",
      entityType: "Proposal",
      entityId: proposal.id,
      before: { status: "SENT" },
      after: { status: "VIEWED", by: "client" },
    });
  }

  return {
    ...proposal,
    status: proposal.status === "SENT" ? ("VIEWED" as const) : proposal.status,
    subtotal: toMoneyString(proposal.subtotal),
    discountTotal: toMoneyString(proposal.discountTotal),
    taxTotal: toMoneyString(proposal.taxTotal),
    total: toMoneyString(proposal.total),
    items: proposal.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: toMoneyString(item.unitPrice),
      discountRate: item.discountRate.toString(),
      taxRate: item.taxRate.toString(),
      lineTotal: toMoneyString(item.lineTotal),
    })),
  };
}

export async function listContracts(actor: PortalActor) {
  const rows = await db.contract.findMany({
    where: { clientId: actor.clientId, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      currency: true,
      value: true,
      startsAt: true,
      endsAt: true,
      renewalAt: true,
      signedAt: true,
      terms: true,
      document: { select: { id: true, filename: true, url: true } },
    },
  });

  return rows.map((row) => ({ ...row, value: toMoneyString(row.value) }));
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export async function listInvoices(actor: PortalActor) {
  const rows = await db.invoice.findMany({
    where: { clientId: actor.clientId, deletedAt: null, status: { not: "DRAFT" } },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      issuedAt: true,
      dueAt: true,
      total: true,
      paidTotal: true,
      dueTotal: true,
      project: { select: { id: true, code: true, name: true } },
    },
  });

  return rows.map((row) => ({
    ...row,
    total: toMoneyString(row.total),
    paidTotal: toMoneyString(row.paidTotal),
    dueTotal: toMoneyString(row.dueTotal),
  }));
}

export async function listPayments(actor: PortalActor) {
  const rows = await db.payment.findMany({
    where: { clientId: actor.clientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      gateway: true,
      gatewayPaymentId: true,
      receivedAt: true,
      createdAt: true,
      invoice: { select: { id: true, number: true } },
    },
  });

  return rows.map((row) => ({ ...row, amount: toMoneyString(row.amount) }));
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(actor: PortalActor) {
  const rows = await db.campaign.findMany({
    where: { clientId: actor.clientId },
    orderBy: { startsAt: "desc" },
    select: {
      id: true,
      name: true,
      platform: true,
      objective: true,
      status: true,
      startsAt: true,
      endsAt: true,
      budget: true,
      currency: true,
      _count: { select: { metrics: true } },
    },
  });

  return rows.map((row) => ({ ...row, budget: toMoneyString(row.budget) }));
}

/**
 * Performance for the client's own campaigns.
 *
 * Scoped by the session's `clientId` like every other portal query, and built
 * only from metrics somebody recorded. A campaign with no data reports no data
 * — the client is never shown a modelled or estimated figure
 * (CLAUDE.md 2 rules 3 and 5).
 */
export async function campaignReport(actor: PortalActor, range: DateRange) {
  const campaigns = await db.campaign.findMany({
    where: { clientId: actor.clientId },
    orderBy: { startsAt: "desc" },
    select: { id: true, name: true, currency: true },
  });

  if (campaigns.length === 0) return [];

  const metrics = await db.campaignMetric.groupBy({
    by: ["campaignId"],
    where: {
      // Restricted to this client's campaigns, not merely filtered afterwards.
      campaignId: { in: campaigns.map((campaign) => campaign.id) },
      date: rangeFilter(range),
    },
    _sum: { impressions: true, clicks: true, conversions: true, spend: true, revenue: true },
    _count: { _all: true },
  });

  const byId = new Map(metrics.map((row) => [row.campaignId, row]));

  return campaigns.map((campaign) => {
    const metric = byId.get(campaign.id);
    const impressions = metric?._sum.impressions ?? 0;
    const clicks = metric?._sum.clicks ?? 0;

    return {
      id: campaign.id,
      days: metric?._count._all ?? 0,
      impressions,
      clicks,
      conversions: metric?._sum.conversions ?? 0,
      spend: toMoneyString(metric?._sum.spend?.toString() ?? "0"),
      // Null, not zero: nobody measuring revenue is a different statement from
      // measuring none.
      revenue: metric?._sum.revenue == null ? null : toMoneyString(metric._sum.revenue.toString()),
      ctr: impressions === 0 ? null : mul(div(clicks, impressions), 100).toFixed(2),
    };
  });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Files reachable from the client's own records.
 *
 * Media has no client column — a file belongs to the record it is attached to —
 * so this walks the client's contracts, approvals and content items rather than
 * inventing an ownership link. Until the media library is built (phase 11)
 * nothing is attached, and the honest result is an empty list.
 */
export async function listFiles(actor: PortalActor) {
  const clientId = actor.clientId;

  const [contracts, approvalVersions, contentItems] = await Promise.all([
    db.contract.findMany({
      // The same visibility rule as listContracts: a draft contract is not the
      // client's business, and neither is the document attached to it.
      where: { clientId, documentId: { not: null }, status: { not: "DRAFT" } },
      select: {
        number: true,
        title: true,
        document: { select: { id: true, filename: true, url: true, size: true, createdAt: true } },
      },
    }),
    db.approvalVersion.findMany({
      where: { approval: { clientId }, mediaId: { not: null } },
      select: {
        version: true,
        approval: { select: { id: true, title: true } },
        media: { select: { id: true, filename: true, url: true, size: true, createdAt: true } },
      },
    }),
    db.contentCalendarItem.findMany({
      where: {
        clientId,
        mediaId: { not: null },
        stage: { in: ["CLIENT_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"] },
      },
      select: {
        title: true,
        media: { select: { id: true, filename: true, url: true, size: true, createdAt: true } },
      },
    }),
  ]);

  const files = [
    ...contracts.flatMap((row) =>
      row.document ? [{ ...row.document, context: `Contract ${row.number}` }] : [],
    ),
    ...approvalVersions.flatMap((row) =>
      row.media ? [{ ...row.media, context: `${row.approval.title} v${row.version}` }] : [],
    ),
    ...contentItems.flatMap((row) => (row.media ? [{ ...row.media, context: row.title }] : [])),
  ];

  return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function listMessages(actor: PortalActor) {
  const messages = await db.clientMessage.findMany({
    where: { clientId: actor.clientId },
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

  // Opening the thread marks the agency's side read; the client's own messages
  // are marked read by the staff view.
  await db.clientMessage.updateMany({
    where: { clientId: actor.clientId, fromClient: false, readAt: null },
    data: { readAt: new Date() },
  });

  return messages;
}

export async function sendMessage(actor: PortalActor, input: PortalMessageInput) {
  if (input.projectId) {
    const project = await db.project.findFirst({
      where: { id: input.projectId, clientId: actor.clientId },
      select: { id: true },
    });
    if (!project) throw new ValidationError("That project does not exist.");
  }

  return db.clientMessage.create({
    data: {
      clientId: actor.clientId,
      projectId: input.projectId || null,
      authorId: actor.userId,
      fromClient: true,
      body: input.body,
    },
    select: { id: true },
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(actor: PortalActor) {
  const user = await db.user.findFirst({
    // Scoped by clientId as well as id: a session claiming another client's
    // user could not reach it even if the id were guessed.
    where: { id: actor.userId, clientId: actor.clientId, type: "CLIENT" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      lastLoginAt: true,
      client: { select: { id: true, name: true } },
    },
  });

  if (!user) throw new NotFoundError("That account does not exist.");
  return user;
}

export async function updateProfile(actor: PortalActor, input: PortalProfileInput) {
  const user = await db.user.findFirst({
    where: { id: actor.userId, clientId: actor.clientId, type: "CLIENT" },
    select: { id: true, name: true, phone: true },
  });
  if (!user) throw new NotFoundError("That account does not exist.");

  const updated = await db.user.update({
    where: { id: user.id },
    data: { name: input.name, phone: input.phone ?? null },
    select: { id: true },
  });

  await record({
    actor,
    action: "UPDATE",
    entityType: "User",
    entityId: user.id,
    before: { name: user.name, phone: user.phone },
    after: { name: input.name, phone: input.phone ?? null },
  });

  return updated;
}

export async function changePassword(
  actor: PortalActor,
  currentPassword: string,
  newPassword: string,
) {
  const user = await db.user.findFirst({
    where: { id: actor.userId, clientId: actor.clientId, type: "CLIENT" },
    select: { id: true, passwordHash: true },
  });

  if (!user?.passwordHash) throw new NotFoundError("That account does not exist.");

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) throw new ValidationError("That is not your current password.");

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // The hash is never logged or returned — only the fact of the change.
  await record({ actor, action: "UPDATE", entityType: "User", entityId: user.id });

  return { id: user.id };
}
