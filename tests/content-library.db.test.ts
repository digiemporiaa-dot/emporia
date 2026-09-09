import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import * as services from "@/lib/services/service.service";
import * as blog from "@/lib/services/blog.service";
import * as caseStudies from "@/lib/services/case-study.service";
import * as testimonials from "@/lib/services/testimonial.service";
import * as faqs from "@/lib/services/faq.service";
import type { Actor } from "@/lib/actor/types";

/**
 * The website content library.
 *
 * Until this phase, Service, BlogPost, CaseStudy and Testimonial had no write
 * path anywhere in the application — the demo seed was the only thing that had
 * ever created one. These tests pin the contract of the admin path that
 * replaced it: publishing is a separate permission from editing, a slug cannot
 * be taken twice, derived fields are actually derived, and the deletes that
 * would destroy published work are refused rather than cascaded.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Editor",
    email: null,
    type: "STAFF",
    roleName: "CONTENT_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const SUFFIX = `lib-${Date.now()}`;

describeDb("content library", () => {
  let author: Actor;
  let editorOnly: Actor;
  let userId = "";
  const madeServices: string[] = [];
  const madePosts: string[] = [];
  const madeStudies: string[] = [];
  const madeQuotes: string[] = [];
  const madeFaqs: string[] = [];

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = staff.id;
    author = actorWith(userId, [
      "catalog.view",
      "catalog.create",
      "catalog.edit",
      "catalog.delete",
      "catalog.publish",
      "blog.view",
      "blog.create",
      "blog.edit",
      "blog.delete",
      "blog.publish",
      "casestudies.view",
      "casestudies.create",
      "casestudies.edit",
      "casestudies.delete",
      "casestudies.publish",
      "testimonials.view",
      "testimonials.create",
      "testimonials.edit",
      "testimonials.publish",
      "faqs.view",
      "faqs.create",
      "faqs.edit",
    ]);
    // Everything except the publish rights.
    editorOnly = actorWith(userId, [
      "catalog.view",
      "catalog.create",
      "catalog.edit",
      "blog.view",
      "blog.create",
      "blog.edit",
      "casestudies.view",
      "casestudies.create",
      "testimonials.view",
      "testimonials.create",
    ]);
  });

  afterAll(async () => {
    await db.fAQ.deleteMany({ where: { id: { in: madeFaqs } } });
    await db.testimonial.deleteMany({ where: { id: { in: madeQuotes } } });
    await db.caseStudy.deleteMany({ where: { id: { in: madeStudies } } });
    await db.blogPost.deleteMany({ where: { id: { in: madePosts } } });
    await db.service.deleteMany({ where: { id: { in: madeServices } } });
    await db.blogTag.deleteMany({ where: { slug: { in: ["local-seo", "attribution"] } } });
  });

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------

  describe("services", () => {
    const base = {
      name: "Search",
      slug: `search-${SUFFIX}`,
      shortDescription: "Organic growth that compounds over quarters.",
      icon: "search",
      heroMediaId: null,
      status: "DRAFT" as const,
      order: 0,
      body: { intro: "Intro.", deliverables: ["Audit", "Roadmap"] },
    };

    it("creates one with a linked SEO record, ready for the panel", async () => {
      const service = await services.createService(author, base);
      madeServices.push(service.id);

      const stored = await services.getService(author, service.id);
      expect(stored.slug).toBe(base.slug);
      expect(stored.seoId).not.toBeNull();
      expect(stored.body).toEqual(base.body);
    });

    it("refuses to publish without catalog.publish", async () => {
      await expect(
        services.createService(editorOnly, {
          ...base,
          slug: `search-live-${SUFFIX}`,
          status: "PUBLISHED",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses a slug another service already holds", async () => {
      await expect(
        services.createService(author, { ...base, name: "Other" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rejects a delete that published content depends on", async () => {
      const service = await services.createService(author, {
        ...base,
        slug: `depended-${SUFFIX}`,
      });
      madeServices.push(service.id);

      const pkg = await db.servicePackage.create({
        data: {
          name: "Attached",
          slug: `attached-${SUFFIX}`,
          price: "1000",
          taxRate: "0",
          serviceId: service.id,
        },
        select: { id: true },
      });

      // The point: a cascade here would silently delete a package that is on
      // the site and priced.
      await expect(services.deleteService(author, service.id)).rejects.toBeInstanceOf(
        ConflictError,
      );

      await db.servicePackage.delete({ where: { id: pkg.id } });
      await services.deleteService(author, service.id);
      expect(await db.service.count({ where: { id: service.id } })).toBe(0);
      madeServices.pop();
    });
  });

  // -------------------------------------------------------------------------
  // Blog
  // -------------------------------------------------------------------------

  describe("blog", () => {
    const base = () => ({
      title: "How attribution actually works",
      slug: `attribution-${SUFFIX}`,
      excerpt: null,
      coverId: null,
      authorId: userId,
      categoryId: null,
      status: "DRAFT" as const,
      tags: ["Local SEO", "Attribution"],
      body: {
        lead: "A short standfirst.",
        sections: [{ heading: "One", text: "word ".repeat(400).trim() }],
      },
    });

    it("derives reading time from the article rather than trusting a field", async () => {
      const post = await blog.createPost(author, base());
      madePosts.push(post.id);

      const stored = await blog.getPost(author, post.id);
      // ~404 words at 200 wpm.
      expect(stored.readingMinutes).toBe(2);
    });

    it("creates tags on demand and matches them case-insensitively", async () => {
      const stored = await blog.getPost(author, madePosts[0] as string);
      expect(stored.tags.map((row) => row.tag.slug).sort()).toEqual(["attribution", "local-seo"]);

      // The same tags, typed differently, must not produce duplicates.
      await blog.updatePost(author, stored.id, { ...base(), tags: ["local seo", "ATTRIBUTION"] });
      expect(await db.blogTag.count({ where: { slug: { in: ["local-seo", "attribution"] } } })).toBe(
        2,
      );
    });

    it("refuses to publish without blog.publish", async () => {
      await expect(
        blog.createPost(editorOnly, {
          ...base(),
          slug: `live-${SUFFIX}`,
          status: "PUBLISHED",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("stamps publishedAt once and keeps it across an unpublish", async () => {
      const post = await blog.createPost(author, {
        ...base(),
        slug: `stamped-${SUFFIX}`,
        status: "PUBLISHED",
      });
      madePosts.push(post.id);

      const first = (await blog.getPost(author, post.id)).publishedAt;
      expect(first).not.toBeNull();

      await blog.updatePost(author, post.id, {
        ...base(),
        slug: `stamped-${SUFFIX}`,
        status: "DRAFT",
      });
      // Readers and feeds have seen this date; republishing must not move it.
      expect((await blog.getPost(author, post.id)).publishedAt).toEqual(first);
    });
  });

  // -------------------------------------------------------------------------
  // Case studies
  // -------------------------------------------------------------------------

  describe("case studies", () => {
    const base = {
      title: "Doubling qualified leads",
      slug: `doubling-${SUFFIX}`,
      clientName: "A client",
      summary: "What we did and what came of it, in one paragraph.",
      serviceId: null,
      cityId: null,
      coverId: null,
      status: "DRAFT" as const,
      metrics: [
        { label: "Qualified leads", value: "+180%", unit: "in 6 months" },
        { label: "Cost per lead", value: "-42%", unit: null },
      ],
      body: { challenge: "Hard.", approach: "Work.", outcome: "Better." },
    };

    it("stores metrics as written, in order, without touching the values", async () => {
      const study = await caseStudies.createCaseStudy(author, base);
      madeStudies.push(study.id);

      const stored = await caseStudies.getCaseStudy(author, study.id);
      expect(stored.metrics).toEqual(base.metrics);
    });

    it("replaces metrics wholesale so the submitted order is the stored order", async () => {
      const id = madeStudies[0] as string;
      await caseStudies.updateCaseStudy(author, id, {
        ...base,
        metrics: [{ label: "Revenue", value: "₹4.2L", unit: null }],
      });

      const stored = await caseStudies.getCaseStudy(author, id);
      expect(stored.metrics).toEqual([{ label: "Revenue", value: "₹4.2L", unit: null }]);
    });

    it("refuses to publish without casestudies.publish", async () => {
      await expect(
        caseStudies.createCaseStudy(editorOnly, {
          ...base,
          slug: `live-${SUFFIX}`,
          status: "PUBLISHED",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -------------------------------------------------------------------------
  // Testimonials
  // -------------------------------------------------------------------------

  describe("testimonials", () => {
    const base = {
      authorName: "A. Client",
      authorRole: "Marketing Director",
      company: "Their Company",
      quote: "They told us which half of the spend was wasted, then proved it.",
      rating: 5,
      avatarId: null,
      serviceId: null,
      cityId: null,
      status: "DRAFT" as const,
      order: 0,
    };

    it("round-trips, rating included", async () => {
      const testimonial = await testimonials.createTestimonial(author, base);
      madeQuotes.push(testimonial.id);

      const stored = await testimonials.getTestimonial(author, testimonial.id);
      expect(stored.quote).toBe(base.quote);
      expect(stored.rating).toBe(5);
    });

    it("keeps 'no rating' distinct from one star", async () => {
      const testimonial = await testimonials.createTestimonial(author, { ...base, rating: null });
      madeQuotes.push(testimonial.id);
      expect((await testimonials.getTestimonial(author, testimonial.id)).rating).toBeNull();
    });

    it("refuses to publish without testimonials.publish", async () => {
      await expect(
        testimonials.createTestimonial(editorOnly, { ...base, status: "PUBLISHED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -------------------------------------------------------------------------
  // FAQs
  // -------------------------------------------------------------------------

  describe("faqs", () => {
    it("refuses one that is attached to nothing, because it would render nowhere", async () => {
      await expect(
        faqs.createFaq(author, {
          question: "Where does this show?",
          answer: "Nowhere, which is the point.",
          serviceId: null,
          cityId: null,
          packageId: null,
          order: 0,
          isActive: true,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("creates one against a service", async () => {
      const service = await services.createService(author, {
        name: "FAQ host",
        slug: `faq-host-${SUFFIX}`,
        shortDescription: "A service to hang a question off.",
        icon: null,
        heroMediaId: null,
        status: "DRAFT",
        order: 0,
        body: {},
      });
      madeServices.push(service.id);

      const faq = await faqs.createFaq(author, {
        question: "How long does SEO take?",
        answer: "Longer than anyone selling it tells you.",
        serviceId: service.id,
        cityId: null,
        packageId: null,
        order: 0,
        isActive: true,
      });
      madeFaqs.push(faq.id);

      const rows = await faqs.listFaqs(author, { serviceId: service.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.question).toBe("How long does SEO take?");
    });

    it("leaves service-city FAQs to their own editor", async () => {
      // Created rather than looked up: a test that quietly returns when the
      // fixture is missing is a test that never runs.
      const city = await db.city.create({
        data: { slug: `faq-city-${SUFFIX}`, name: "FAQ City", state: "Test" },
        select: { id: true },
      });
      const service = await db.service.findFirstOrThrow({
        where: { id: { in: madeServices } },
        select: { id: true },
      });

      const page = await db.serviceCityPage.create({
        data: { serviceId: service.id, cityId: city.id },
        select: { id: true },
      });
      const owned = await db.fAQ.create({
        data: {
          question: "Local question",
          answer: "Local answer",
          serviceCityPageId: page.id,
          serviceId: service.id,
        },
        select: { id: true },
      });

      const listed = await faqs.listFaqs(author, { serviceId: service.id });
      expect(listed.map((row) => row.id)).not.toContain(owned.id);

      await db.serviceCityPage.delete({ where: { id: page.id } });
      await db.city.delete({ where: { id: city.id } });
    });

    it("refuses every read and write without the permission", async () => {
      const nobody = actorWith(userId, []);
      await expect(faqs.listFaqs(nobody)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(services.listServices(nobody)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(blog.listPosts(nobody)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(caseStudies.listCaseStudies(nobody)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(testimonials.listTestimonials(nobody)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
