import "server-only";
import { db } from "@/lib/db";
import { toMoneyString } from "@/lib/money";
import type { Facts, Subject, WiredTrigger } from "@/lib/automation/types";

/**
 * Building the facts a rule is evaluated against.
 *
 * Read fresh from the database at fire time rather than passed in by the
 * caller: a rule should judge the record as it now stands, and a caller cannot
 * forget to include a field.
 *
 * Money is a fixed-precision string so the Decimal comparison in
 * `lib/automation/conditions` is exact.
 */

export async function buildFacts(
  trigger: WiredTrigger,
  subject: Subject,
  extra: Facts = {},
): Promise<Facts> {
  const facts: Facts = { ...extra };

  if (subject.leadId) Object.assign(facts, await leadFacts(subject.leadId));
  if (subject.proposalId) Object.assign(facts, await proposalFacts(subject.proposalId));
  if (subject.invoiceId) Object.assign(facts, await invoiceFacts(subject.invoiceId));
  if (subject.projectId) Object.assign(facts, await projectFacts(subject.projectId));
  if (subject.paymentId) Object.assign(facts, await paymentFacts(subject.paymentId));
  if (subject.clientId && facts["client.name"] === undefined) {
    const client = await db.client.findUnique({
      where: { id: subject.clientId },
      select: { name: true, status: true },
    });
    if (client) {
      facts["client.name"] = client.name;
      facts["client.status"] = client.status;
    }
  }

  facts["trigger"] = trigger;
  return facts;
}

async function leadFacts(leadId: string): Promise<Facts> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      status: true,
      priority: true,
      score: true,
      budget: true,
      company: true,
      email: true,
      assignedToId: true,
      source: { select: { slug: true } },
      service: { select: { slug: true } },
      city: { select: { slug: true } },
      campaign: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });

  if (!lead) return {};

  return {
    "lead.status": lead.status,
    "lead.priority": lead.priority,
    "lead.score": lead.score,
    "lead.budget": lead.budget === null ? null : toMoneyString(lead.budget),
    "lead.company": lead.company,
    "lead.email": lead.email,
    "lead.sourceSlug": lead.source.slug,
    "lead.serviceSlug": lead.service?.slug ?? null,
    "lead.citySlug": lead.city?.slug ?? null,
    "lead.campaignName": lead.campaign?.name ?? null,
    "lead.assigned": lead.assignedToId !== null,
    "lead.assigneeName": lead.assignedTo?.name ?? null,
  };
}

async function proposalFacts(proposalId: string): Promise<Facts> {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    select: {
      title: true,
      total: true,
      currency: true,
      status: true,
      client: { select: { name: true } },
      lead: { select: { source: { select: { slug: true } } } },
    },
  });

  if (!proposal) return {};

  return {
    "proposal.title": proposal.title,
    "proposal.total": toMoneyString(proposal.total),
    "proposal.currency": proposal.currency,
    "proposal.status": proposal.status,
    "client.name": proposal.client?.name ?? null,
    // Only set when the lead's own facts have not already provided it.
    "lead.sourceSlug": proposal.lead?.source.slug ?? null,
  };
}

async function invoiceFacts(invoiceId: string): Promise<Facts> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      total: true,
      dueTotal: true,
      status: true,
      currency: true,
      dueAt: true,
      client: { select: { name: true } },
    },
  });

  if (!invoice) return {};

  const overdueMs = Date.now() - invoice.dueAt.getTime();

  return {
    "invoice.total": toMoneyString(invoice.total),
    "invoice.dueTotal": toMoneyString(invoice.dueTotal),
    "invoice.status": invoice.status,
    "invoice.currency": invoice.currency,
    "invoice.daysOverdue": overdueMs > 0 ? Math.floor(overdueMs / 86_400_000) : 0,
    "client.name": invoice.client.name,
  };
}

async function projectFacts(projectId: string): Promise<Facts> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      status: true,
      health: true,
      budget: true,
      client: { select: { name: true } },
    },
  });

  if (!project) return {};

  return {
    "project.name": project.name,
    "project.status": project.status,
    "project.health": project.health,
    "project.budget": toMoneyString(project.budget),
    "client.name": project.client.name,
  };
}

async function paymentFacts(paymentId: string): Promise<Facts> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { amount: true, gateway: true, status: true, currency: true },
  });

  if (!payment) return {};

  return {
    "payment.amount": toMoneyString(payment.amount),
    "payment.gateway": payment.gateway,
    "payment.status": payment.status,
    "payment.currency": payment.currency,
  };
}
