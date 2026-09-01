import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { publishPage, unpublishPage, checkPublishable } from "@/lib/services/serviceCityPage.service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * The Phase 5 exit criterion, executable:
 *   - two pages for the same service differ in substance and both publish
 *   - a thin page refuses to leave DRAFT
 *
 * These go through the service layer with a real actor, so the permission
 * check and the publish gate are exercised, not just the pure function.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

/**
 * Actors reference a real seeded user: AuditLog.actorId is a foreign key, and
 * every mutation here writes an audit row in the same transaction, so a
 * fabricated id would fail the constraint — correctly.
 */
let actorUserId = "";

function actor(permissions: string[], roleName: Actor["roleName"] = "CONTENT_MANAGER"): Actor {
  return {
    userId: actorUserId,
    name: "Test",
    email: "test@example.test",
    type: "STAFF",
    roleName,
    roleId: "test-role",
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: null,
  };
}

const EDITOR_PERMISSIONS = ["catalog.view", "catalog.create", "catalog.edit", "catalog.publish"];
const editor = () => actor(EDITOR_PERMISSIONS);
const viewer = () => actor(["catalog.view"]);

function words(n: number, seed: string): string {
  const base = seed.split(" ");
  const out: string[] = [];
  while (out.length < n) out.push(base[out.length % base.length] as string);
  return out.join(" ");
}

