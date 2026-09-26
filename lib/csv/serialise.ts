/**
 * Writing CSV.
 *
 * The mirror of the reader: whatever this writes, `parseCsv` reads back
 * identically. That round trip is the whole point of the export — an operator
 * exports, edits in a spreadsheet, and imports the same file back.
 */

/**
 * Quote a cell only where it needs it.
 *
 * The leading-character guard is not cosmetic. A cell beginning `=`, `+`, `-`
 * or `@` is treated as a formula by Excel and Sheets when the file is opened,
 * which turns exported content into executed input on someone else's machine.
 * Prefixing a tab keeps the text intact and stops the formula.
 */
function cell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const text = risky ? `\t${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  // A trailing newline: every tool writes one, and its absence makes some
  // readers drop the last row.
  return `${lines.join("\r\n")}\r\n`;
}
