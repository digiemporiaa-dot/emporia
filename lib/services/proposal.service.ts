import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { documentTotals, lineTotals, toMoneyString } from "@/lib/money";
import type { Actor } from "@/lib/actor/types";

/**
 * Package → proposal handoff.
 *
 * This is the seam the build plan asks for in Phase 6: a package becomes a
 * draft proposal with real line items and real Decimal totals. The proposal
 * lifecycle, revisions and the sales UI are Phase 8 — nothing here pretends
 * they exist.
 *
 * All arithmetic goes through lib/money, the same code that will price the
 * invoice, so a figure quoted from a package and the figure eventually
 * invoiced cannot diverge (CLAUDE.md 2 rule 1, 4).
 */

/** `PRO-2026-0001`, sequential within the year. */
async function nextProposalNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRO-${year}-`;

  const latest = await db.proposal.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  const previous = latest ? Number.parseInt(latest.number.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(previous) ? previous + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export type ProposalFromPackageInput = {
  packageId: string;
  /** Exactly one of these anchors the proposal. */
  leadId?: string | null;
  clientId?: string | null;
  opportunityId?: string | null;
  title?: string;
  quantity?: number;
  /** Percent, e.g. 10 for 10% off. */
  discountRate?: string;
  validUntil?: Date | null;
};

export async function createProposalFromPackage(
  actor: Actor,
  input: ProposalFromPackageInput,
) {
  requirePermission(actor, "proposals.create");

  const pkg = await db.servicePackage.findUnique({
    where: { id: input.packageId },
    select: {
      id: true,
      name: true,
      tagline: true,
      price: true,
      currency: true,
      taxRate: true,
      billingType: true,
      features: {
        orderBy: { order: "asc" },
        select: { label: true, detail: true, isIncluded: true },
      },
    },
  });

  if (!pkg) throw new NotFoundError("That package does not exist.");

  const quantity = input.quantity ?? 1;
  const discountRate = input.discountRate ?? "0";

  // One line for the package itself. Included features are described on the
  // line rather than priced separately, because they are not separately priced.
  const included = pkg.features.filter((f) => f.isIncluded);
  const description = included
    .map((f) => (f.detail ? `${f.label} (${f.detail})` : f.label))
    .join("; ");

  const line = {
    quantity: String(quantity),
    unitPrice: pkg.price.toString(),
    discountRate,
    taxRate: pkg.taxRate.toString(),
  };

  const totals = documentTotals([line]);
  const computed = lineTotals(line);
  const number = await nextProposalNumber();

  return withAudit(
    { actor, action: "CREATE", entityType: "Proposal", entityId: number },
    async (tx) => {
      const proposal = await tx.proposal.create({
        data: {
          number,
          title: input.title ?? `${pkg.name} proposal`,
          status: "DRAFT",
          currency: pkg.currency,
          leadId: input.leadId ?? null,
          clientId: input.clientId ?? null,
          opportunityId: input.opportunityId ?? null,
          createdById: actor.userId,
          validUntil: input.validUntil ?? null,
          subtotal: toMoneyString(totals.subtotal),
          discountTotal: toMoneyString(totals.discountTotal),
          taxTotal: toMoneyString(totals.taxTotal),
          total: toMoneyString(totals.total),
        },
        select: { id: true, number: true, total: true, currency: true },
      });

      await tx.proposalItem.create({
        data: {
          proposalId: proposal.id,
          name: pkg.name,
          description: description || pkg.tagline || null,
          quantity: String(quantity),
          unitPrice: pkg.price.toString(),
          discountRate,
          taxRate: pkg.taxRate.toString(),
          // Stored, not recomputed on read: a quoted figure must not move.
          lineTotal: toMoneyString(computed.total),
          order: 0,
        },
      });

      return proposal;
    },
  );
}
