import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { capturePageFormLead } from "@/lib/services/lead.service";
import { stampVersion } from "@/lib/content/migrations";
import type { VisitorContext } from "@/lib/attribution/server";

/**
 * Leads from a `leadForm` block on a CMS page.
 *
 * The reason this path exists rather than reusing the contact form's: a page
 * form needs the popup's attribution, not the contact form's thinner context. A
 * lead without its campaign is worse than no lead, because it quietly skews the
 * reporting the platform exists to produce.
 *
 * The other half is what the browser is *not* allowed to decide. It names a
 * section; everything that matters — which service the lead is for, what to say
 * back, whether the form is live at all — is read from the stored block.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `pf-${Date.now()}`;

const TOUCH = {
  source: "google",
  medium: "cpc",
  campaign: "brand-q3",
  landingPath: "/services/seo",
  // `at` is not optional: persistTouches turns it into the row's occurredAt.
  at: Date.now(),
};

const visitor: VisitorContext = {
  visitorId: `visitor-${SUFFIX}`,
  sessionId: `session-${SUFFIX}`,
  device: "MOBILE",
  userAgent: "vitest",
  referrer: "https://www.google.com/",
  firstTouch: TOUCH,
  lastTouch: TOUCH,
  isNewVisitor: false,
};

async function makeForm(
  content: Record<string, unknown>,
  status: "PUBLISHED" | "DRAFT" = "PUBLISHED",
  isVisible = true,
) {
  const page = await db.page.create({
    data: {
      slug: `form-page-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
      title: "A page with a form",
      status,
      sections: {
        create: [
          {
            type: "leadForm",
            order: 0,
            isVisible,
            content: stampVersion({
              variant: "lead",
              submitLabel: "Send",
              successMessage: "Thanks, we have it.",
              layout: "stacked",
              ...content,
            }),
          },
        ],
      },
    },
    select: { id: true, sections: { select: { id: true } } },
  });
  return { pageId: page.id, sectionId: page.sections[0]?.id as string };
}

describeDb("page form capture", () => {
  const pages: string[] = [];
  const leads: string[] = [];
  let serviceId = "";
  const serviceSlug = `form-service-${SUFFIX}`;

  beforeAll(async () => {
    const service = await db.service.create({
      data: {
        slug: serviceSlug,
        name: "Search",
        shortDescription: "A published service to attach leads to.",
        status: "PUBLISHED",
      },
      select: { id: true },
    });
    serviceId = service.id;
  });

  afterAll(async () => {
    await db.lead.deleteMany({ where: { id: { in: leads } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
    await db.service.deleteMany({ where: { id: serviceId } });
    await db.uTMTracking.deleteMany({ where: { visitorId: visitor.visitorId } });
  });

  it("creates a lead carrying the campaign the visitor arrived on", async () => {
    const { pageId, sectionId } = await makeForm({});
    pages.push(pageId);

    const result = await capturePageFormLead(
      { sectionId, name: "A Visitor", email: `visitor-${SUFFIX}@example.test`, message: "Hello" },
      { visitor, path: "/pricing" },
    );
    leads.push(result.leadId);

    const lead = await db.lead.findUniqueOrThrow({
      where: { id: result.leadId },
      select: {
        name: true,
        email: true,
        device: true,
        referrer: true,
        landingPath: true,
        firstTouchId: true,
        lastTouchId: true,
        source: { select: { slug: true } },
        activities: { select: { type: true, summary: true } },
      },
    });

    expect(lead.source.slug).toBe("website-form");
    expect(lead.device).toBe("MOBILE");
    expect(lead.referrer).toBe("https://www.google.com/");
    // The landing path is where they *arrived*, not where they submitted.
    expect(lead.landingPath).toBe("/services/seo");
    expect(lead.firstTouchId).not.toBeNull();
    expect(lead.lastTouchId).not.toBeNull();
    expect(lead.activities[0]?.type).toBe("CREATED");
    expect(lead.activities[0]?.summary).toContain("form");
  });

  it("takes the service from the stored block, not from the caller", async () => {
    const { pageId, sectionId } = await makeForm({ serviceSlug });
    pages.push(pageId);

    const result = await capturePageFormLead(
      { sectionId, name: "Another Visitor", email: `svc-${SUFFIX}@example.test` },
      { visitor, path: "/services/seo" },
    );
    leads.push(result.leadId);

    const lead = await db.lead.findUniqueOrThrow({
      where: { id: result.leadId },
      select: { serviceId: true },
    });
    expect(lead.serviceId).toBe(serviceId);
  });

  it("ignores a configured service that is not published", async () => {
    const draftSlug = `draft-service-${SUFFIX}`;
    const draft = await db.service.create({
      data: {
        slug: draftSlug,
        name: "Draft",
        shortDescription: "Not published.",
        status: "DRAFT",
      },
      select: { id: true },
    });
    const { pageId, sectionId } = await makeForm({ serviceSlug: draftSlug });
    pages.push(pageId);

    const result = await capturePageFormLead(
      { sectionId, name: "Third Visitor", email: `draft-${SUFFIX}@example.test` },
      { visitor, path: "/x" },
    );
    leads.push(result.leadId);

    const lead = await db.lead.findUniqueOrThrow({
      where: { id: result.leadId },
      select: { serviceId: true },
    });
    // Attaching a lead to a draft service would put it in reporting for a
    // service the public cannot see.
    expect(lead.serviceId).toBeNull();
    await db.service.delete({ where: { id: draft.id } });
  });

  it("returns the block's own success wording", async () => {
    const { pageId, sectionId } = await makeForm({ successMessage: "You are on the list." });
    pages.push(pageId);

    const result = await capturePageFormLead(
      { sectionId, name: "Fourth Visitor", email: `msg-${SUFFIX}@example.test` },
      { visitor, path: "/x" },
    );
    leads.push(result.leadId);
    expect(result.successMessage).toBe("You are on the list.");
  });

  it("accepts an email alone for the newsletter variant, and names the lead by it", async () => {
    const { pageId, sectionId } = await makeForm({ variant: "newsletter" });
    pages.push(pageId);

    const email = `news-${SUFFIX}@example.test`;
    const result = await capturePageFormLead({ sectionId, email }, { visitor, path: "/x" });
    leads.push(result.leadId);

    const lead = await db.lead.findUniqueOrThrow({
      where: { id: result.leadId },
      select: { name: true },
    });
    expect(lead.name).toBe(email);
  });

  it("still requires a name for the other variants", async () => {
    const { pageId, sectionId } = await makeForm({ variant: "contact" });
    pages.push(pageId);

    await expect(
      capturePageFormLead(
        { sectionId, email: `noname-${SUFFIX}@example.test` },
        { visitor, path: "/x" },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a form on an unpublished page", async () => {
    // Otherwise a draft shared as a preview link is a live, unlisted capture
    // endpoint.
    const { pageId, sectionId } = await makeForm({}, "DRAFT");
    pages.push(pageId);

    await expect(
      capturePageFormLead(
        { sectionId, name: "Nope", email: `draftpage-${SUFFIX}@example.test` },
        { visitor, path: "/x" },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a form the editor has hidden", async () => {
    const { pageId, sectionId } = await makeForm({}, "PUBLISHED", false);
    pages.push(pageId);

    await expect(
      capturePageFormLead(
        { sectionId, name: "Nope", email: `hidden-${SUFFIX}@example.test` },
        { visitor, path: "/x" },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a section that is not a form at all", async () => {
    const page = await db.page.create({
      data: {
        slug: `not-a-form-${SUFFIX}`,
        title: "No form here",
        status: "PUBLISHED",
        sections: {
          create: [{ type: "richText", order: 0, content: stampVersion({ body: "Hello" }) }],
        },
      },
      select: { id: true, sections: { select: { id: true } } },
    });
    pages.push(page.id);

    await expect(
      capturePageFormLead(
        {
          sectionId: page.sections[0]?.id as string,
          name: "Nope",
          email: `notform-${SUFFIX}@example.test`,
        },
        { visitor, path: "/x" },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an unknown section id", async () => {
    await expect(
      capturePageFormLead(
        { sectionId: "does-not-exist", name: "Nope", email: `unknown-${SUFFIX}@example.test` },
        { visitor, path: "/x" },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
