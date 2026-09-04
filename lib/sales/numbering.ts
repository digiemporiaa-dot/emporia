import "server-only";
import { nextDocumentNumber } from "@/lib/numbering/sequence";
import type { DbClient } from "@/lib/db";

/**
 * Document numbering.
 *
 * Sequential within the year, per document type, through the shared allocator
 * in lib/numbering/sequence — which is also where the reasoning about reading
 * the counter numerically rather than by string order lives.
 */

export async function nextProposalNumber(tx: DbClient): Promise<string> {
  return nextDocumentNumber(tx, "Proposal", "PRO");
}

export async function nextContractNumber(tx: DbClient): Promise<string> {
  return nextDocumentNumber(tx, "Contract", "CON");
}

/** URL-safe slug from a client name, uniquified against existing slugs. */
export async function uniqueClientSlug(tx: DbClient, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "client";

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const clash = await tx.client.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }

  return `${base}-${Date.now()}`;
}
