import type { DbClient } from "@/lib/db";

/**
 * Invoice numbers: INV-YYYY-NNNN, allocated per calendar year inside the same
 * transaction as the row they number, so two invoices raised at once cannot
 * take the same one.
 *
 * The maximum is taken numerically, not by sorting the strings. Zero padding
 * makes string order agree with numeric order only while the counter has four
 * digits — at INV-2026-10000 the string "…-9999" still sorts highest, and every
 * invoice after it would collide on the unique constraint forever.
 */
export async function nextInvoiceNumber(tx: DbClient, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const prefix = `INV-${year}-`;

  // split_part rather than a substring offset: the counter is the third
  // hyphen-separated field, so there is no length arithmetic to get wrong.
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(split_part("number", '-', 3) AS INTEGER)) AS max
    FROM "Invoice"
    WHERE "number" LIKE ${`${prefix}%`}
      AND split_part("number", '-', 3) ~ '^[0-9]+$'
  `;

  const previous = rows[0]?.max ?? 0;

  return `${prefix}${String(previous + 1).padStart(4, "0")}`;
}
