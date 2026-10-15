import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { BLOCK_SCHEMAS, isBlockType } from "@/lib/content/blocks";
import { serviceBodySchema } from "@/lib/content/entity-body";
import { canPublish } from "@/lib/local/can-publish";
import { CITIES, SERVICES } from "@/prisma/site-content.data";
import {
  DEMO_HOME,
  DEMO_PUBLIC,
  ABOUT_SECTIONS,
  DEMO_SERVICE_CITY_INTROS,
  DEMO_SERVICE_SHORT,
  HOME_BANDS,
  HOME_HIDDEN,
  STARTER_HOME_BODY,
  ensureSiteContent,
} from "@/prisma/site-content";
import { brandedTitle } from "@/lib/seo/metadata";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The approved copy replaces the demo seed's services, homepage and
 * Service × City pages on boot — and only those: anything an editor has
 * touched is left alone, Service × City pages are never published from here,
 * and once the copy is in, later boots change nothing.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const prisma = db as unknown as PrismaClient;

describe("page titles carry the site's own name", () => {
  const defaults = { siteName: "DigiEmporia", defaultTitle: "DigiEmporia", titleTemplate: "%s · DigiEmporia" };
  it("applies the template from settings, once", () => {
    expect(brandedTitle("SEO Services in Delhi", defaults)).toBe("SEO Services in Delhi · DigiEmporia");
    expect(brandedTitle("DigiEmporia", defaults)).toBe("DigiEmporia");
    expect(brandedTitle("About", { ...defaults, titleTemplate: "DigiEmporia" })).toBe("About");
  });
  it("never repeats the brand in an approved meta title", () => {
    for (const title of [...SERVICES.map((s) => s.metaTitle), ...CITIES.flatMap((c) => [c.metaTitle, ...c.pages.map((p) => p.metaTitle)])]) {
      expect(title).not.toContain("DigiEmporia");
    }
  });
});

