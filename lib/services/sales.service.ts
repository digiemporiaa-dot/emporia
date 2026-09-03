import "server-only";
import { db, type DbClient } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { alertProposalAccepted, emailProposal } from "@/lib/services/alerts.service";
import { documentTotals, lineTotals, toMoneyString } from "@/lib/money";
import { isEditable, transitionError } from "@/lib/sales/lifecycle";
import { nextContractNumber, nextProposalNumber, uniqueClientSlug } from "@/lib/sales/numbering";
import type { Actor } from "@/lib/actor/types";
import type { ProposalStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CatalogItemInput,
  ContractInput,
  OpportunityInput,
  ProposalInput,
  ProposalItemInput,
} from "@/lib/validation/sales";

/**
 * Sales: opportunities, proposals, contracts and lead conversion.
 *
 * Every monetary figure is computed by lib/money and stored, never recomputed
 * on read. A quoted total must not move because the tax logic was edited later
 * (CLAUDE.md 2 rule 1).
 */

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

type PricedLine = {
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
};

/**
 * Compute stored values for a set of lines.
 *
 * The per-line totals and the document totals come from the same call, so the
 * printed lines always add up to the printed total.
 */
export function priceLines(items: readonly PricedLine[]) {
  const lines = items.map((item) => ({
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discountRate: item.discountRate,
    taxRate: item.taxRate,
  }));

  const totals = documentTotals(lines);
  const perLine = lines.map((line) => lineTotals(line));

  return {
    totals: {
      subtotal: toMoneyString(totals.subtotal),
      discountTotal: toMoneyString(totals.discountTotal),
      taxTotal: toMoneyString(totals.taxTotal),
      total: toMoneyString(totals.total),
    },
    lineTotals: perLine.map((line) => toMoneyString(line.total)),
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function listCatalog(actor: Actor, includeInactive = false) {
  requirePermission(actor, "proposals.view");

  return db.catalogItem.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      unit: true,
      unitPrice: true,
      currency: true,
      taxRate: true,
      isActive: true,
      order: true,
      service: { select: { id: true, name: true } },
    },
  });
}

export async function upsertCatalogItem(actor: Actor, id: string | null, input: CatalogItemInput) {
  requirePermission(actor, id ? "proposals.edit" : "proposals.create");

  const data = {
    name: input.name,
    description: input.description ?? null,
    unit: input.unit,
    unitPrice: input.unitPrice,
    currency: input.currency,
    taxRate: input.taxRate,
    serviceId: input.serviceId || null,
    isActive: input.isActive,
    order: input.order,
  };

  return withAudit(
    { actor, action: id ? "UPDATE" : "CREATE", entityType: "CatalogItem", entityId: id ?? input.name },
    (tx) => (id ? tx.catalogItem.update({ where: { id }, data }) : tx.catalogItem.create({ data })),
  );
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export async function listOpportunities(actor: Actor) {
  requirePermission(actor, "opportunities.view");

  const rows = await db.opportunity.findMany({
    orderBy: [{ stage: "asc" }, { expectedCloseAt: "asc" }],
    select: {
      id: true,
      title: true,
      value: true,
      currency: true,
      stage: true,
      probability: true,
      expectedCloseAt: true,
      owner: { select: { id: true, name: true } },
      lead: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      _count: { select: { proposals: true } },
    },
  });

  return rows.map((row) => ({ ...row, value: row.value.toString() }));
}

export async function getOpportunity(actor: Actor, id: string) {
  requirePermission(actor, "opportunities.view");

  const opportunity = await db.opportunity.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      value: true,
      currency: true,
      stage: true,
      probability: true,
      expectedCloseAt: true,
      ownerId: true,
      leadId: true,
      clientId: true,
      createdAt: true,
      lead: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      proposals: {
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, title: true, status: true, total: true, currency: true },
      },
    },
  });

  if (!opportunity) throw new NotFoundError("That opportunity does not exist.");

  return {
    ...opportunity,
    value: opportunity.value.toString(),
    proposals: opportunity.proposals.map((p) => ({ ...p, total: p.total.toString() })),
  };
}

