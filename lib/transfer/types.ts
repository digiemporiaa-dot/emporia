import type { Permission } from "@/lib/auth/permissions";

/**
 * What a spreadsheet column means.
 *
 * The same table drives both directions: export writes these columns in this
 * order, and import reads them by these headers. One table rather than two is
 * what makes the round trip — export, edit in Excel, import the same file —
 * hold, instead of being a claim nobody checks.
 */

export type ColumnKind =
  | "text"
  /** A whole number or decimal. Blank means "not set". */
  | "number"
  /** `yes`/`no`, `true`/`false`, `1`/`0`. Blank means "not set". */
  | "boolean"
  /** DRAFT / PUBLISHED / ARCHIVED, however the type expresses it. */
  | "status"
  /** Several values in one cell, separated by semicolons. */
  | "list"
  /** Another record, named by its slug (or an email, for a person). */
  | "ref";

export type Column = {
  /** The header as exported, and what import matches (loosely — see readTable). */
  header: string;
  kind: ColumnKind;
  /** Shown in the admin's column reference, so nobody has to read this file. */
  note: string;
};

/** A row's fate, decided before anything is written. */
export type RowPlan =
  | { outcome: "create"; line: number; label: string; values: Record<string, unknown> }
  | {
      outcome: "update";
      line: number;
      label: string;
      id: string;
      values: Record<string, unknown>;
      /** Which columns the file actually changes. Empty means nothing to do. */
      changed: readonly string[];
    }
  | { outcome: "unchanged"; line: number; label: string; id: string }
  | { outcome: "error"; line: number; label: string; errors: readonly string[] };

export type ImportPlan = {
  columns: readonly Column[];
  /** Headers in the file this type does not know. Ignored, but said out loud. */
  unknownHeaders: readonly string[];
  rows: readonly RowPlan[];
  counts: { create: number; update: number; unchanged: number; error: number };
};

export type ImportOutcome = {
  created: number;
  updated: number;
  unchanged: number;
  /** Set when a row failed while writing, after the plan said it would not. */
  stoppedAt: { line: number; message: string } | null;
};

export type TransferMeta = {
  label: string;
  plural: string;
  columns: readonly Column[];
  viewPermission: Permission;
  createPermission: Permission;
  editPermission: Permission;
  /**
   * The column that identifies an existing record when `id` is blank. Null
   * means the type has no natural key, so a row without an id always creates.
   */
  naturalKey: string | null;
  /** Said on the import screen: what a CSV cannot carry for this type. */
  omits: readonly string[];
};
