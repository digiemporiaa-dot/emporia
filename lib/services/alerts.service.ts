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
 * An invoice has been issued.
 *
 * Sent to the client's primary contact. If there is no address, nothing is sent
 * and the reason is logged — better than mailing a placeholder.
 */
export async function emailInvoice(invoiceId: string): Promise<void> {
  try {
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        number: true,
        total: true,
        currency: true,
        dueAt: true,
        client: {
          select: {
            name: true,
            contacts: { where: { isPrimary: true }, select: { name: true, email: true }, take: 1 },
          },
        },
      },
    });
    if (!invoice) return;

    const contact = invoice.client.contacts[0];
    if (!contact?.email) {
      alertLog.info({ invoiceId }, "no address to send the invoice to");
      return;
    }

    await sendTemplate("INVOICE_SENT", {
      to: contact.email,
      variables: {
        clientName: contact.name || invoice.client.name,
        invoiceNumber: invoice.number,
        total: formatMoney(invoice.total.toString(), invoice.currency),
        dueDate: DATE.format(invoice.dueAt),
        invoiceUrl: `${siteUrl()}/portal/invoices`,
      },
      entity: { type: "Invoice", id: invoice.id },
    });
  } catch (error) {
    alertLog.warn({ err: error, invoiceId }, "invoice email failed");
  }
}

/** Money has arrived against an invoice. */
export async function emailPaymentReceived(paymentId: string): Promise<void> {
  try {
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        invoice: {
          select: {
            id: true,
            number: true,
            dueTotal: true,
            currency: true,
            client: {
              select: {
                name: true,
                contacts: { where: { isPrimary: true }, select: { name: true, email: true }, take: 1 },
              },
            },
          },
        },
      },
    });
    if (!payment) return;

    const contact = payment.invoice.client.contacts[0];
    if (!contact?.email) {
      alertLog.info({ paymentId }, "no address to confirm the payment to");
      return;
    }

    await sendTemplate("PAYMENT_RECEIVED", {
      to: contact.email,
      variables: {
        clientName: contact.name || payment.invoice.client.name,
        invoiceNumber: payment.invoice.number,
        amount: formatMoney(payment.amount.toString(), payment.currency),
        outstanding: formatMoney(payment.invoice.dueTotal.toString(), payment.invoice.currency),
        invoiceUrl: `${siteUrl()}/portal/invoices`,
      },
      entity: { type: "Payment", id: payment.id },
    });
  } catch (error) {
    alertLog.warn({ err: error, paymentId }, "payment confirmation failed");
  }
}

/** An invoice is coming due, or has passed its date. */
export async function emailPaymentReminder(invoiceId: string): Promise<void> {
  try {
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        number: true,
        dueTotal: true,
        currency: true,
        dueAt: true,
        client: {
          select: {
            name: true,
            contacts: { where: { isPrimary: true }, select: { name: true, email: true }, take: 1 },
          },
        },
      },
    });
    if (!invoice) return;

    const contact = invoice.client.contacts[0];
    if (!contact?.email) return;

    await sendTemplate("PAYMENT_REMINDER", {
      to: contact.email,
      variables: {
        clientName: contact.name || invoice.client.name,
        invoiceNumber: invoice.number,
        outstanding: formatMoney(invoice.dueTotal.toString(), invoice.currency),
        dueDate: DATE.format(invoice.dueAt),
        invoiceUrl: `${siteUrl()}/portal/invoices`,
      },
      entity: { type: "Invoice", id: invoice.id },
    });
  } catch (error) {
    alertLog.warn({ err: error, invoiceId }, "payment reminder failed");
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
