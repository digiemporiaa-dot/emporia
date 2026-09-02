import "server-only";
import type { DbClient } from "@/lib/db";

/**
 * Document numbering.
 *
 * Sequential within the year, per document type. Generated inside the caller's
 * transaction and derived from the highest existing number, so two concurrent
 * creations cannot both claim the same one — the unique constraint on `number`
 * is the backstop if they race.
 */

function prefixFor(kind: "PRO" | "CON", year: number): string {
  return `${kind}-${year}-`;
}

async function nextNumber(
  tx: DbClient,
  kind: "PRO" | "CON",
  find: (prefix: string) => Promise<string | null>,
): Promise<string> {
  const prefix = prefixFor(kind, new Date().getFullYear());
  const latest = await find(prefix);
  const previous = latest ? Number.parseInt(latest.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(previous) ? previous + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function nextProposalNumber(tx: DbClient): Promise<string> {
  return nextNumber(tx, "PRO", async (prefix) => {
    const row = await tx.proposal.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return row?.number ?? null;
  });
}

export async function nextContractNumber(tx: DbClient): Promise<string> {
  return nextNumber(tx, "CON", async (prefix) => {
    const row = await tx.contract.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return row?.number ?? null;
  });
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
