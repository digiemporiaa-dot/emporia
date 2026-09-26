/**
 * Turning a spreadsheet cell into a value, and back.
 *
 * Pure, so the awkward cases — "Yes", "TRUE", "1", a stray space, a blank —
 * are unit-testable without a database. Every reader returns either a value or
 * a message an operator can act on; none of them guess. A cell nobody can make
 * sense of is a reported error, never a silent zero or a silent false, because
 * a silently-false `isActive` takes a city off the website.
 */

import { unseparate } from "@/lib/csv/number";

export type Read<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T,>(value: T): Read<T> => ({ ok: true, value });
const bad = (message: string): Read<never> => ({ ok: false, message });

const TRUE = new Set(["yes", "y", "true", "t", "1", "on"]);
const FALSE = new Set(["no", "n", "false", "f", "0", "off"]);

export function readBoolean(raw: string): Read<boolean | null> {
  const value = raw.trim().toLowerCase();
  if (value === "") return ok(null);
  if (TRUE.has(value)) return ok(true);
  if (FALSE.has(value)) return ok(false);
  return bad(`"${raw.trim()}" is not yes or no.`);
}

export function writeBoolean(value: boolean): string {
  return value ? "yes" : "no";
}

export function readNumber(raw: string): Read<number | null> {
  const value = raw.trim();
  if (value === "") return ok(null);
  const cleaned = unseparate(value);
  const parsed = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(parsed)) return bad(`"${value}" is not a number.`);
  return ok(parsed);
}

export function writeNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type Status = (typeof STATUSES)[number];

export function readStatus(raw: string, allowed: readonly Status[]): Read<Status | null> {
  const value = raw.trim().toUpperCase();
  if (value === "") return ok(null);
  if (!(STATUSES as readonly string[]).includes(value)) {
    return bad(`"${raw.trim()}" is not a status. Use ${allowed.join(", ")}.`);
  }
  if (!allowed.includes(value as Status)) {
    return bad(`A ${value.toLowerCase()} state does not exist for this type. Use ${allowed.join(", ")}.`);
  }
  return ok(value as Status);
}

/**
 * Several values in one cell.
 *
 * Semicolons, not commas: a comma inside a cell is legal CSV but means the
 * operator has to quote the cell, and the first time they forget the file is
 * silently misread. A semicolon needs no quoting and reads the same everywhere.
 */
export function readList(raw: string): string[] {
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function writeList(values: readonly string[]): string {
  return values.join("; ");
}

export function writeText(value: string | null | undefined): string {
  return value ?? "";
}
