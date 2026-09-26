/**
 * Numbers as spreadsheets write them.
 *
 * Excel, Sheets and every ad platform's export write a thousands separator
 * once a number passes a thousand — `1,204` — and quote the cell so the comma
 * survives. By the time the cell reaches a schema the quoting is gone and the
 * comma is not, and `Number("1,204")` is `NaN`. Stripping the separators is a
 * fact about reading a spreadsheet, not about any one domain, so it lives here
 * and everything that reads a CSV uses it.
 *
 * Only separators are removed. A currency symbol, a percent sign or a stray
 * word still makes the cell unreadable, and unreadable is reported rather than
 * guessed at.
 */
export function unseparate(raw: string): string {
  return raw.trim().replace(/,/g, "");
}
