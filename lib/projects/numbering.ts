import { nextDocumentNumber } from "@/lib/numbering/sequence";
import type { DbClient } from "@/lib/db";

/** `PRJ-2026-0001`. See lib/numbering/sequence for how the counter is read. */
export async function nextProjectCode(tx: DbClient, now = new Date()): Promise<string> {
  return nextDocumentNumber(tx, "Project", "PRJ", now);
}
