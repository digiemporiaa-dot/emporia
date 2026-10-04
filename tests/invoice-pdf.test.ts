import { existsSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import {
  generateInvoicePdf,
  isPdfAvailable,
  PdfUnavailableError,
  renderInvoiceHtml,
  type InvoiceData,
  type ClientProfile,
  type AgencyInfo,
} from "@/lib/finance/invoice-pdf";

const agency: AgencyInfo = {
  name: "Emporia Digital",
  email: "hello@emporia.example",
  phone: "+91 124 000 0000",
  address: "123 Business Park, Gurugram",
};

const profile: ClientProfile = {
  legalName: "Acme Pvt Ltd",
  taxId: "GSTIN1234567890",
  addressLine1: "42 MG Road",
  addressLine2: "Suite 5",
  city: "Mumbai",
  region: "Maharashtra",
  postalCode: "400001",
  countryCode: "IN",
  publicPhone: "+91 22 1234 5678",
  publicEmail: "billing@acme.example",
};

function invoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    number: "INV-2026-0001",
    status: "SENT",
    currency: "INR",
    issuedAt: new Date("2026-09-15"),
    dueAt: new Date("2026-10-15"),
    subtotal: "10000.00",
    discountTotal: "1000.00",
    taxTotal: "1620.00",
    total: "10620.00",
    paidTotal: "0.00",
    dueTotal: "10620.00",
    notes: null,
    client: { name: "Acme Corp" },
    items: [
      {
        name: "SEO Audit",
        description: "Full technical and content audit",
        quantity: "1",
        unitPrice: "5000.00",
        discountRate: "10",
        taxRate: "18",
        lineTotal: "5310.00",
      },
      {
        name: "Content Writing",
        description: null,
        quantity: "10",
        unitPrice: "500.00",
        discountRate: "10",
        taxRate: "18",
        lineTotal: "5310.00",
      },
    ],
    ...overrides,
  };
}

describe("invoice PDF HTML", () => {
  it("contains the invoice number and client name", () => {
    const html = renderInvoiceHtml(invoice(), profile, agency);
    expect(html).toContain("INV-2026-0001");
    expect(html).toContain("Acme Pvt Ltd");
  });

  it("renders all line items", () => {
    const html = renderInvoiceHtml(invoice(), profile, agency);
    expect(html).toContain("SEO Audit");
    expect(html).toContain("Full technical and content audit");
    expect(html).toContain("Content Writing");
  });

  it("shows totals as formatted currency", () => {
    const html = renderInvoiceHtml(invoice(), profile, agency);
    // Subtotal, discount, tax, total should all appear
    expect(html).toContain("Subtotal");
    expect(html).toContain("Discount");
    expect(html).toContain("Tax");
    expect(html).toContain("Total");
  });

  it("escapes HTML in client and agency names", () => {
    const html = renderInvoiceHtml(
      invoice({ client: { name: '<script>alert("xss")</script>' } }),
      null,
      { ...agency, name: "A&B <Agency>" },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B &lt;Agency&gt;");
  });

  it("hides discount column when all rates are zero", () => {
    const items = invoice().items.map((i) => ({ ...i, discountRate: "0" }));
    const html = renderInvoiceHtml(
      invoice({ items, discountTotal: "0.00" }),
      profile,
      agency,
    );
    expect(html).not.toContain("Disc.");
    expect(html).not.toContain("Discount");
  });

  it("hides tax column when all rates are zero", () => {
    const items = invoice().items.map((i) => ({ ...i, taxRate: "0" }));
    const html = renderInvoiceHtml(
      invoice({ items, taxTotal: "0.00" }),
      profile,
      agency,
    );
    expect(html).not.toContain('>Tax<');
  });

  it("shows outstanding when payments exist", () => {
    const html = renderInvoiceHtml(
      invoice({ paidTotal: "5000.00", dueTotal: "5620.00" }),
      profile,
      agency,
    );
    expect(html).toContain("Received");
    expect(html).toContain("Outstanding");
  });

  it("hides received/outstanding when nothing paid", () => {
    const html = renderInvoiceHtml(invoice(), profile, agency);
    expect(html).not.toContain("Received");
    expect(html).not.toContain("Outstanding");
  });

  it("renders notes when present", () => {
    const html = renderInvoiceHtml(
      invoice({ notes: "Please pay within 30 days." }),
      profile,
      agency,
    );
    expect(html).toContain("Notes");
    expect(html).toContain("Please pay within 30 days.");
  });

  it("hides notes section when null", () => {
    const html = renderInvoiceHtml(invoice(), profile, agency);
    expect(html).not.toContain('<div class="notes">');
  });

  it("renders client address from business profile", () => {
    const html = renderInvoiceHtml(invoice(), profile, agency);
    expect(html).toContain("42 MG Road");
    expect(html).toContain("Suite 5");
    expect(html).toContain("Mumbai");
    expect(html).toContain("GSTIN1234567890");
  });

  it("falls back to client.name when no business profile", () => {
    const html = renderInvoiceHtml(invoice(), null, agency);
    expect(html).toContain("Acme Corp");
  });

  it("renders agency contact in the header and footer", () => {
    const html = renderInvoiceHtml(invoice(), null, agency);
    expect(html).toContain("Emporia Digital");
    expect(html).toContain("hello@emporia.example");
    expect(html).toContain("+91 124 000 0000");
  });

  it("is a complete HTML document", () => {
    const html = renderInvoiceHtml(invoice(), null, agency);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });
});

/** Playwright's Chromium in dev containers, or whatever CHROMIUM_PATH names. */
function localChromium(): string | null {
  if (process.env["CHROMIUM_PATH"]) return process.env["CHROMIUM_PATH"];
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return null;
  const dir = readdirSync(root).find((name) => /^chromium-\d+$/.test(name));
  const path = dir ? `${root}/${dir}/chrome-linux/chrome` : null;
  return path && existsSync(path) ? path : null;
}

describe("invoice PDF generation", () => {
  const original = process.env["CHROMIUM_PATH"];
  afterEach(() => {
    if (original === undefined) delete process.env["CHROMIUM_PATH"];
    else process.env["CHROMIUM_PATH"] = original;
    resetEnvCache();
  });

  it("refuses honestly when no browser is installed", async () => {
    process.env["CHROMIUM_PATH"] = "/nonexistent/chromium";
    resetEnvCache();
    expect(isPdfAvailable()).toBe(false);
    await expect(generateInvoicePdf(invoice(), profile, agency)).rejects.toThrow(PdfUnavailableError);
  });

  const chromium = localChromium();
  it.skipIf(!chromium)("renders a real PDF", async () => {
    process.env["CHROMIUM_PATH"] = chromium!;
    resetEnvCache();
    const pdf = await generateInvoicePdf(invoice(), profile, agency);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);
});