export async function createOpportunity(actor: Actor, input: OpportunityInput) {
  requirePermission(actor, "opportunities.create");

  if (!input.leadId && !input.clientId) {
    throw new ValidationError("An opportunity must belong to a lead or a client.");
  }

  return withAudit(
    { actor, action: "CREATE", entityType: "Opportunity", entityId: input.title },
    (tx) =>
      tx.opportunity.create({
        data: {
          title: input.title,
          value: input.value,
          currency: input.currency,
          stage: input.stage,
          probability: input.probability,
          expectedCloseAt: input.expectedCloseAt ?? null,
          ownerId: input.ownerId,
          leadId: input.leadId || null,
          clientId: input.clientId || null,
        },
      }),
  );
}

export async function updateOpportunity(actor: Actor, id: string, input: OpportunityInput) {
  requirePermission(actor, "opportunities.edit");

  const before = await db.opportunity.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("That opportunity does not exist.");

  return withAudit(
    { actor, action: "UPDATE", entityType: "Opportunity", entityId: id, before },
    (tx) =>
      tx.opportunity.update({
        where: { id },
        data: {
          title: input.title,
          value: input.value,
          currency: input.currency,
          stage: input.stage,
          probability: input.probability,
          expectedCloseAt: input.expectedCloseAt ?? null,
          ownerId: input.ownerId,
        },
      }),
  );
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

const proposalSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  currency: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  total: true,
  validUntil: true,
  sentAt: true,
  viewedAt: true,
  decidedAt: true,
  version: true,
  createdAt: true,
  lead: { select: { id: true, name: true, email: true, company: true } },
  client: { select: { id: true, name: true } },
  opportunity: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true } },
  items: {
    orderBy: { order: "asc" as const },
    select: {
      id: true,
      catalogItemId: true,
      name: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountRate: true,
      taxRate: true,
      lineTotal: true,
      order: true,
    },
  },
  revisions: {
    orderBy: { version: "desc" as const },
    select: {
      id: true,
      version: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  },
  contracts: { select: { id: true, number: true, status: true } },
} as const;

/**
 * Serialise a proposal for the UI: money leaves the service layer as
 * fixed-precision strings. `Decimal` is not serialisable across the RSC
 * boundary and must never be coerced to a JS number (CLAUDE.md 2 rule 1).
 */
type ProposalRow = Prisma.ProposalGetPayload<{ select: typeof proposalSelect }>;
type ProposalItemRow = ProposalRow["items"][number];

type SerialisedItem = Omit<
  ProposalItemRow,
  "quantity" | "unitPrice" | "discountRate" | "taxRate" | "lineTotal"
> & {
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
  lineTotal: string;
};

type SerialisedProposal = Omit<
  ProposalRow,
  "subtotal" | "discountTotal" | "taxTotal" | "total" | "items"
> & {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  items: SerialisedItem[];
};

function serialiseProposal(proposal: ProposalRow): SerialisedProposal {
  const { subtotal, discountTotal, taxTotal, total, items, ...rest } = proposal;

  return {
    ...rest,
    subtotal: subtotal.toString(),
    discountTotal: discountTotal.toString(),
    taxTotal: taxTotal.toString(),
    total: total.toString(),
    items: items.map(({ quantity, unitPrice, discountRate, taxRate, lineTotal, ...item }) => ({
      ...item,
      quantity: quantity.toString(),
      unitPrice: unitPrice.toString(),
      discountRate: discountRate.toString(),
      taxRate: taxRate.toString(),
      lineTotal: lineTotal.toString(),
    })),
  };
}

export async function listProposals(actor: Actor) {
  requirePermission(actor, "proposals.view");

  const rows = await db.proposal.findMany({
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
      createdAt: true,
      lead: { select: { name: true } },
      client: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });

  return rows.map((row) => ({ ...row, total: row.total.toString() }));
}

export async function getProposal(actor: Actor, id: string) {
  requirePermission(actor, "proposals.view");

  const proposal = await db.proposal.findUnique({ where: { id }, select: proposalSelect });
  if (!proposal) throw new NotFoundError("That proposal does not exist.");
  return serialiseProposal(proposal);
}

