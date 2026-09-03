import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { notifyWithEmail } from "@/lib/services/notification.service";
import { sendTemplate } from "@/lib/services/email.service";
import { formatMoney } from "@/lib/money";
import { log } from "@/lib/logger";

/**
 * The notifications the product actually sends.
 *
 * Kept apart from the services that trigger them, so a capture or a status
 * change reads as one thing and the messaging is one call at the end. Every
 * function here is best-effort: it logs and returns, and never throws into the
 * work that caused it — a lead is captured whether or not the alert goes out.
 */

const alertLog = log("alerts");

function siteUrl(): string {
  return env().SITE_URL.replace(/\/$/, "");
}

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Someone new came in through the website. */
export async function alertNewLead(leadId: string): Promise<void> {
  try {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        message: true,
        assignedToId: true,
        source: { select: { name: true } },
        service: { select: { name: true } },
        city: { select: { name: true } },
      },
    });
    if (!lead) return;

    // Whoever it was assigned to; failing that, everyone who can see the
    // pipeline team-wide, so a lead never lands with nobody watching.
    const recipients = lead.assignedToId
      ? [lead.assignedToId]
      : (
          await db.user.findMany({
            where: {
              type: "STAFF",
              status: "ACTIVE",
              role: { permissions: { some: { permission: { key: "leads.view.team" } } } },
            },
            select: { id: true },
            take: 10,
          })
        ).map((user) => user.id);

    const variables = {
      leadName: lead.name,
      company: lead.company ? ` — ${lead.company}` : "",
      email: lead.email ?? "no email",
      phone: lead.phone ?? "no phone",
      source: lead.source.name,
      interest: [lead.service?.name, lead.city?.name].filter(Boolean).join(" in ") || "not specified",
      message: lead.message ?? "",
      leadUrl: `${siteUrl()}/admin/leads/${lead.id}`,
    };

    for (const userId of recipients) {
      await notifyWithEmail({
        userId,
        title: `New lead: ${lead.name}`,
        body: lead.company ?? lead.email ?? null,
        href: `/admin/leads/${lead.id}`,
        entity: { type: "Lead", id: lead.id },
        templateKey: "NEW_LEAD",
        variables,
      });
    }
  } catch (error) {
    alertLog.warn({ err: error, leadId }, "new-lead alert failed");
  }
}

/** A lead has been handed to someone. */
export async function alertLeadAssigned(leadId: string, assigneeId: string, assignedBy: string): Promise<void> {
  try {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        score: true,
      },
    });
    if (!lead) return;

    await notifyWithEmail({
      userId: assigneeId,
      title: `${lead.name} is now yours`,
      body: lead.company,
      href: `/admin/leads/${lead.id}`,
      entity: { type: "Lead", id: lead.id },
      templateKey: "LEAD_ASSIGNED",
      variables: {
        leadName: lead.name,
        company: lead.company ? ` — ${lead.company}` : "",
        email: lead.email ?? "no email",
        phone: lead.phone ?? "no phone",
        score: String(lead.score),
        assignedBy,
        leadUrl: `${siteUrl()}/admin/leads/${lead.id}`,
      },
    });
  } catch (error) {
    alertLog.warn({ err: error, leadId }, "lead-assigned alert failed");
  }
}

/**
 * A proposal has gone to the client.
 *
 * Sent to the lead or client contact it was addressed to. If there is no
 * address, nothing is sent and the reason is logged — better than mailing a
 * placeholder.
 */
export async function emailProposal(proposalId: string): Promise<void> {
  try {
    const proposal = await db.proposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        number: true,
        title: true,
        total: true,
        currency: true,
        validUntil: true,
        lead: { select: { name: true, email: true } },
        client: {
          select: {
            name: true,
            contacts: {
              where: { isPrimary: true },
              select: { name: true, email: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!proposal) return;

    const contact = proposal.client?.contacts[0];
    const to = contact?.email ?? proposal.lead?.email ?? null;
    const name = contact?.name ?? proposal.client?.name ?? proposal.lead?.name ?? "there";

    if (!to) {
      alertLog.info({ proposalId }, "no address to send the proposal to");
      return;
    }

    await sendTemplate("PROPOSAL_SENT", {
      to,
      variables: {
        clientName: name,
        proposalTitle: proposal.title,
        proposalNumber: proposal.number,
        total: formatMoney(proposal.total.toString(), proposal.currency),
        validUntil: proposal.validUntil ? ` · valid until ${DATE.format(proposal.validUntil)}` : "",
        proposalUrl: `${siteUrl()}/portal/documents/proposals/${proposal.id}`,
      },
      entity: { type: "Proposal", id: proposal.id },
    });
  } catch (error) {
    alertLog.warn({ err: error, proposalId }, "proposal email failed");
  }
}

/** A proposal was accepted — the agency's own people want to know. */
export async function alertProposalAccepted(proposalId: string, clientId: string): Promise<void> {
  try {
    const [proposal, client] = await Promise.all([
      db.proposal.findUnique({
        where: { id: proposalId },
        select: { id: true, number: true, title: true, total: true, currency: true, createdById: true },
      }),
      db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } }),
    ]);
    if (!proposal || !client) return;

    await notifyWithEmail({
      userId: proposal.createdById,
      title: `${client.name} accepted ${proposal.number}`,
      body: proposal.title,
      href: `/admin/clients/${client.id}`,
      entity: { type: "Proposal", id: proposal.id },
      templateKey: "PROPOSAL_ACCEPTED",
      variables: {
        clientName: client.name,
        proposalTitle: proposal.title,
        proposalNumber: proposal.number,
        total: formatMoney(proposal.total.toString(), proposal.currency),
        clientUrl: `${siteUrl()}/admin/clients/${client.id}`,
      },
    });
  } catch (error) {
    alertLog.warn({ err: error, proposalId }, "proposal-accepted alert failed");
  }
}

/**
 * A portal invitation.
 *
 * Unlike the alerts above this one is not best-effort silent: the caller shows
 * the outcome, because a staff member needs to know whether to send the link
 * themselves.
 */
export async function emailPortalInvite(input: {
  to: string;
  name: string;
  invitedBy: string;
  inviteUrl: string;
  expiresAt: Date;
}) {
  return sendTemplate("STAFF_INVITATION", {
    to: input.to,
    variables: {
      name: input.name,
      invitedBy: input.invitedBy,
      inviteUrl: input.inviteUrl,
      expiresAt: DATE.format(input.expiresAt),
    },
    entity: { type: "User", id: input.to },
  });
}
