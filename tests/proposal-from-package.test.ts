import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createProposalFromPackage } from "@/lib/services/proposal.service";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * The package → proposal handoff.
 *
 * The point of these is the money: a figure quoted from a package must equal
 * the figure stored on the proposal, to the paisa, because both go through
 * lib/money (CLAUDE.md 2 rule 1).
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("createProposalFromPackage", () => {
  let prisma: PrismaClient;
  let actor: Actor;
  let viewer: Actor;
  let packageId: string;
  const created: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const user = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });

    const base = {
      userId: user.id,
      name: "Test",
      email: "t@example.test",
      type: "STAFF" as const,
      roleName: "SALES_MANAGER" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };
    actor = { ...base, permissions: new Set(["proposals.create"]) };
    viewer = { ...base, permissions: new Set(["proposals.view"]) };

    const pkg = await prisma.servicePackage.create({
      data: {
        slug: "prop-test-package",
        name: "Growth Test",
        tagline: "For the arithmetic.",
        price: "125000.00",
        currency: "INR",
        taxRate: "18.000",
        billingType: "MONTHLY",
        status: "PUBLISHED",
        features: {
          create: [
            { label: "Two channels", detail: "SEO plus paid", isIncluded: true, order: 0 },
            { label: "Dedicated strategist", isIncluded: true, order: 1 },
            { label: "Quarterly business review", isIncluded: false, order: 2 },
          ],
        },
      },
      select: { id: true },
    });
    packageId = pkg.id;
  });

  afterAll(async () => {
    await prisma.proposalItem.deleteMany({ where: { proposalId: { in: created } } });
    await prisma.proposal.deleteMany({ where: { id: { in: created } } });
    await prisma.packageFeature.deleteMany({ where: { packageId } });
    await prisma.servicePackage.deleteMany({ where: { id: packageId } });
    await prisma.$disconnect();
  });

  it("creates a draft proposal priced from the package", async () => {
    const proposal = await createProposalFromPackage(actor, { packageId });
    created.push(proposal.id);

    const stored = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
      select: {
        status: true,
        currency: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        total: true,
        items: { select: { quantity: true, unitPrice: true, taxRate: true, lineTotal: true } },
      },
    });

    expect(stored.status).toBe("DRAFT");
    expect(stored.currency).toBe("INR");
    // 125000 + 18% = 147500.00
    expect(stored.subtotal.toString()).toBe("125000");
    expect(stored.taxTotal.toString()).toBe("22500");
    expect(stored.total.toString()).toBe("147500");
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]?.lineTotal.toString()).toBe("147500");
  });

  it("applies a discount to the gross before tax", async () => {
    const proposal = await createProposalFromPackage(actor, { packageId, discountRate: "10" });
    created.push(proposal.id);

    const stored = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
      select: { subtotal: true, discountTotal: true, taxTotal: true, total: true },
    });

    // 125000 gross, 10% off = 12500, net 112500, 18% tax = 20250, total 132750.
    expect(stored.subtotal.toString()).toBe("125000");
    expect(stored.discountTotal.toString()).toBe("12500");
    expect(stored.taxTotal.toString()).toBe("20250");
    expect(stored.total.toString()).toBe("132750");
  });

  it("multiplies by quantity exactly", async () => {
    const proposal = await createProposalFromPackage(actor, { packageId, quantity: 3 });
    created.push(proposal.id);

    const stored = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposal.id },
      select: { subtotal: true, total: true },
    });

    expect(stored.subtotal.toString()).toBe("375000");
    expect(stored.total.toString()).toBe("442500");
  });

  it("describes the included features on the line, and excludes the rest", async () => {
    const proposal = await createProposalFromPackage(actor, { packageId });
    created.push(proposal.id);

    const item = await prisma.proposalItem.findFirstOrThrow({
      where: { proposalId: proposal.id },
      select: { description: true },
    });

    expect(item.description).toContain("Two channels (SEO plus paid)");
    expect(item.description).toContain("Dedicated strategist");
    expect(item.description).not.toContain("Quarterly business review");
  });

  it("issues sequential proposal numbers for the year", async () => {
    const a = await createProposalFromPackage(actor, { packageId });
    const b = await createProposalFromPackage(actor, { packageId });
    created.push(a.id, b.id);

    const year = new Date().getFullYear();
    expect(a.number.startsWith(`PRO-${year}-`)).toBe(true);
    expect(Number(b.number.slice(-4))).toBe(Number(a.number.slice(-4)) + 1);
  });

  it("requires the create permission", async () => {
    await expect(createProposalFromPackage(viewer, { packageId })).rejects.toThrow(ForbiddenError);
  });

  it("rejects an unknown package", async () => {
    await expect(
      createProposalFromPackage(actor, { packageId: "does-not-exist" }),
    ).rejects.toThrow(NotFoundError);
  });
});