describe("approved site content, pure", () => {
  it("recognises the demo and starter placeholders by what those files actually write", () => {
    const demo = readFileSync("prisma/seed-demo.ts", "utf8");
    for (const text of [...Object.values(DEMO_SERVICE_SHORT), ...DEMO_SERVICE_CITY_INTROS, DEMO_HOME.heroHeading, DEMO_HOME.metaDescription]) {
      expect(demo).toContain(text);
    }
    expect(readFileSync("prisma/ensure-homepage.ts", "utf8")).toContain(STARTER_HOME_BODY);
    for (const record of [...DEMO_PUBLIC.caseStudies, ...DEMO_PUBLIC.testimonials, ...DEMO_PUBLIC.packages, ...DEMO_PUBLIC.posts, ...DEMO_PUBLIC.pages]) {
      for (const value of Object.values(record)) expect(demo).toContain(value);
    }
    for (const intro of DEMO_PUBLIC.serviceCityIntros) expect(demo).toContain(intro);
  });

  it("builds the homepage and the About page from bands that validate", () => {
    for (const band of [...HOME_BANDS, ...ABOUT_SECTIONS]) {
      expect(isBlockType(band.type)).toBe(true);
      if (!isBlockType(band.type)) continue;
      expect(BLOCK_SCHEMAS[band.type].safeParse(band.content).error?.issues ?? [], band.type).toEqual([]);
    }
  });

  it("gives every service copy the admin would accept", () => {
    expect(SERVICES.map((s) => s.slug)).toEqual(Object.keys(DEMO_SERVICE_SHORT));
    for (const service of SERVICES) {
      expect(serviceBodySchema.safeParse(service.body).success).toBe(true);
      expect(service.shortDescription.length).toBeLessThanOrEqual(300);
      expect(service.faqs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every Delhi and Gurgaon page everything canPublish asks for except real local proof", () => {
    for (const city of CITIES) {
      const sibling = CITIES.find((other) => other.slug !== city.slug)!;
      for (const page of city.pages) {
        const twin = sibling.pages.find((p) => p.serviceSlug === page.serviceSlug)!;
        const check = canPublish(
          { ...page, faqCount: page.faqs.length, localProofCount: 0, seo: page, localTokens: ["Delhi", "Gurgaon", "Gurugram", "Haryana"] },
          [{ id: "twin", cityName: sibling.slug, localIntro: twin.localIntro, marketContext: twin.marketContext, metaTitle: twin.metaTitle, metaDescription: twin.metaDescription }],
        );
        expect(check.checks.filter((c) => !c.passed).map((c) => c.key), `${page.serviceSlug}/${city.slug}`).toEqual(["localProof"]);
      }
    }
  });
});

describeDb("approved site content on boot", () => {
  const slugs = SERVICES.map((s) => s.slug);
  const createdCities: string[] = [];

  const drop = async () => {
    await db.serviceCityPage.deleteMany({ where: { service: { slug: { in: slugs } } } });
    await db.fAQ.deleteMany({ where: { service: { slug: { in: slugs } } } });
    await db.service.deleteMany({ where: { slug: { in: slugs } } });
  };

  /** What `npm run db:seed:demo` leaves: the demo's services, one demo Gurgaon page, the demo homepage hero. */
  const demoSeed = async () => {
    for (const [index, slug] of slugs.entries()) {
      await db.service.create({
        data: {
          slug,
          name: `Demo ${slug}`,
          shortDescription: DEMO_SERVICE_SHORT[slug]!,
          body: { intro: "Demo intro." },
          status: "PUBLISHED",
          order: index + 1,
          seo: { create: { metaTitle: `Demo ${slug} services`, metaDescription: DEMO_SERVICE_SHORT[slug]! } },
          faqs: { create: [{ question: "Demo question?", answer: "Demo answer.", order: 1 }] },
        },
      });
    }
    for (const [slug, name, state] of [["delhi", "Delhi", "Delhi"], ["gurgaon", "Gurgaon", "Haryana"]] as const) {
      if (await db.city.findUnique({ where: { slug } })) continue;
      await db.city.create({ data: { slug, name, state } });
      createdCities.push(slug);
    }
    const seo = await db.service.findUniqueOrThrow({ where: { slug: "seo" } });
    const gurgaon = await db.city.findUniqueOrThrow({ where: { slug: "gurgaon" } });
    await db.serviceCityPage.create({
      data: {
        serviceId: seo.id,
        cityId: gurgaon.id,
        localIntro: `${DEMO_SERVICE_CITY_INTROS[0]} Demo text.`,
        status: "PUBLISHED",
        publishedAt: new Date(),
        faqs: { create: [{ question: "Demo local?", answer: "Demo." }] },
      },
    });
  };

  let savedHome: { id: string; sections: { id: string; content: unknown; order: number; isVisible: boolean }[] } | null = null;
  const demoHome = async () => {
    const page = await db.page.findFirstOrThrow({ where: { slug: "home", deletedAt: null }, select: { id: true, sections: { select: { id: true, type: true, content: true, order: true, isVisible: true } } } });
    savedHome ??= page;
    const hero = page.sections.find((s) => s.type === "hero")!;
    await db.pageSection.update({ where: { id: hero.id }, data: { content: { heading: DEMO_HOME.heroHeading, body: "Demo.", facts: [{ label: "Founded", value: "2019" }] } } });
  };

  beforeEach(async () => {
    await drop();
    await demoSeed();
    await demoHome();
  });

  afterAll(async () => {
    await drop();
    await db.city.deleteMany({ where: { slug: { in: createdCities } } });
    if (savedHome) {
      for (const section of savedHome.sections) {
        await db.pageSection.update({ where: { id: section.id }, data: { content: section.content as object, order: section.order, isVisible: section.isVisible } });
      }
      await db.pageSection.deleteMany({ where: { pageId: savedHome.id, id: { notIn: savedHome.sections.map((s) => s.id) } } });
    }
  });

  it("replaces the demo copy, drafts the local pages, and then never runs again", async () => {
    const message = await ensureSiteContent(prisma);
    expect(message).toContain(`services replaced: ${slugs.join(", ")}`);
    expect(message).toContain("homepage: replaced demo copy");
    expect(message).toContain("service-city drafts written:");

    for (const approved of SERVICES) {
      const service = await db.service.findUniqueOrThrow({
        where: { slug: approved.slug },
        select: { id: true, name: true, shortDescription: true, status: true, seo: { select: { metaTitle: true } }, faqs: { select: { question: true } } },
      });
      expect(service).toMatchObject({ name: approved.name, shortDescription: approved.shortDescription, status: "PUBLISHED", seo: { metaTitle: approved.metaTitle } });
      expect(service.faqs.map((f) => f.question).sort()).toEqual(approved.faqs.map((f) => f.question).sort());
      const audit = await db.auditLog.findFirst({ where: { entityType: "Service", entityId: service.id }, orderBy: { createdAt: "desc" } });
      expect(audit?.before).toMatchObject({ replaced: "demo", shortDescription: DEMO_SERVICE_SHORT[approved.slug] });
    }

    // Every Delhi and Gurgaon page exists, as a draft, with its own FAQs — the demo Gurgaon page included.
    const pages = await db.serviceCityPage.findMany({
      where: { service: { slug: { in: slugs } }, city: { slug: { in: ["delhi", "gurgaon"] } } },
      select: { status: true, publishedAt: true, localIntro: true, _count: { select: { faqs: true } } },
    });
    expect(pages).toHaveLength(12);
    for (const page of pages) {
      expect(page.status).toBe("DRAFT");
      expect(page.publishedAt).toBeNull();
      expect(page._count.faqs).toBe(3);
      expect(page.localIntro).not.toContain(DEMO_SERVICE_CITY_INTROS[0]);
    }

    const home = await db.page.findFirstOrThrow({
      where: { slug: "home", deletedAt: null },
      select: { seo: { select: { metaTitle: true } }, sections: { orderBy: { order: "asc" }, select: { type: true, isVisible: true, content: true } } },
    });
    const visible = home.sections.filter((s) => s.isVisible).map((s) => s.type);
    expect(visible).toEqual(HOME_BANDS.map((band) => band.type));
    for (const type of HOME_HIDDEN) expect(visible).not.toContain(type);
    expect(JSON.stringify(home.sections[0]!.content)).not.toContain("Founded");
    expect(home.seo?.metaTitle).toBe("Digital Marketing Agency in Delhi");

    expect(await ensureSiteContent(prisma)).toBe(
      "site content: services: nothing to replace; homepage: already approved copy; about: already approved copy; service-city pages: nothing to write.",
    );
  });

  it("sets the brand only while the settings still hold the install defaults", async () => {
    const keys = ["site.name", "seo.defaultMetaTitle", "site.tagline", "site.email", "seo.titleTemplate"];
    const saved = await db.siteSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    try {
      await db.siteSetting.update({ where: { key: "site.name" }, data: { value: "Emporia" } });
      await db.siteSetting.update({ where: { key: "site.tagline" }, data: { value: "Our own tagline" } });
      // The demo's invented contact details and title template.
      await db.siteSetting.upsert({ where: { key: "site.email" }, update: { value: "hello@emporia.example" }, create: { key: "site.email", group: "contact", value: "hello@emporia.example" } });
      await db.siteSetting.upsert({ where: { key: "seo.titleTemplate" }, update: { value: "%s · Emporia" }, create: { key: "seo.titleTemplate", group: "seo", value: "%s · Emporia" } });
      expect(await ensureSiteContent(prisma)).toContain("brand set: site.name");
      const after = Object.fromEntries((await db.siteSetting.findMany({ where: { key: { in: keys } } })).map((r) => [r.key, r.value]));
      expect(after["site.name"]).toBe("DigiEmporia");
      expect(after["site.tagline"]).toBe("Our own tagline");
      expect(after["site.email"]).toBe("ceo@digiemporia.com");
      expect(after["seo.titleTemplate"]).toBe("%s · DigiEmporia");
      expect(await ensureSiteContent(prisma)).not.toContain("brand set");
    } finally {
      await db.siteSetting.deleteMany({ where: { key: { in: keys.filter((key) => !saved.some((row) => row.key === key)) } } });
      for (const row of saved) await db.siteSetting.update({ where: { key: row.key }, data: { value: row.value as string } });
    }
  });

  it("takes the demo's invented proof off the site, as drafts, and leaves real records alone", async () => {
    const demo = DEMO_PUBLIC.caseStudies[0]!;
    const fake = await db.caseStudy.create({ data: { ...demo, title: "Demo", summary: "Demo.", status: "PUBLISHED" } });
    const quote = await db.testimonial.create({ data: { ...DEMO_PUBLIC.testimonials[0]!, quote: "Demo.", status: "PUBLISHED" } });
    // Same person's name, a different company: a real testimonial, not the demo's.
    const real = await db.testimonial.create({ data: { authorName: DEMO_PUBLIC.testimonials[0]!.authorName, company: "A real client", quote: "Real.", status: "PUBLISHED" } });
    try {
      const message = await ensureSiteContent(prisma);
      expect(message).toContain(`case study ${demo.slug}`);
      expect(message).toContain(`testimonial ${DEMO_PUBLIC.testimonials[0]!.authorName}`);
      expect((await db.caseStudy.findUniqueOrThrow({ where: { id: fake.id } })).status).toBe("DRAFT");
      expect((await db.testimonial.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("DRAFT");
      expect((await db.testimonial.findUniqueOrThrow({ where: { id: real.id } })).status).toBe("PUBLISHED");
      expect(await ensureSiteContent(prisma)).not.toContain("demo taken off the site");
    } finally {
      await db.caseStudy.deleteMany({ where: { id: fake.id } });
      await db.testimonial.deleteMany({ where: { id: { in: [quote.id, real.id] } } });
    }
  });

  it("publishes the approved About page over the demo's, and leaves one someone wrote alone", async () => {
    const about = await db.page.findFirst({ where: { slug: "about", deletedAt: null }, select: { id: true, status: true, sections: { select: { type: true, order: true, content: true, isVisible: true } } } });
    if (!about) return;
    const demoHeading = DEMO_PUBLIC.pages.find((p) => p.slug === "about")!.heroHeading;
    try {
      // The demo's About page, already taken down as a draft by an earlier boot.
      await db.pageSection.deleteMany({ where: { pageId: about.id } });
      await db.page.update({ where: { id: about.id }, data: { status: "DRAFT", sections: { create: [{ type: "hero", order: 1, content: { heading: demoHeading } }] } } });
      expect(await ensureSiteContent(prisma)).toContain("about: replaced demo copy and published");
      const written = await db.page.findUniqueOrThrow({ where: { id: about.id }, select: { status: true, seo: { select: { metaTitle: true } }, sections: { orderBy: { order: "asc" }, select: { type: true } } } });
      expect(written.status).toBe("PUBLISHED");
      expect(written.sections.map((s) => s.type)).toEqual(ABOUT_SECTIONS.map((s) => s.type));
      expect(written.seo?.metaTitle).toBe("About Us: Digital Marketing Agency in Delhi");

      // Someone's own About page is never touched.
      await db.pageSection.deleteMany({ where: { pageId: about.id } });
      await db.pageSection.create({ data: { pageId: about.id, type: "hero", order: 1, content: { heading: "Our own About page." } } });
      expect(await ensureSiteContent(prisma)).toContain("about: edited by someone, left alone");
      expect((await db.pageSection.findFirstOrThrow({ where: { pageId: about.id } })).content).toEqual({ heading: "Our own About page." });
    } finally {
      await db.pageSection.deleteMany({ where: { pageId: about.id } });
      await db.page.update({ where: { id: about.id }, data: { status: about.status, sections: { create: about.sections.map((s) => ({ type: s.type, order: s.order, content: s.content as object, isVisible: s.isVisible })) } } });
    }
  });

  it("leaves a service, page or homepage someone has edited exactly as it is", async () => {
    await db.service.update({ where: { slug: "paid-media" }, data: { shortDescription: "Our own words about ads." } });
    const seo = await db.service.findUniqueOrThrow({ where: { slug: "seo" } });
    const delhi = await db.city.findUniqueOrThrow({ where: { slug: "delhi" } });
    await db.serviceCityPage.create({ data: { serviceId: seo.id, cityId: delhi.id, localIntro: "Our own Delhi page." } });
    const page = await db.page.findFirstOrThrow({ where: { slug: "home", deletedAt: null }, select: { sections: { where: { type: "hero" }, select: { id: true } } } });
    await db.pageSection.update({ where: { id: page.sections[0]!.id }, data: { content: { heading: "Our own homepage." } } });

    const message = await ensureSiteContent(prisma);
    expect(message).toContain("services edited by someone, left alone: paid-media");
    expect(message).toContain("homepage: edited by someone, left alone");
    expect(message).toContain("service-city pages edited by someone, left alone: seo/delhi");

    expect((await db.service.findUniqueOrThrow({ where: { slug: "paid-media" } })).shortDescription).toBe("Our own words about ads.");
    expect((await db.serviceCityPage.findUniqueOrThrow({ where: { serviceId_cityId: { serviceId: seo.id, cityId: delhi.id } } })).localIntro).toBe("Our own Delhi page.");
    expect((await db.pageSection.findUniqueOrThrow({ where: { id: page.sections[0]!.id } })).content).toEqual({ heading: "Our own homepage." });
  });
});
