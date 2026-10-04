import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { toMoneyString } from "@/lib/money";
import { generateInvoicePdf } from "@/lib/finance/invoice-pdf";
import { siteSettings } from "@/lib/content/queries";
import { log } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdfLog = log("invoice-pdf");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { invoiceId } = await params;

  const isStaff = actor.type === "STAFF" && can(actor, "invoices.view");
  const isPortal = actor.type === "CLIENT" && !!actor.clientId;

  if (!isStaff && !isPortal) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const where: Prisma.InvoiceWhereInput = {
    id: invoiceId,
    deletedAt: null,
  };
  if (isPortal) {
    where.clientId = actor.clientId!;
    where.status = { not: "DRAFT" };
  }

  const invoice = await db.invoice.findFirst({
    where,
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      issuedAt: true,
      dueAt: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      total: true,
      paidTotal: true,
      dueTotal: true,
      notes: true,
      clientId: true,
      client: { select: { id: true, name: true } },
      items: {
        orderBy: { order: "asc" },
        select: {
          name: true,
          description: true,
          quantity: true,
          unitPrice: true,
          discountRate: true,
          taxRate: true,
          lineTotal: true,
        },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const [clientProfile, settings] = await Promise.all([
    db.clientBusinessProfile.findUnique({
      where: { clientId: invoice.clientId },
      select: {
        legalName: true,
        taxId: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        region: true,
        postalCode: true,
        countryCode: true,
        publicPhone: true,
        publicEmail: true,
      },
    }),
    siteSettings(["site.name", "site.email", "site.phone", "site.address"]),
  ]);

  const invoiceData = {
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    subtotal: toMoneyString(invoice.subtotal),
    discountTotal: toMoneyString(invoice.discountTotal),
    taxTotal: toMoneyString(invoice.taxTotal),
    total: toMoneyString(invoice.total),
    paidTotal: toMoneyString(invoice.paidTotal),
    dueTotal: toMoneyString(invoice.dueTotal),
    notes: invoice.notes,
    client: invoice.client,
    items: invoice.items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: toMoneyString(item.unitPrice),
      discountRate: item.discountRate.toString(),
      taxRate: item.taxRate.toString(),
      lineTotal: toMoneyString(item.lineTotal),
    })),
  };

  const agency = {
    name: settings["site.name"] ?? "Emporia",
    email: settings["site.email"] ?? null,
    phone: settings["site.phone"] ?? null,
    address: settings["site.address"] ?? null,
  };

  try {
    const pdf = await generateInvoicePdf(invoiceData, clientProfile, agency);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.number}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    pdfLog.error({ invoiceId, err: error }, "PDF generation failed");
    return NextResponse.json(
      { error: "Could not generate the invoice PDF. Try again shortly." },
      { status: 500 },
    );
  }
}