/** Write the priced lines for a proposal and store the recomputed totals. */
async function writeItems(
  tx: DbClient,
  proposalId: string,
  items: readonly ProposalItemInput[],
): Promise<{ subtotal: string; discountTotal: string; taxTotal: string; total: string }> {
  const priced = priceLines(
    items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountRate: item.discountRate,
      taxRate: item.taxRate,
    })),
  );

  await tx.proposalItem.deleteMany({ where: { proposalId } });
  await tx.proposalItem.createMany({
    data: items.map((item, index) => ({
      proposalId,
      catalogItemId: item.catalogItemId || null,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountRate: item.discountRate,
      taxRate: item.taxRate,
      // Stored, not derived on read.
      lineTotal: priced.lineTotals[index] as string,
      order: index,
    })),
  });

  await tx.proposal.update({
    where: { id: proposalId },
    data: priced.totals,
  });

  return priced.totals;
}

export async function createProposal(actor: Actor, input: ProposalInput) {
  requirePermission(actor, "proposals.create");

  if (!input.leadId && !input.clientId && !input.opportunityId) {
    throw new ValidationError("A proposal must be attached to a lead, client or opportunity.");
  }

  const proposal = await withAudit(
    { actor, action: "CREATE", entityType: "Proposal", entityId: input.title },
    async (tx) => {
      const number = await nextProposalNumber(tx);

      const created = await tx.proposal.create({
        data: {
          number,
          title: input.title,
          status: "DRAFT",
          currency: input.currency,
          leadId: input.leadId || null,
          clientId: input.clientId || null,
          opportunityId: input.opportunityId || null,
          validUntil: input.validUntil ?? null,
          createdById: actor.userId,
        },
        select: { id: true, number: true },
      });

      await writeItems(tx, created.id, input.items);
      return created;
    },
  );

  return proposal;
}

export async function updateProposal(actor: Actor, id: string, input: ProposalInput) {
  requirePermission(actor, "proposals.edit");

  const before = await db.proposal.findUnique({
    where: { id },
    select: { status: true, number: true, total: true },
  });
  if (!before) throw new NotFoundError("That proposal does not exist.");

  // A sent proposal's numbers are what the client is holding. Editing them in
  // place would make the record disagree with the document they received.
  if (!isEditable(before.status)) {
    throw new ValidationError(
      `A ${before.status.toLowerCase()} proposal cannot be edited. Move it back to draft to revise it.`,
    );
  }

  return withAudit(
    { actor, action: "UPDATE", entityType: "Proposal", entityId: id, before },
    async (tx) => {
      await tx.proposal.update({
        where: { id },
        data: {
          title: input.title,
          currency: input.currency,
          validUntil: input.validUntil ?? null,
        },
      });

      await writeItems(tx, id, input.items);
      return tx.proposal.findUniqueOrThrow({ where: { id }, select: { id: true, number: true } });
    },
  );
}

/**
 * Snapshot the proposal exactly as it stands.
 *
 * Taken on every send, so a superseded revision remains readable as it was
 * sent rather than as it was later edited (docs/ARCHITECTURE.md 6.4).
 */
async function snapshot(tx: DbClient, proposalId: string, actorId: string): Promise<number> {
  const proposal = await tx.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    select: {
      number: true,
      title: true,
      currency: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      total: true,
      validUntil: true,
      version: true,
      items: {
        orderBy: { order: "asc" },
        select: {
          name: true,
          description: true,
          quantity: true,
          unitPrice: true,
          discountRate: true,
          taxRate: true,
          lineTotal: true,
          order: true,
        },
      },
    },
  });

  const version = proposal.version;

  await tx.proposalRevision.create({
    data: {
      proposalId,
      version,
      createdById: actorId,
      snapshot: {
        number: proposal.number,
        title: proposal.title,
        currency: proposal.currency,
        subtotal: proposal.subtotal.toString(),
        discountTotal: proposal.discountTotal.toString(),
        taxTotal: proposal.taxTotal.toString(),
        total: proposal.total.toString(),
        validUntil: proposal.validUntil?.toISOString() ?? null,
        items: proposal.items.map((item) => ({
          name: item.name,
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          discountRate: item.discountRate.toString(),
          taxRate: item.taxRate.toString(),
          lineTotal: item.lineTotal.toString(),
          order: item.order,
        })),
      },
    },
  });

  return version;
}

