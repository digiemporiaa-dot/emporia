import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { knownPaths, linkSuggestions } from "@/lib/services/seo-links.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Internal linking.
 *
 * Two jobs: knowing which addresses exist, so the analyzer can say which links
 * go nowhere; and noticing what a page names without linking to. The second is
 * a suggestion and stays one — nothing here writes.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `lnk-${Date.now()}`;

describeDb("internal linking", () => {
  const pages: string[] = [];
  const services: string[] = [];
  const redirects: string[] = [];
  let actor: Actor;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    actor = {
      userId: staff.id,
      name: "Editor",
      email: null,
      type: "STAFF",
      roleName: "CONTENT_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set(["pages.view", "pages.edit"]),
      ip: null,
      userAgent: "vitest",
    };
  });

  afterAll(async () => {
    await db.pageSection.deleteMany({ where: { pageId: { in: pages } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
    await db.service.deleteMany({ where: { id: { in: services } } });
    await db.redirect.deleteMany({ where: { id: { in: redirects } } });
  });

  async function newPage(body: string, status: "DRAFT" | "PUBLISHED" = "PUBLISHED") {
    const page = await db.page.create({
      data: {
        slug: `links-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title: "A linking page",
        status,
        sections: { create: [{ type: "richText", order: 0, content: { body } }] },
      },
      select: { id: true, slug: true },
    });
    pages.push(page.id);
    return page;
  }

  async function newService(name: string) {
    const service = await db.service.create({
      data: {
        slug: `svc-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        shortDescription: "A service.",
        body: {},
        status: "PUBLISHED",
      },
      select: { id: true, slug: true },
    });
    services.push(service.id);
    return service;
  }

  // -------------------------------------------------------------------------
  // knownPaths
  // -------------------------------------------------------------------------

  it("includes the fixed routes, so a link to /contact is not broken", async () => {
    const paths = await knownPaths();
    expect(paths.has("/contact")).toBe(true);
    expect(paths.has("/")).toBe(true);
  });

  it("includes a published page and a published service", async () => {
    const page = await newPage("Some copy.");
    const service = await newService("Paid Search Management");

    const paths = await knownPaths();
    expect(paths.has(`/${page.slug}`)).toBe(true);
    expect(paths.has(`/services/${service.slug}`)).toBe(true);
  });

  it("excludes a draft page, because a link to it really does go nowhere", async () => {
    const page = await newPage("Draft copy.", "DRAFT");
    expect((await knownPaths()).has(`/${page.slug}`)).toBe(false);
  });

  it("includes an active redirect, because that address does resolve", async () => {
    const redirect = await db.redirect.create({
      data: { fromPath: `/${SUFFIX}-old`, toPath: "/contact", isActive: true },
      select: { id: true, fromPath: true },
    });
    redirects.push(redirect.id);

    expect((await knownPaths()).has(redirect.fromPath)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------------------------

  it("suggests a service the page names but does not link to", async () => {
    const service = await newService(`Conversion Rate Optimisation ${SUFFIX}`);
    const page = await newPage(`We also do Conversion Rate Optimisation ${SUFFIX} for clients.`);

    const suggestions = await linkSuggestions(actor, page.id);
    expect(suggestions.map((row) => row.path)).toContain(`/services/${service.slug}`);
  });

  it("does not suggest what the page already links to", async () => {
    const service = await newService(`Marketing Automation ${SUFFIX}`);
    const page = await newPage(
      `We do [Marketing Automation ${SUFFIX}](/services/${service.slug}) for clients.`,
    );

    const suggestions = await linkSuggestions(actor, page.id);
    expect(suggestions.map((row) => row.path)).not.toContain(`/services/${service.slug}`);
  });

  it("does not suggest something the page never mentions", async () => {
    const service = await newService(`Unmentioned Discipline ${SUFFIX}`);
    const page = await newPage("A page about something else entirely.");

    const suggestions = await linkSuggestions(actor, page.id);
    expect(suggestions.map((row) => row.path)).not.toContain(`/services/${service.slug}`);
  });

  it("ignores a one-word name, which would fire on half the site", async () => {
    // "Design" is a service and also an ordinary English word. A suggestion
    // that appears everywhere is one an editor stops reading.
    const service = await newService("Design");
    const page = await newPage("We care about design in everything we make.");

    const suggestions = await linkSuggestions(actor, page.id);
    expect(suggestions.map((row) => row.path)).not.toContain(`/services/${service.slug}`);
  });

  it("never suggests the page link to itself", async () => {
    const page = await newPage("A linking page talks about itself constantly.");
    const suggestions = await linkSuggestions(actor, page.id);
    expect(suggestions.map((row) => row.path)).not.toContain(`/${page.slug}`);
  });

  it("needs pages.view", async () => {
    const page = await newPage("Some copy.");
    const outsider: Actor = { ...actor, permissions: new Set<string>() };
    await expect(linkSuggestions(outsider, page.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns nothing for a page that does not exist, rather than throwing", async () => {
    expect(await linkSuggestions(actor, "cnosuchpage0000000000000")).toEqual([]);
  });
});
