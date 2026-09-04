import type { DbClient } from "@/lib/db";

/**
 * Sequential document numbers: `PREFIX-YYYY-NNNN`, allocated inside the
 * caller's transaction so two concurrent creations cannot claim the same one —
 * with the column's unique constraint as the backstop if they race.
 *
 * The counter is read as a **number**, not by sorting the strings. Zero padding
 * makes string order agree with numeric order only while the counter has four
 * digits: once `PRE-2026-10000` exists, `…-9999` still sorts highest and every
 * later document would collide on the unique constraint forever. This module
 * exists so that reasoning lives in one place for every numbered document
 * (CLAUDE.md 4).
 */

export type NumberedDocument = "Invoice" | "Proposal" | "Contract" | "Project";

/**
 * The numeric maximum of the counters already issued under `prefix`.
 *
 * The table and column are literals per branch rather than interpolated: an
 * identifier cannot be a bind parameter, and building SQL by concatenation is
 * how injection gets in even when today's callers are all internal.
 *
 * `split_part` takes the third hyphen-separated field, so there is no length
 * arithmetic to get wrong.
 */
async function highestCounter(
  tx: DbClient,
  document: NumberedDocument,
  prefix: string,
): Promise<number> {
  const like = `${prefix}%`;
  let rows: { max: number | null }[];

  switch (document) {
    case "Invoice":
      rows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(split_part("number", '-', 3) AS INTEGER)) AS max
        FROM "Invoice"
        WHERE "number" LIKE ${like} AND split_part("number", '-', 3) ~ '^[0-9]+$'`;
      break;
    case "Proposal":
      rows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(split_part("number", '-', 3) AS INTEGER)) AS max
        FROM "Proposal"
        WHERE "number" LIKE ${like} AND split_part("number", '-', 3) ~ '^[0-9]+$'`;
      break;
    case "Contract":
      rows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(split_part("number", '-', 3) AS INTEGER)) AS max
        FROM "Contract"
        WHERE "number" LIKE ${like} AND split_part("number", '-', 3) ~ '^[0-9]+$'`;
      break;
    case "Project":
      rows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(split_part("code", '-', 3) AS INTEGER)) AS max
        FROM "Project"
        WHERE "code" LIKE ${like} AND split_part("code", '-', 3) ~ '^[0-9]+$'`;
      break;
  }

  return rows[0]?.max ?? 0;
}

export async function nextDocumentNumber(
  tx: DbClient,
  document: NumberedDocument,
  kind: string,
  now = new Date(),
): Promise<string> {
  const prefix = `${kind}-${now.getFullYear()}-`;
  const previous = await highestCounter(tx, document, prefix);
  return `${prefix}${String(previous + 1).padStart(4, "0")}`;
}