export async function sendProposal(actor: Actor, id: string) {
  requirePermission(actor, "proposals.send");

  const before = await db.proposal.findUnique({
    where: { id },
    select: { status: true, leadId: true, _count: { select: { items: true } } },
  });
  if (!before) throw new NotFoundError("That proposal does not exist.");

  const error = transitionError(before.status, "SENT");
  if (error) throw new ValidationError(error);

  if (before._count.items === 0) {
    throw new ValidationError("A proposal with no lines cannot be sent.");
  }

  const sent = await withAudit(
    { actor, action: "SEND", entityType: "Proposal", entityId: id, before },
    async (tx) => {
      await snapshot(tx, id, actor.userId);

      const updated = await tx.proposal.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date() },
      });

      if (before.leadId) {
        await tx.leadActivity.create({
          data: {
            leadId: before.leadId,
            actorId: actor.userId,
            type: "PROPOSAL_SENT",
            summary: `Proposal ${updated.number} sent.`,
            meta: { proposalId: id, total: updated.total.toString() },
          },
        });
      }

      return updated;
    },
  );

  // The document goes to the client after the status is committed, so a mail
  // failure cannot leave a proposal that was never marked sent. The attempt is
  // logged either way (lib/services/email.service.ts).
  await emailProposal(id);

  return sent;
}

/** Move a sent proposal back to draft, bumping the version for the next send. */
export async function reviseProposal(actor: Actor, id: string) {
  requirePermission(actor, "proposals.edit");

  const before = await db.proposal.findUnique({ where: { id }, select: { status: true, version: true } });
  if (!before) throw new NotFoundError("That proposal does not exist.");

  const error = transitionError(before.status, "DRAFT");
  if (error) throw new ValidationError(error);

  return withAudit(
    { actor, action: "UPDATE", entityType: "Proposal", entityId: id, before },
    (tx) =>
      tx.proposal.update({
        where: { id },
        data: { status: "DRAFT", version: before.version + 1 },
      }),
  );
}

export async function setProposalStatus(actor: Actor, id: string, status: ProposalStatus) {
  requirePermission(actor, "proposals.edit");

  const before = await db.proposal.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw new NotFoundError("That proposal does not exist.");

  if (status === "ACCEPTED") {
    throw new ValidationError("Use the accept action, which also creates the client.");
  }

  const error = transitionError(before.status, status);
  if (error) throw new ValidationError(error);

  return withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "Proposal", entityId: id, before },
    (tx) =>
      tx.proposal.update({
        where: { id },
        data: {
          status,
          ...(status === "VIEWED" ? { viewedAt: new Date() } : {}),
          ...(status === "REJECTED" ? { decidedAt: new Date() } : {}),
        },
      }),
  );
}

// ---------------------------------------------------------------------------
// Acceptance: the point the pipeline becomes a customer
// ---------------------------------------------------------------------------

export type AcceptResult = {
  proposalId: string;
  clientId: string;
  clientCreated: boolean;
  leadId: string | null;
};

/**
 * Accept a proposal.
 *
 * This is the seam CLAUDE.md 1 describes as a real foreign key rather than a
 * screenshot: accepting produces a Client, links the proposal and opportunity
 * to it, and marks the originating lead WON with `convertedClientId` set.
 *
 * All of it commits together. A proposal marked accepted without the client it
 * created would leave the pipeline reporting a win with nothing behind it.
 */
