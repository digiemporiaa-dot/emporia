/**
 * A CSV reader that handles the files people actually produce.
 *
 * There is already a CSV split in `campaign.service.ts` — `line.split(",")` —
 * and it is wrong for any cell containing a comma, which for this application
 * means any description, quote or answer anybody exports from a spreadsheet.
 * A naive split does not fail loudly on such a file; it silently shifts every
 * column after the comma, and the operator finds out when the wrong text is on
 * the website. So this is a real reader, and the campaign import uses it too.
 *
 * It follows RFC 4180 with the concessions every spreadsheet needs:
 *
 * - Fields may be quoted; a quoted field may contain commas, newlines and
 *   doubled quotes (`""` → `"`).
 * - Rows may end `\n` or `\r\n`; a bare `\r` also ends a row.
 * - A UTF-8 byte-order mark at the start is stripped. Excel writes one, and a
 *   header read as `﻿slug` matches no column at all.
 * - A trailing newline does not produce a phantom empty row.
 *
 * It is deliberately not streaming. The importer caps the file well below the
 * size where that would matter, and a streaming parser that nobody needs is a
 * second implementation to keep correct.
 */

export type CsvRow = readonly string[];

/** What went wrong, and where, in terms an operator can act on. */
export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

export function parseCsv(input: string): CsvRow[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  // Tracked for the error message only: a quote opened on line 40 and never
  // closed is reported against line 40, not against the end of the file.
  let quoteOpenedAt = 1;
  let line = 1;

  const endField = () => {
    row.push(field);
    field = "";
    started = false;
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (started && field.length > 0) {
        // A quote in the middle of an unquoted field (`Rs 1,200 "all in"`) is
        // a literal quote, not the start of quoting. Refusing it would reject
        // files that every spreadsheet reads without complaint.
        field += char;
      } else {
        quoted = true;
        started = true;
        quoteOpenedAt = line;
      }
      continue;
    }

    if (char === ",") {
      endField();
      continue;
    }

    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
      continue;
    }

    field += char;
    started = true;
  }

  if (quoted) {
    throw new CsvError("A quoted value is never closed — check for a stray double quote.", quoteOpenedAt);
  }

  // A file ending in a newline has already had its last row pushed; anything
  // left in hand is a final row without one.
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

/**
 * Parse into objects keyed by header.
 *
 * Headers are matched case-insensitively with spaces, underscores and hyphens
 * ignored, so `Short description`, `short_description` and `shortDescription`
 * are the same column. People edit these files in Excel; insisting on one
 * spelling would reject correct data over a capital letter.
 */
export function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export type CsvTable = {
  /** Headers as written in the file, in file order. */
  headers: readonly string[];
  /** Normalised header → index, for looking a column up. */
  index: ReadonlyMap<string, number>;
  /** Data rows, header row excluded. */
  rows: readonly CsvRow[];
  /** The file line each data row started on, for error messages. */
  lineOf: (rowIndex: number) => number;
};

export function readTable(input: string): CsvTable {
  const rows = parseCsv(input);
  const blank = (row: CsvRow) => row.every((cell) => cell.trim() === "");

  const headerAt = rows.findIndex((row) => !blank(row));
  if (headerAt === -1) throw new CsvError("That file has no rows.", 1);

  const headers = (rows[headerAt] as CsvRow).map((cell) => cell.trim());
  const index = new Map<string, number>();
  const duplicates: string[] = [];
  headers.forEach((header, at) => {
    const key = normaliseHeader(header);
    if (key === "") return;
    if (index.has(key)) duplicates.push(header);
    else index.set(key, at);
  });

  if (duplicates.length > 0) {
    // Silently keeping the first would mean an operator's edit to the second
    // column is ignored with no sign of it.
    throw new CsvError(`The header has two "${duplicates[0]}" columns.`, headerAt + 1);
  }

  // Blank rows are dropped rather than reported: a spreadsheet leaves them
  // behind constantly, and they carry no intent.
  const body: { row: CsvRow; line: number }[] = [];
  for (let at = headerAt + 1; at < rows.length; at += 1) {
    const row = rows[at] as CsvRow;
    if (blank(row)) continue;
    body.push({ row, line: at + 1 });
  }

  return {
    headers,
    index,
    rows: body.map((entry) => entry.row),
    lineOf: (rowIndex) => body[rowIndex]?.line ?? 0,
  };
}
