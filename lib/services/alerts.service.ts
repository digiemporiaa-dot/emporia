import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { notifyWithEmail } from "@/lib/services/notification.service";
import { sendTemplate } from "@/lib/services/email.service";
import { readSmtpSettings } from "@/lib/email";
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
const SUBMITTED = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/** Which form a lead came through, for the alert. Built server-side by the capture path. */
export type LeadFormContext = { form: string; path: string | null };

/**
 * Someone new came in through the website.
 *
 * Two audiences, both governed by Settings → Email:
 *
 * - Staff — the assignee, or failing that everyone who can see the pipeline
 *   team-wide — always get the in-app notification; the email copy follows the
 *   "lead captured" toggle.
 * - The notification addresses (a shared sales inbox, say) get one email:
 *   the lead email when "lead captured" is on, otherwise the form-submission
 *   email when that toggle is on. Never both — every form here creates a lead,
 *   so both on would mean two mails about one enquiry; the lead email carries
 *   the form details instead. Either replies to the lead's own address.
 */
export async function alertNewLead(leadId: string, form: LeadFormContext | null = null): Promise<void> {
  try {
    const [lead, settings] = await Promise.all([
      db.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          message: true,
          assignedToId: true,
          landingPath: true,
          referrer: true,
          device: true,
          createdAt: true,
          source: { select: { name: true } },
          service: { select: { name: true } },
          city: { select: { name: true } },
          lastTouch: { select: { source: true, medium: true, campaign: true } },
        },
      }),
      readSmtpSettings(),
    ]);
    if (!lead) return;

    // Whoever it was assigned to; failing that, everyone who can see the
    // pipeline team-wide, so a lead never lands with nobody watching.
    const recipients = lead.assignedToId
      ? await db.user.findMany({ where: { id: lead.assignedToId }, select: { id: true, email: true } })
      : await db.user.findMany({
          where: {
            type: "STAFF",
            status: "ACTIVE",
            role: { permissions: { some: { permission: { key: "leads.view.team" } } } },
          },
          select: { id: true, email: true },
          take: 10,
        });

    const page = form?.path ?? lead.landingPath;
    const touch = lead.lastTouch;
    const variables = {
      leadName: lead.name,
      company: lead.company ? ` — ${lead.company}` : "",
      companyName: lead.company ?? "—",
      email: lead.email ?? "no email",
      phone: lead.phone ?? "no phone",
      // Carries the form for templates edited before the form variables existed.
      source: form ? `${lead.source.name} — ${form.form}` : lead.source.name,
      interest: [lead.service?.name, lead.city?.name].filter(Boolean).join(" in ") || "not specified",
      message: lead.message ?? "",
      leadUrl: `${siteUrl()}/admin/leads/${lead.id}`,
      formName: form?.form ?? lead.source.name,
      page: page ? `${siteUrl()}${page.startsWith("/") ? page : `/${page}`}` : "not recorded",
      attribution:
        touch && (touch.source || touch.medium || touch.campaign)
          ? [touch.source, touch.medium, touch.campaign].filter(Boolean).join(" / ")
          : lead.referrer
            ? `referred by ${lead.referrer}`
            : "direct",
      device: lead.device ? lead.device.toLowerCase() : "unknown",
      submittedAt: SUBMITTED.format(lead.createdAt),
    };

    // A staff member whose address is also on the notification list gets the
    // list's copy, not a second one.
    const listed = new Set(settings.salesAddresses.map((address) => address.toLowerCase()));

    for (const user of recipients) {
      await notifyWithEmail({
        userId: user.id,
        title: `New lead: ${lead.name}`,
        body: lead.company ?? lead.email ?? null,
        href: `/admin/leads/${lead.id}`,
        entity: { type: "Lead", id: lead.id },
        templateKey: "NEW_LEAD",
        variables,
        email: settings.notifyLeadCreated && !listed.has(user.email.toLowerCase()),
      });
    }

    const key = settings.notifyLeadCreated ? "NEW_LEAD" : settings.notifyFormSubmission ? "FORM_SUBMISSION" : null;
    if (key && settings.salesAddresses.length > 0) {
      // One message to the whole list — one log row, one SMTP conversation.
      await sendTemplate(key, {
        to: settings.salesAddresses.join(", "),
        variables,
        entity: { type: "Lead", id: lead.id },
        replyTo: lead.email,
      });
    }
  } catch (error) {
    alertLog.warn({ err: error, leadId }, "new-lead alert failed");
  }
}

/** A lead has been handed to someone. The email copy follows the "lead assigned" toggle. */
export async function alertLeadAssigned(leadId: string, assigneeId: string, assignedBy: string): Promise<void> {
  try {
    const [lead, settings] = await Promise.all([
      db.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          score: true,
        },
      }),
      readSmtpSettings(),
    ]);
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
      email: settings.notifyLeadAssigned,
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