export async function acceptProposal(
  actor: Actor,
  id: string,
  options?: { clientName?: string },
): Promise<AcceptResult> {
  requirePermission(actor, "proposals.edit");
  requirePermission(actor, "clients.create");

  const proposal = await db.proposal.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      total: true,
      currency: true,
      clientId: true,
      opportunityId: true,
      lead: { select: { id: true, name: true, company: true, email: true, phone: true, status: true } },
    },
  });

  if (!proposal) throw new NotFoundError("That proposal does not exist.");

  const error = transitionError(proposal.status, "ACCEPTED");
  if (error) throw new ValidationError(error);

  if (!proposal.clientId && !proposal.lead) {
    throw new ValidationError(
      "This proposal is not attached to a lead or a client, so there is nothing to convert.",
    );
  }

  const result = await withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "Proposal", entityId: id, before: proposal },
    async (tx) => {
      let clientId = proposal.clientId;
      let clientCreated = false;

      if (!clientId) {
        const lead = proposal.lead;
        if (!lead) throw new ValidationError("Nothing to convert.");

        const name = options?.clientName?.trim() || lead.company?.trim() || lead.name;
        const slug = await uniqueClientSlug(tx, name);

        const client = await tx.client.create({
          data: {
            name,
            slug,
            status: "ACTIVE",
            ownerId: actor.type === "SYSTEM" ? null : actor.userId,
          },
          select: { id: true },
        });
        clientId = client.id;
        clientCreated = true;

        // The lead's own contact details become the client's primary contact,
        // so the relationship carries forward rather than being retyped.
        await tx.clientContact.create({
          data: {
            clientId,
            name: lead.name,
            email: lead.email ?? "",
            phone: lead.phone,
            isPrimary: true,
          },
        });

        // Lead → Client conversion on WON.
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            status: "WON",
            convertedClientId: clientId,
            convertedAt: new Date(),
          },
        });

        await tx.leadActivity.create({
          data: {
            leadId: lead.id,
            actorId: actor.userId,
            type: "CONVERTED",
            summary: `Proposal ${proposal.number} accepted — converted to client.`,
            meta: { proposalId: id, clientId, total: proposal.total.toString() },
          },
        });

        await tx.leadActivity.create({
          data: {
            leadId: lead.id,
            actorId: actor.userId,
            type: "STATUS_CHANGED",
            summary: "Status changed to WON.",
            meta: { from: lead.status, to: "WON" },
          },
        });
      }

      const updated = await tx.proposal.update({
        where: { id },
        data: { status: "ACCEPTED", decidedAt: new Date(), clientId },
        select: { id: true },
      });

      if (proposal.opportunityId) {
        await tx.opportunity.update({
          where: { id: proposal.opportunityId },
          data: { stage: "WON", clientId, probability: 100 },
        });
      }

      await record(
        {
          actor,
          action: "CREATE",
          entityType: "Client",
          entityId: clientId,
          after: { clientId, fromProposal: proposal.number, created: clientCreated },
        },
        tx,
      );

      return {
        proposalId: updated.id,
        clientId,
        clientCreated,
        leadId: proposal.lead?.id ?? null,
      };
    },
  );

  // Told after the conversion is committed, so the alert can never be the
  // reason a client fails to exist.
  await alertProposalAccepted(result.proposalId, result.clientId);

  return result;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export async function listContracts(actor: Actor) {
  requirePermission(actor, "contracts.view");

  const rows = await db.contract.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      value: true,
      currency: true,
      startsAt: true,
      endsAt: true,
      renewalAt: true,
      signedAt: true,
      client: { select: { id: true, name: true } },
      proposal: { select: { id: true, number: true } },
    },
  });

  return rows.map((row) => ({ ...row, value: row.value.toString() }));
}

export async function getContract(actor: Actor, id: string) {
  requirePermission(actor, "contracts.view");

  const contract = await db.contract.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      value: true,
      currency: true,
      startsAt: true,
      endsAt: true,
      renewalAt: true,
      signedAt: true,
      terms: true,
      createdAt: true,
      client: { select: { id: true, name: true } },
      proposal: { select: { id: true, number: true, title: true } },
    },
  });

  if (!contract) throw new NotFoundError("That contract does not exist.");

  return { ...contract, value: contract.value.toString() };
}

