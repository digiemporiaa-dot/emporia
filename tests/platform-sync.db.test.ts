import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ensureHomepage } from "@/prisma/ensure-homepage";
import { syncPlatform } from "@/prisma/platform";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Platform sync — what the container runs on every boot.
 *
 * Two failures this is here to prevent, both of which have already bitten a
 * deploy once: a release that adds a permission and does not grant it, so the
 * new screen 403s for everyone; and a database with no `home` page, so `/`
 * answers 404 with no way to fix it from the admin — `home` is a reserved slug
 * and cannot be created there.
 *
 * Because this runs unattended, the tests that matter most are the ones about
 * what it must NOT do: never overwrite a page someone owns, never resurrect one
 * they deleted, never create a user.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

// The seed and the sync take the generated client; `db` is the same client.
const prisma = db as unknown as PrismaClient;

async function dropHomepage() {
  await db.page.deleteMany({ where: { slug: "home" } });
  await db.siteSetting.deleteMany({ where: { key: "cms.homepageMigratedAt" } });
}

describeDb("platform sync", () => {
  beforeEach(async () => {
    await dropHomepage();
  });

  afterAll(async () => {
    // Leave the database as the seed leaves it: with a homepage.
    await dropHomepage();
    await ensureHomepage(prisma);
  });

  describe("the homepage", () => {
    it("is created, published, and made of the same bands the migration adds", async () => {
      const message = await ensureHomepage(prisma);
      expect(message).toContain("created");

      const page = await db.page.findFirstOrThrow({
        where: { slug: "home" },
        select: {
          status: true,
          publishedAt: true,
          deletedAt: true,
          sections: { orderBy: { order: "asc" }, select: { type: true, isVisible: true } },
        },
      });

      expect(page.status).toBe("PUBLISHED");
      expect(page.publishedAt).not.toBeNull();
      expect(page.deletedAt).toBeNull();

      const types = page.sections.map((section) => section.type);
      expect(types[0]).toBe("hero");
      expect(types[types.length - 1]).toBe("cta");
      // The dynamic bands, so the page fills itself in as content is published.
      for (const type of ["serviceGrid", "caseStudyGrid", "packageGrid", "blogGrid"]) {
        expect(types).toContain(type);
      }
      expect(page.sections.every((section) => section.isVisible)).toBe(true);
    });

    it("states no business facts of its own", async () => {
      await ensureHomepage(prisma);
      const sections = await db.pageSection.findMany({
        where: { page: { slug: "home" } },
        select: { content: true },
      });

      const prose = JSON.stringify(sections);
      // A starter page must not assert anything about a business it knows
      // nothing about — no counts, no years, no named clients (CLAUDE.md 5).
      expect(prose).not.toMatch(/Six disciplines/);
      expect(prose).not.toMatch(/Founded/);
      expect(prose).not.toMatch(/\b(19|20)\d{2}\b/);
    });

    it("leaves an existing published homepage completely alone", async () => {
      const page = await db.page.create({
        data: {
          slug: "home",
          title: "Mine",
          status: "PUBLISHED",
          sections: { create: [{ type: "hero", order: 1, content: { heading: "Mine" } }] },
        },
        select: { id: true, updatedAt: true },
      });

      expect(await ensureHomepage(prisma)).toContain("already exists");

      const after = await db.page.findUniqueOrThrow({
        where: { id: page.id },
        select: { title: true, sections: { select: { type: true } } },
      });
      expect(after.title).toBe("Mine");
      expect(after.sections).toHaveLength(1);
    });

    it("does not publish a homepage someone is still drafting", async () => {
      await db.page.create({ data: { slug: "home", title: "WIP", status: "DRAFT" } });
      await ensureHomepage(prisma);

      const page = await db.page.findFirstOrThrow({ where: { slug: "home" } });
      expect(page.status).toBe("DRAFT");
    });

    it("does not resurrect a homepage someone deleted", async () => {
      await db.page.create({
        data: { slug: "home", title: "Gone", status: "PUBLISHED", deletedAt: new Date() },
      });

      expect(await ensureHomepage(prisma)).toContain("already exists");
      expect(await db.page.count({ where: { slug: "home" } })).toBe(1);
      expect(await db.page.count({ where: { slug: "home", deletedAt: null } })).toBe(0);
    });
  });

  describe("running it on every boot", () => {
    it("is idempotent", async () => {
      await syncPlatform(prisma);
      const first = {
        pages: await db.page.count({ where: { slug: "home" } }),
        sections: await db.pageSection.count({ where: { page: { slug: "home" } } }),
        permissions: await db.permission.count(),
        templates: await db.emailTemplate.count(),
        automations: await db.automation.count(),
      };

      await syncPlatform(prisma);
      const second = {
        pages: await db.page.count({ where: { slug: "home" } }),
        sections: await db.pageSection.count({ where: { page: { slug: "home" } } }),
        permissions: await db.permission.count(),
        templates: await db.emailTemplate.count(),
        automations: await db.automation.count(),
      };

      expect(second).toEqual(first);
      expect(first.pages).toBe(1);
    });

    it("grants a permission the deployed code declares but the database is missing", async () => {
      const role = await db.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
      const permission = await db.permission.findUniqueOrThrow({ where: { key: "leads.view" } });

      // Exactly the state a release leaves behind when nobody runs the seed.
      await db.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: permission.id },
      });

      await syncPlatform(prisma);

      expect(
        await db.rolePermission.count({ where: { roleId: role.id, permissionId: permission.id } }),
      ).toBe(1);
    });

    it("revokes a grant the deployed code no longer declares", async () => {
      const role = await db.role.findUniqueOrThrow({ where: { name: "STAFF" } });
      const permission = await db.permission.findUniqueOrThrow({ where: { key: "settings.edit" } });

      await db.rolePermission.createMany({
        data: [{ roleId: role.id, permissionId: permission.id }],
        skipDuplicates: true,
      });

      await syncPlatform(prisma);

      // A release that takes access away has to actually take it away.
      expect(
        await db.rolePermission.count({ where: { roleId: role.id, permissionId: permission.id } }),
      ).toBe(0);
    });

    it("keeps the permission catalogue in step with the code", async () => {
      await syncPlatform(prisma);
      const rows = await db.permission.findMany({ select: { key: true } });
      expect(new Set(rows.map((row) => row.key))).toEqual(new Set(PERMISSIONS));
    });

    it("creates no users — the super admin stays a deliberate act", async () => {
      const before = await db.user.count();
      await syncPlatform(prisma);
      expect(await db.user.count()).toBe(before);
    });

    it("does not overwrite a site setting someone has edited", async () => {
      await db.siteSetting.upsert({
        where: { key: "site.name" },
        create: { key: "site.name", value: "Their Agency", group: "general" },
        update: { value: "Their Agency" },
      });

      await syncPlatform(prisma);

      const row = await db.siteSetting.findUniqueOrThrow({ where: { key: "site.name" } });
      expect(row.value).toBe("Their Agency");
    });
  });
});
