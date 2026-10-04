import "server-only";
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@/lib/config/env";
import { formatMoney } from "@/lib/money";

const DEFAULT_CHROMIUM = ["/usr/bin/chromium", "/usr/bin/chromium-browser"];

export class PdfUnavailableError extends Error {
  constructor() {
    super("No headless Chromium is installed, so invoice PDFs cannot be generated.");
    this.name = "PdfUnavailableError";
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The configured browser if it exists, else the Debian package's, else null. */
export function chromiumPath(): string | null {
  const configured = env().CHROMIUM_PATH?.trim();
  const candidates = configured ? [configured] : DEFAULT_CHROMIUM;
  return candidates.find(isExecutable) ?? null;
}

export function isPdfAvailable(): boolean {
  return chromiumPath() !== null;
}

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

// -------------------------------------------------------------------------
// Types — matches what getInvoice() returns (money as strings)
// -------------------------------------------------------------------------

export type InvoiceItem = {
  name: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
  lineTotal: string;
};

export type InvoiceData = {
  number: string;
  status: string;
  currency: string;
  issuedAt: Date;
  dueAt: Date;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  paidTotal: string;
  dueTotal: string;
  notes: string | null;
  items: InvoiceItem[];
  client: { name: string };
};

export type ClientProfile = {
  legalName: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
};

export type AgencyInfo = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

// -------------------------------------------------------------------------
// HTML template
// -------------------------------------------------------------------------

function esc(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: string, currency: string): string {
  return esc(formatMoney(value, currency));
}

function addressBlock(profile: ClientProfile | null): string {
  if (!profile) return "";
  const lines = [
    profile.addressLine1,
    profile.addressLine2,
    [profile.city, profile.region, profile.postalCode].filter(Boolean).join(", "),
    profile.countryCode,
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return lines.map((l) => esc(l)).join("<br>");
}

export function renderInvoiceHtml(
  invoice: InvoiceData,
  clientProfile: ClientProfile | null,
  agency: AgencyInfo,
): string {
  const hasDiscount = invoice.items.some((i) => Number(i.discountRate) > 0);
  const hasTax = invoice.items.some((i) => Number(i.taxRate) > 0);
  const discountNonZero = Number(invoice.discountTotal) > 0;
  const taxNonZero = Number(invoice.taxTotal) > 0;
  const paidNonZero = Number(invoice.paidTotal) > 0;

  const itemRows = invoice.items
    .map(
      (item) => `
      <tr>
        <td class="item-name">
          ${esc(item.name)}
          ${item.description ? `<div class="item-desc">${esc(item.description)}</div>` : ""}
        </td>
        <td class="num">${esc(item.quantity)}</td>
        <td class="num">${money(item.unitPrice, invoice.currency)}</td>
        ${hasDiscount ? `<td class="num">${esc(item.discountRate)}%</td>` : ""}
        ${hasTax ? `<td class="num">${esc(item.taxRate)}%</td>` : ""}
        <td class="num bold">${money(item.lineTotal, invoice.currency)}</td>
      </tr>`,
    )
    .join("");

  const clientAddr = addressBlock(clientProfile);
  const clientName = clientProfile?.legalName || invoice.client.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Invoice ${esc(invoice.number)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm 22mm 18mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 10px;
    line-height: 1.45;
    color: #1a1a1a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .brand { font-size: 20px; font-weight: 700; color: #002A3A; letter-spacing: -0.02em; }
  .brand-sub { font-size: 9px; color: #667; margin-top: 4px; }
  .invoice-title { text-align: right; }
  .invoice-title h1 { font-size: 28px; font-weight: 700; color: #002A3A; letter-spacing: -0.03em; text-transform: uppercase; }
  .invoice-number { font-size: 12px; font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace; color: #DF1F38; margin-top: 4px; font-weight: 600; }

  .parties { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 24px; }
  .party { flex: 1; min-width: 0; }
  .party-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #9aa; margin-bottom: 6px; }
  .party-name { font-size: 12px; font-weight: 600; color: #002A3A; margin-bottom: 3px; }
  .party-detail { font-size: 9px; color: #556; line-height: 1.5; }

  .meta { display: flex; gap: 32px; margin-bottom: 22px; padding: 10px 14px; background: #f4f6f8; border-radius: 4px; }
  .meta-item { }
  .meta-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #9aa; }
  .meta-value { font-size: 11px; font-weight: 600; color: #002A3A; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead th { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #9aa; border-bottom: 2px solid #002A3A; padding: 8px 6px; text-align: left; }
  thead th.num { text-align: right; }
  tbody td { padding: 8px 6px; border-bottom: 1px solid #e8eaed; font-size: 10px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.bold { font-weight: 600; color: #002A3A; }
  .item-name { color: #002A3A; font-weight: 500; }
  .item-desc { color: #667; font-size: 9px; margin-top: 2px; }

  .totals { display: flex; justify-content: flex-end; }
  .totals-table { min-width: 220px; }
  .totals-row { display: flex; justify-content: space-between; gap: 24px; padding: 4px 0; font-size: 10px; }
  .totals-label { color: #667; }
  .totals-value { font-variant-numeric: tabular-nums; text-align: right; }
  .totals-divider { border-top: 2px solid #002A3A; margin-top: 4px; padding-top: 6px; }
  .totals-grand .totals-label,
  .totals-grand .totals-value { font-size: 14px; font-weight: 700; color: #002A3A; }
  .totals-due .totals-value { color: #DF1F38; font-weight: 700; }

  .notes { margin-top: 24px; padding-top: 14px; border-top: 1px solid #e8eaed; }
  .notes-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #9aa; margin-bottom: 6px; }
  .notes-text { font-size: 9px; color: #556; white-space: pre-line; }

  .footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px 18mm; font-size: 8px; color: #9aa; text-align: center; border-top: 1px solid #e8eaed; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="brand">${esc(agency.name)}</div>
    ${agency.address ? `<div class="brand-sub">${esc(agency.address)}</div>` : ""}
    ${agency.email || agency.phone ? `<div class="brand-sub">${[agency.email, agency.phone].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
  </div>
  <div class="invoice-title">
    <h1>Invoice</h1>
    <div class="invoice-number">${esc(invoice.number)}</div>
  </div>
</div>

<div class="parties">
  <div class="party">
    <div class="party-label">Bill to</div>
    <div class="party-name">${esc(clientName)}</div>
    ${clientAddr ? `<div class="party-detail">${clientAddr}</div>` : ""}
    ${clientProfile?.taxId ? `<div class="party-detail">Tax ID: ${esc(clientProfile.taxId)}</div>` : ""}
    ${clientProfile?.publicEmail ? `<div class="party-detail">${esc(clientProfile.publicEmail)}</div>` : ""}
    ${clientProfile?.publicPhone ? `<div class="party-detail">${esc(clientProfile.publicPhone)}</div>` : ""}
  </div>
  <div class="party" style="text-align: right;">
    <div class="party-label">From</div>
    <div class="party-name">${esc(agency.name)}</div>
    ${agency.address ? `<div class="party-detail">${esc(agency.address)}</div>` : ""}
  </div>
</div>

<div class="meta">
  <div class="meta-item">
    <div class="meta-label">Issue date</div>
    <div class="meta-value">${DATE.format(invoice.issuedAt)}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">Due date</div>
    <div class="meta-value">${DATE.format(invoice.dueAt)}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">Status</div>
    <div class="meta-value">${esc(invoice.status)}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">Currency</div>
    <div class="meta-value">${esc(invoice.currency)}</div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Item</th>
      <th class="num">Qty</th>
      <th class="num">Unit price</th>
      ${hasDiscount ? '<th class="num">Disc.</th>' : ""}
      ${hasTax ? '<th class="num">Tax</th>' : ""}
      <th class="num">Total</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<div class="totals">
  <div class="totals-table">
    <div class="totals-row">
      <span class="totals-label">Subtotal</span>
      <span class="totals-value">${money(invoice.subtotal, invoice.currency)}</span>
    </div>
    ${
      discountNonZero
        ? `<div class="totals-row">
      <span class="totals-label">Discount</span>
      <span class="totals-value">&minus;${money(invoice.discountTotal, invoice.currency)}</span>
    </div>`
        : ""
    }
    ${
      taxNonZero
        ? `<div class="totals-row">
      <span class="totals-label">Tax</span>
      <span class="totals-value">${money(invoice.taxTotal, invoice.currency)}</span>
    </div>`
        : ""
    }
    <div class="totals-row totals-divider totals-grand">
      <span class="totals-label">Total</span>
      <span class="totals-value">${money(invoice.total, invoice.currency)}</span>
    </div>
    ${
      paidNonZero
        ? `<div class="totals-row">
      <span class="totals-label">Received</span>
      <span class="totals-value">${money(invoice.paidTotal, invoice.currency)}</span>
    </div>
    <div class="totals-row totals-due">
      <span class="totals-label">Outstanding</span>
      <span class="totals-value">${money(invoice.dueTotal, invoice.currency)}</span>
    </div>`
        : ""
    }
  </div>
</div>

${
  invoice.notes
    ? `<div class="notes">
  <div class="notes-label">Notes</div>
  <div class="notes-text">${esc(invoice.notes)}</div>
</div>`
    : ""
}

<div class="footer">
  ${esc(agency.name)}${agency.email ? ` · ${esc(agency.email)}` : ""}${agency.phone ? ` · ${esc(agency.phone)}` : ""}
</div>

</body>
</html>`;
}

// -------------------------------------------------------------------------
// PDF generation via headless Chromium
// -------------------------------------------------------------------------

function chromiumPdf(
  chromium: string,
  dir: string,
  htmlPath: string,
  pdfPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      chromium,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        // The runner's user has no writable home; keep the profile with the job.
        `--user-data-dir=${join(dir, "profile")}`,
        `--print-to-pdf=${pdfPath}`,
        "--no-pdf-header-footer",
        htmlPath,
      ],
      { timeout: 15_000 },
      (error) => {
        if (error) reject(new Error(`PDF generation failed: ${error.message}`));
        else resolve();
      },
    );
  });
}

export async function generateInvoicePdf(
  invoice: InvoiceData,
  clientProfile: ClientProfile | null,
  agency: AgencyInfo,
): Promise<Buffer> {
  const chromium = chromiumPath();
  if (!chromium) throw new PdfUnavailableError();

  const html = renderInvoiceHtml(invoice, clientProfile, agency);

  const dir = await mkdtemp(join(tmpdir(), "inv-"));
  const htmlPath = join(dir, "invoice.html");
  const pdfPath = join(dir, "invoice.pdf");

  try {
    await writeFile(htmlPath, html, "utf-8");
    await chromiumPdf(chromium, dir, htmlPath, pdfPath);
    return await readFile(pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
