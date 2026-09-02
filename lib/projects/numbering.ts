import type { DbClient } from "@/lib/db";

/**
 * Project codes: PRJ-YYYY-NNNN, allocated per calendar year.
 *
 * Allocated inside the same transaction as the row it numbers, from the
 * highest existing code for the year, so two projects created at once cannot
 * take the same number.
 */
export async function nextProjectCode(tx: DbClient, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const prefix = `PRJ-${year}-`;

  const latest = await tx.project.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });

  const previous = latest ? Number.parseInt(latest.code.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(previous) ? previous + 1 : 1;

  return `${prefix}${String(next).padStart(4, "0")}`;
}
