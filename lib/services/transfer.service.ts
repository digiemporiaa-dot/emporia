import "server-only";
import { requirePermission } from "@/lib/auth/rbac";
import { ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { CsvError, readTable, normaliseHeader } from "@/lib/csv/parse";
import { toCsv } from "@/lib/csv/serialise";
import { TRANSFER, type TransferType } from "@/lib/transfer/columns";
import { RULES } from "@/lib/transfer/rules";
import { loadRefs } from "@/lib/transfer/refs";
import type { ImportOutcome, ImportPlan, RowPlan } from "@/lib/transfer/types";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";

/**
 * Import and export of the content a spreadsheet can honestly carry
 * (CMS 2.0 Phase 15).
 *
 * The shape is: **plan, then apply.** `planImport` reads the file and says what
 * it would do to every row, with the errors, before anything is written.
 * `commitImport` takes the same file and does it.
 *
 * Commit re-reads and re-plans from the file rather than accepting a plan from
 * the browser. A preview the server trusts is a preview an attacker can edit —
 * it would be a write path with the validation moved to the client.
 *
 * **Three rules hold across every type:**
 *
 * 1. *A column absent from the file changes nothing.* Values are merged over
 *    the existing record, not written from a blank slate. Somebody who exports,
 *    keeps two columns and re-imports has edited two fields, not erased the
 *    rest of the record.
 * 2. *Writing goes through the ordinary service functions* — the same
 *    `createService`, `updatePost`, `createFaq` the admin forms call. They hold
 *    the permission check, the publish check, the slug collision check, the
 *    audit row and the cache invalidation, and an importer with its own writes
 *    would be a second copy of all of it.
 * 3. *Nothing is guessed.* A cell that cannot be read is a reported error
 *    against its line number, never a zero, a false, or a silent null.
 *
 * **Not one transaction, and the screen says so.** Rule 2 is why: each service
 * function opens its own transaction for its own write and audit row, and
 * calling them inside an outer one would not nest — Prisma would run them on
 * their own connections regardless. The alternative, hand-rolled writes inside
 * a single transaction, means re-implementing five services' rules and is how
 * an import ends up being the one path with no permission check. So instead the
 * whole file is validated first and refused outright if any row is bad, which
 * removes the realistic failure; and if a write still fails, the run stops at
 * that row and reports exactly where, rather than carrying on through a file
 * whose assumptions have just been shown to be wrong.
 */

const transferLog = log("transfer");

/** Bounds. A spreadsheet this big is a migration, and wants a migration script. */
const MAX_BYTES = 2_000_000;
const MAX_ROWS = 2_000;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportContent(
  actor: Actor,
  type: TransferType,
): Promise<{ filename: string; csv: string }> {
  const meta = TRANSFER[type];
  requirePermission(actor, meta.viewPermission);

  const spec = RULES[type];
  const rows = await spec.all();

  const headers = meta.columns.map((column) => column.header);
  const body = rows.map((row) => [
    typeof row["id"] === "string" ? row["id"] : "",
    ...spec.rules.map((rule) => rule.write(row)),
  ]);

  // Read-only, but worth a line: an export is the whole of a content table
  // leaving the building, and that is the sort of thing an audit log is for.
  await record({
    actor,
    action: "EXPORT",
    entityType: `${meta.label} export`,
    entityId: type,
    after: { rows: rows.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `${type}-${stamp}.csv`, csv: toCsv(headers, body) };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function checkSize(csv: string) {
  // Byte length, not character count: a file of Devanagari is three times the
  // size its length suggests.
  if (Buffer.byteLength(csv, "utf8") > MAX_BYTES) {
    throw new ValidationError("That file is too big. Split it, or import at most 2 MB at a time.");
  }
}

export async function planImport(
  actor: Actor,
  type: TransferType,
  csv: string,
): Promise<ImportPlan> {
  const meta = TRANSFER[type];
  // Planning writes nothing, but it reads every record of the type and reports
  // what would change, so it is gated on being allowed to edit them at all.
  requirePermission(actor, meta.editPermission);
  checkSize(csv);

  const spec = RULES[type];

  let table;
  try {
    table = readTable(csv);
  } catch (error) {
    if (error instanceof CsvError) {
      throw new ValidationError(`Line ${error.line}: ${error.message}`);
    }
    throw error;
  }

  if (table.rows.length === 0) throw new ValidationError("That file has a header but no rows.");
  if (table.rows.length > MAX_ROWS) {
    throw new ValidationError(`Import at most ${MAX_ROWS} rows at a time.`);
  }

  const known = new Set([
    normaliseHeader("id"),
    ...spec.rules.map((rule) => normaliseHeader(rule.column)),
  ]);
  const unknownHeaders = table.headers.filter(
    (header) => header !== "" && !known.has(normaliseHeader(header)),
  );

  const cell = (row: readonly string[], column: string): string | undefined => {
    const at = table.index.get(normaliseHeader(column));
    if (at === undefined) return undefined;
    return row[at] ?? "";
  };

  // Which existing records the file points at, resolved in two batched passes
  // rather than a query per row.
  const ids: string[] = [];
  const naturals: string[] = [];
  for (const row of table.rows) {
    const id = (cell(row, "id") ?? "").trim();
    if (id !== "") ids.push(id);
    else if (meta.naturalKey) {
      const key = (cell(row, meta.naturalKey) ?? "").trim();
      if (key !== "") naturals.push(key);
    }
  }

  const refs = await loadRefs();
  const byId = new Map(
    (await spec.load(ids)).map((row) => [String(row["id"]), row] as const),
  );
  const byNatural = new Map<string, Record<string, unknown>>();
  if (meta.naturalKey && naturals.length > 0) {
    const key = meta.naturalKey;
    for (const row of await spec.all()) {
      const value = row[key];
      if (typeof value === "string") byNatural.set(value.toLowerCase(), row);
    }
  }

  const plans: RowPlan[] = [];
  // A file that names the same record twice is a file whose second row silently
  // wins. Caught here rather than discovered afterwards.
  const seen = new Map<string, number>();

  table.rows.forEach((row, at) => {
    const line = table.lineOf(at);
    const errors: string[] = [];

    const rawId = (cell(row, "id") ?? "").trim();
    let existing: Record<string, unknown> | null = null;

    if (rawId !== "") {
      existing = byId.get(rawId) ?? null;
      if (!existing) errors.push(`No ${meta.label.toLowerCase()} has the id "${rawId}".`);
    } else if (meta.naturalKey) {
      const key = (cell(row, meta.naturalKey) ?? "").trim();
      if (key !== "") existing = byNatural.get(key.toLowerCase()) ?? null;
    }

    const identity = rawId !== "" ? `id:${rawId}` : existing ? `rec:${String(existing["id"])}` : null;
    if (identity) {
      const before = seen.get(identity);
      if (before !== undefined) errors.push(`Line ${before} already changes this record.`);
      else seen.set(identity, line);
    }

    // The merge: start from the record as it is, overlay only the columns the
    // file actually carries.
    const values: Record<string, unknown> = {};
    for (const rule of spec.rules) {
      const raw = cell(row, rule.column);
      if (raw === undefined) {
        if (existing) values[rule.field] = rule.current(existing);
        continue;
      }
      const parsed = rule.read(raw, refs);
      if (!parsed.ok) {
        errors.push(`${rule.column}: ${parsed.message}`);
        continue;
      }
      // A blank cell in a "keep" column is an operator who left it alone, not
      // an instruction to unset something that has no unset state.
      if (parsed.value === null && existing && rule.blank === "keep") {
        values[rule.field] = rule.current(existing);
        continue;
      }
      values[rule.field] = parsed.value;
    }

    const label = existing ? spec.label(existing) : labelFrom(values, spec.label);

    if (errors.length > 0) {
      plans.push({ outcome: "error", line, label, errors });
      return;
    }

    const parsed = spec.schema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        errors.push(path ? `${path}: ${issue.message}` : issue.message);
      }
      plans.push({ outcome: "error", line, label, errors });
      return;
    }

    if (!existing) {
      plans.push({ outcome: "create", line, label, values: parsed.data as Record<string, unknown> });
      return;
    }

    const changed = spec.rules
      .filter((rule) => cell(row, rule.column) !== undefined)
      .filter((rule) => !same(rule.current(existing), (parsed.data as Record<string, unknown>)[rule.field]))
      .map((rule) => rule.column);

    if (changed.length === 0) {
      plans.push({ outcome: "unchanged", line, label, id: String(existing["id"]) });
      return;
    }

    plans.push({
      outcome: "update",
      line,
      label,
      id: String(existing["id"]),
      values: parsed.data as Record<string, unknown>,
      changed,
    });
  });

  return {
    columns: meta.columns,
    unknownHeaders,
    rows: plans,
    counts: {
      create: plans.filter((plan) => plan.outcome === "create").length,
      update: plans.filter((plan) => plan.outcome === "update").length,
      unchanged: plans.filter((plan) => plan.outcome === "unchanged").length,
      error: plans.filter((plan) => plan.outcome === "error").length,
    },
  };
}

function labelFrom(
  values: Record<string, unknown>,
  label: (row: Record<string, unknown>) => string,
): string {
  return label(values);
}

/** Loose equality over the shapes a cell can hold. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, at) => entry === b[at]);
  }
  // "" and null both mean "not set" across these schemas, and a column that
  // exported "" and imported null is not a change anybody made.
  const blank = (value: unknown) => value === null || value === undefined || value === "";
  if (blank(a) && blank(b)) return true;
  return a === b;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export async function commitImport(
  actor: Actor,
  type: TransferType,
  csv: string,
): Promise<ImportOutcome> {
  const meta = TRANSFER[type];
  const plan = await planImport(actor, type, csv);

  if (plan.counts.error > 0) {
    throw new ValidationError(
      `${plan.counts.error} row${plan.counts.error === 1 ? "" : "s"} still ${
        plan.counts.error === 1 ? "has" : "have"
      } an error. Fix the file and try again.`,
    );
  }
  if (plan.counts.create === 0 && plan.counts.update === 0) {
    throw new ValidationError("Nothing in that file changes anything.");
  }

  // Checked once, up front, rather than discovered halfway through: a run that
  // creates forty records and then finds it may not create the forty-first is
  // worse than one that never started.
  if (plan.counts.create > 0) requirePermission(actor, meta.createPermission);
  if (plan.counts.update > 0) requirePermission(actor, meta.editPermission);

  const spec = RULES[type];
  const outcome: ImportOutcome = {
    created: 0,
    updated: 0,
    unchanged: plan.counts.unchanged,
    stoppedAt: null,
  };

  for (const row of plan.rows) {
    try {
      if (row.outcome === "create") {
        await spec.create(actor, row.values);
        outcome.created += 1;
      } else if (row.outcome === "update") {
        await spec.update(actor, row.id, row.values);
        outcome.updated += 1;
      }
    } catch (error) {
      outcome.stoppedAt = {
        line: row.line,
        message: error instanceof Error ? error.message : "That row could not be saved.",
      };
      transferLog.error({ err: error, type, line: row.line }, "import stopped");
      break;
    }
  }

  await record({
    actor,
    action: "IMPORT",
    entityType: `${meta.label} import`,
    entityId: type,
    after: {
      created: outcome.created,
      updated: outcome.updated,
      unchanged: outcome.unchanged,
      stoppedAtLine: outcome.stoppedAt?.line ?? null,
    },
  });

  return outcome;
}