describeDb("service-city publishing", () => {
  let prisma: PrismaClient;
  let serviceId: string;
  const cityIds: Record<string, string> = {};
  const pageIds: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const user = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });
    actorUserId = user.id;

    const service = await prisma.service.create({
      data: {
        slug: "scp-test-service",
        name: "Test Service",
        shortDescription: "For local page tests.",
        status: "PUBLISHED",
      },
      select: { id: true },
    });
    serviceId = service.id;

    for (const [key, name, state] of [
      ["rich", "Testville", "Teststate"],
      ["other", "Otherton", "Teststate"],
      ["thin", "Thinbury", "Teststate"],
    ] as const) {
      const city = await prisma.city.create({
        data: { slug: `scp-${key}`, name, state, isActive: true, latitude: 1, longitude: 1 },
        select: { id: true },
      });
      cityIds[key] = city.id;
    }

    // Local proof: one testimonial per city, so that check is satisfied and the
    // tests isolate the substance and uniqueness rules.
    for (const key of ["rich", "other", "thin"] as const) {
      await prisma.testimonial.create({
        data: {
          authorName: `Author ${key}`,
          quote: "A local testimonial.",
          cityId: cityIds[key] as string,
          serviceId,
          status: "PUBLISHED",
        },
      });
    }

    // A complete page.
    const richSeo = await prisma.seo.create({
      data: {
        metaTitle: "Test Service in Testville",
        metaDescription: "A meta description for Testville that is comfortably long enough to pass.",
      },
    });
    const rich = await prisma.serviceCityPage.create({
      data: {
        serviceId,
        cityId: cityIds["rich"] as string,
        seoId: richSeo.id,
        localIntro: words(130, "Testville buyers behave differently because the local market is dominated by manufacturing"),
        marketContext: words(110, "Industrial procurement cycles here run long and decisions involve several stakeholders"),
        industries: ["Manufacturing", "Logistics", "Engineering"],
        positioning: "Positioning for Testville.",
        ctaHeading: "Work with us in Testville",
        ctaBody: "Get in touch.",
        status: "DRAFT",
      },
      select: { id: true },
    });
    pageIds["rich"] = rich.id;

    for (let i = 0; i < 3; i += 1) {
      await prisma.fAQ.create({
        data: {
          serviceCityPageId: rich.id,
          question: `A local question number ${i} for Testville?`,
          answer: "An answer with enough substance to be worth publishing on the page.",
          order: i,
          isActive: true,
        },
      });
    }

    // An empty page.
    const thin = await prisma.serviceCityPage.create({
      data: {
        serviceId,
        cityId: cityIds["thin"] as string,
        localIntro: "We do this service in Thinbury.",
        industries: [],
        status: "DRAFT",
      },
      select: { id: true },
    });
    pageIds["thin"] = thin.id;
  });

  afterAll(async () => {
    await prisma.fAQ.deleteMany({ where: { serviceCityPage: { serviceId } } });
    await prisma.serviceCityPage.deleteMany({ where: { serviceId } });
    await prisma.testimonial.deleteMany({ where: { serviceId } });
    await prisma.seo.deleteMany({ where: { metaTitle: { startsWith: "Test Service in " } } });
    await prisma.city.deleteMany({ where: { slug: { startsWith: "scp-" } } });
    await prisma.service.deleteMany({ where: { id: serviceId } });
    await prisma.$disconnect();
  });

  it("publishes a page with genuine local content", async () => {
    const published = await publishPage(editor(), pageIds["rich"] as string);
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).not.toBeNull();
  });

  it("refuses to publish a thin page, and says exactly why", async () => {
    await expect(publishPage(editor(), pageIds["thin"] as string)).rejects.toThrow(ValidationError);

    const check = await checkPublishable(editor(), pageIds["thin"] as string);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/Local introduction/);
    expect(check.reasons.join(" ")).toMatch(/Local FAQs/);
  });

  it("leaves the thin page in DRAFT after a refused publish", async () => {
    const page = await prisma.serviceCityPage.findUniqueOrThrow({
      where: { id: pageIds["thin"] as string },
      select: { status: true, publishedAt: true },
    });
    expect(page.status).toBe("DRAFT");
    expect(page.publishedAt).toBeNull();
  });

  it("refuses a page templated from a published sibling", async () => {
    const richPage = await prisma.serviceCityPage.findUniqueOrThrow({
      where: { id: pageIds["rich"] as string },
      select: { localIntro: true, marketContext: true },
    });

    // Same content with the place name swapped — the classic templated page.
    const seo = await prisma.seo.create({
      data: {
        metaTitle: "Test Service in Otherton",
        metaDescription: "An Otherton meta description that is comfortably long enough to pass.",
      },
    });
    const clone = await prisma.serviceCityPage.create({
      data: {
        serviceId,
        cityId: cityIds["other"] as string,
        seoId: seo.id,
        localIntro: (richPage.localIntro ?? "").replaceAll("Testville", "Otherton"),
        marketContext: (richPage.marketContext ?? "").replaceAll("Testville", "Otherton"),
        industries: ["Manufacturing", "Logistics", "Engineering"],
        positioning: "Positioning for Otherton.",
        ctaHeading: "Work with us in Otherton",
        ctaBody: "Get in touch.",
        status: "DRAFT",
      },
      select: { id: true },
    });
    pageIds["other"] = clone.id;

    for (let i = 0; i < 3; i += 1) {
      await prisma.fAQ.create({
        data: {
          serviceCityPageId: clone.id,
          question: `A local question number ${i} for Otherton?`,
          answer: "An answer with enough substance to be worth publishing on the page.",
          order: i,
          isActive: true,
        },
      });
    }

    const check = await checkPublishable(editor(), clone.id);
    expect(check.checks.find((c) => c.key === "unique")?.passed).toBe(false);
    await expect(publishPage(editor(), clone.id)).rejects.toThrow(ValidationError);
  });

  it("requires the publish permission, not merely view", async () => {
    await expect(publishPage(viewer(), pageIds["rich"] as string)).rejects.toThrow(ForbiddenError);
    await expect(unpublishPage(viewer(), pageIds["rich"] as string)).rejects.toThrow(ForbiddenError);
  });

  it("can unpublish a published page", async () => {
    const updated = await unpublishPage(editor(), pageIds["rich"] as string);
    expect(updated.status).toBe("DRAFT");
  });
});