export async function createContract(actor: Actor, input: ContractInput) {
  requirePermission(actor, "contracts.create");

  if (input.endsAt && input.endsAt < input.startsAt) {
    throw new ValidationError("The end date must be after the start date.");
  }

  return withAudit(
    { actor, action: "CREATE", entityType: "Contract", entityId: input.title },
    async (tx) => {
      const number = await nextContractNumber(tx);

      return tx.contract.create({
        data: {
          number,
          clientId: input.clientId,
          proposalId: input.proposalId || null,
          title: input.title,
          status: "DRAFT",
          value: input.value,
          currency: input.currency,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
          renewalAt: input.renewalAt ?? null,
          terms: input.terms ?? null,
          documentId: input.documentId || null,
        },
      });
    },
  );
}

/**
 * Draft a contract straight from an accepted proposal, carrying its value
 * across so the two documents agree.
 */
export async function contractFromProposal(actor: Actor, proposalId: string, startsAt: Date) {
  requirePermission(actor, "contracts.create");

  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, number: true, title: true, status: true, total: true, currency: true, clientId: true },
  });

  if (!proposal) throw new NotFoundError("That proposal does not exist.");
  if (proposal.status !== "ACCEPTED") {
    throw new ValidationError("Only an accepted proposal becomes a contract.");
  }
  if (!proposal.clientId) {
    throw new ValidationError("That proposal has no client.");
  }

  const existing = await db.contract.findFirst({
    where: { proposalId },
    select: { id: true, number: true },
  });
  if (existing) {
    throw new ConflictError(`Contract ${existing.number} already exists for this proposal.`);
  }

  return createContract(actor, {
    clientId: proposal.clientId,
    proposalId: proposal.id,
    title: proposal.title,
    value: proposal.total.toString(),
    currency: proposal.currency,
    startsAt,
    endsAt: null,
    renewalAt: null,
    terms: null,
    documentId: null,
  });
}

/**
 * Record that a contract has been signed.
 *
 * Signature capture itself is not implemented: there is no e-signature
 * provider wired up, and `lib/signature` documents the interface a provider
 * would satisfy. Marking a contract signed here records a signature obtained
 * elsewhere, which is honest about what the system knows (CLAUDE.md 15 rule 5).
 */
export async function markContractSigned(actor: Actor, id: string, signedAt: Date) {
  requirePermission(actor, "contracts.edit");

  const before = await db.contract.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw new NotFoundError("That contract does not exist.");
  if (before.status === "SIGNED" || before.status === "ACTIVE") {
    throw new ValidationError("That contract is already signed.");
  }

  return withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "Contract", entityId: id, before },
    (tx) => tx.contract.update({ where: { id }, data: { status: "SIGNED", signedAt } }),
  );
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function listClients(actor: Actor) {
  requirePermission(actor, "clients.view");

  return db.client.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      industry: true,
      status: true,
      createdAt: true,
      owner: { select: { name: true } },
      _count: { select: { contracts: true, proposals: true, projects: true, contacts: true } },
      convertedFrom: { select: { id: true, name: true }, take: 1 },
    },
  });
}

export async function getClient(actor: Actor, id: string) {
  requirePermission(actor, "clients.view");

  const client = await db.client.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      industry: true,
      website: true,
      status: true,
      createdAt: true,
      owner: { select: { id: true, name: true } },
      contacts: {
        orderBy: { isPrimary: "desc" },
        select: { id: true, name: true, email: true, phone: true, designation: true, isPrimary: true },
      },
      proposals: {
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, title: true, status: true, total: true, currency: true },
      },
      contracts: {
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, title: true, status: true, value: true, currency: true, startsAt: true },
      },
      // A client can be converted from more than one lead; the earliest is the origin.
      convertedFrom: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, name: true, createdAt: true } },
    },
  });

  if (!client) throw new NotFoundError("That client does not exist.");

  return {
    ...client,
    convertedFrom: client.convertedFrom[0] ?? null,
    proposals: client.proposals.map((p) => ({ ...p, total: p.total.toString() })),
    contracts: client.contracts.map((c) => ({ ...c, value: c.value.toString() })),
  };
}
