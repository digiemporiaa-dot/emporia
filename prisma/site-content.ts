import type { PrismaClient } from "../generated/prisma/client.js";
import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { CITIES, SERVICES } from "./site-content.data.js";

/**
 * DigiEmporia's approved website copy, written over placeholders on boot.
 *
 * The production database was demo-seeded, so the live site serves the demo's
 * services, homepage and Service × City pages, with invented positioning
 * ("Founded 2019", "12 clients at a time"), plus invented case studies,
 * testimonials, packages and posts. This replaces the copy with what the
 * proprietor approved, and takes the invented proof off the site as drafts.
 *
 * **Only ever over placeholder text.** Each record is rewritten only while it
 * is still exactly what `npm run db:seed:demo` or a fresh install laid down,
 * recognised by the demo's own words (repeated below; prisma/seed-demo.ts runs
 * on import, and tests/site-content.db.test.ts checks the two still agree).
 * A record anyone has edited is left alone and named in the log; once the copy
 * is in, the fingerprints no longer match and later deploys never touch it
 * again. What is replaced is kept in full in the audit row.
 *
 * **Nothing is created that the site did not already have**, except a
 * Service × City page for a service and city that both exist: those are
 * created as DRAFT, because publishing one needs a real local case study or
 * testimonial (lib/local/can-publish) and this file has none to give.
 */

/** The demo's short descriptions, by slug. A service still carrying one is untouched demo. */
export const DEMO_SERVICE_SHORT: Record<string, string> = {
  seo: "Technical foundations, content that answers real demand, and links that hold up to scrutiny. Built to compound.",
  "paid-media": "Google, Meta and LinkedIn budgets managed against cost per qualified lead — not impressions, not clicks.",
  "social-media": "Editorial calendars, original creative and community management that sound like your brand, not a template.",
  "content-marketing": "Research-led writing that earns links, ranks, and gives your sales team something worth sending.",
  "web-design-development": "Fast, accessible sites built to convert — and to be edited by your team without a developer.",
  "marketing-analytics": "Attribution, dashboards and clean data so you can answer which spend produced which revenue.",
};

/** The demo's Service × City intros. Mumbai is not listed: there is no approved Mumbai copy. */
export const DEMO_SERVICE_CITY_INTROS: readonly string[] = [
  "Gurgaon is unusual because the density of competition is geographic as well as commercial.",
  "We offer SEO services in Delhi for businesses that want to rank higher.",
];

export const DEMO_HOME = {
  heroHeading: "Marketing that survives the question, where did that number come from.",
  metaDescription:
    "An independent digital marketing agency. SEO, paid media, content and analytics, reported against pipeline.",
};

/** The fresh-install homepage hero, from prisma/ensure-homepage. */
export const STARTER_HOME_BODY = "This is your homepage, and it is a normal CMS page.";

type Content = Record<string, unknown>;

/** The approved homepage bands, in page order. */
export const HOME_BANDS: { type: string; content: Content }[] = [
  {
    type: "hero",
    content: {
      eyebrow: "DigiEmporia · Digital marketing agency, Delhi",
      heading: "Marketing that brings enquiries, not just impressions.",
      body: "SEO, Google and Meta ads, social media, content and websites for growing businesses. Planned around your goals, approved by you in your own client portal, and reported with real numbers from your own accounts.",
      ctaLabel: "Start a project",
      ctaHref: "/contact",
      secondaryLabel: "See our services",
      secondaryHref: "/services",
    },
  },
  {
    type: "positioning",
    content: {
      eyebrow: "Why DigiEmporia",
      heading: "One team for your whole digital presence, with nothing hidden.",
      paragraphs: [
        "Most businesses juggle a freelancer for social media, another for ads and a developer for the website. Nobody owns the result. DigiEmporia brings SEO, ads, social media, content and web under one team, working towards one number: qualified enquiries for your business.",
        "You see everything. Every post, ad and page comes to your client portal for approval before it goes live. Every report comes from your own Google Analytics, Search Console, Google Ads and Meta accounts. You own your accounts, your data and your content, always.",
        "We are a Delhi-based team working with businesses across Delhi NCR and beyond. We would rather tell you what won't work than sell you something that won't.",
      ],
    },
  },
  {
    type: "serviceGrid",
    content: { eyebrow: "Services", heading: "Everything your business needs to be found and chosen online." },
  },
  {
    type: "process",
    content: {
      eyebrow: "How we work",
      heading: "From first call to monthly results, in four steps.",
      steps: [
        {
          title: "Understand",
          text: "A discovery call and audit of your website, ads, social accounts and tracking. We learn your customers, competitors and what an enquiry is worth to you.",
        },
        {
          title: "Plan",
          text: "A written proposal with a clear scope, timeline and price, and a 90-day plan for the channels that fit your goals and budget.",
        },
        {
          title: "Approve and launch",
          text: "Content, ads and pages come to your client portal for approval. Nothing goes live without your yes.",
        },
        {
          title: "Measure and improve",
          text: "Monthly reports from your own accounts show what brought enquiries. We keep what works, fix what doesn't, and tell you plainly which is which.",
        },
      ],
    },
  },
  {
    type: "industries",
    content: {
      eyebrow: "Who we work with",
      heading: "Built for businesses that sell locally and grow online.",
      body: "Our services suit any business where customers search, compare and enquire online before they buy.",
      items: [
        "Healthcare and clinics",
        "Real estate",
        "Education and coaching",
        "Retail and D2C brands",
        "Restaurants and hospitality",
        "Professional services",
        "Home services",
        "B2B and manufacturing",
      ],
    },
  },
  {
    type: "cta",
    content: {
      heading: "Tell us what you want to grow.",
      body: "Share a few details about your business and goals. We will review your current setup and come back with honest recommendations, whether or not you work with us.",
      ctaLabel: "Get in touch",
      ctaHref: "/contact",
    },
  },
];

/**
 * Bands that would show demo or empty data: invented stats, demo case studies,
 * testimonials, packages and posts. Hidden, not deleted, so an editor can turn
 * each back on once there is something real to show.
 */
export const HOME_HIDDEN = ["clientStrip", "stats", "caseStudyGrid", "packageGrid", "testimonials", "blogGrid"] as const;

export const HOME_SEO = {
  metaTitle: "Digital Marketing Agency in Delhi",
  metaDescription:
    "SEO, Google and Meta ads, social media, content and websites from a Delhi-based team. Approve every post in your own portal and see real results.",
};

/** Presentation the existing band carries (layout, tone, grid…) survives; the words are replaced. */
const DEMO_ONLY_KEYS = ["facts", "secondaryLabel", "secondaryHref", "paragraphs", "steps", "items"];

function mergeBand(existing: unknown, approved: Content): Content {
  const kept: Content = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [key, value] of Object.entries(existing as Content)) {
      if (!DEMO_ONLY_KEYS.includes(key)) kept[key] = value;
    }
  }
  return { ...kept, ...approved };
}

const SERVICE_ICONS: Record<string, string> = {
  seo: "search",
  "paid-media": "target",
  "social-media": "megaphone",
  "content-marketing": "pen-tool",
  "web-design-development": "layout",
  "marketing-analytics": "bar-chart",
};

async function writeServices(prisma: PrismaClient, out: { replaced: string[]; left: string[]; missing: string[] }) {
  for (const approved of SERVICES) {
    const service = await prisma.service.findUnique({
      where: { slug: approved.slug },
      select: {
        id: true,
        name: true,
        shortDescription: true,
        body: true,
        seo: { select: { id: true, metaDescription: true } },
        faqs: { where: { cityId: null, serviceCityPageId: null, packageId: null }, select: { question: true, answer: true } },
      },
    });
    if (!service) {
      out.missing.push(approved.slug);
      continue;
    }
    if (service.shortDescription === approved.shortDescription) continue;
    if (service.shortDescription !== DEMO_SERVICE_SHORT[approved.slug]) {
      out.left.push(approved.slug);
      continue;
    }

    const demoSeo = !service.seo?.metaDescription || service.seo.metaDescription === DEMO_SERVICE_SHORT[approved.slug];
    await prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id: service.id },
        data: {
          name: approved.name,
          shortDescription: approved.shortDescription,
          body: approved.body as InputJsonValue,
          icon: SERVICE_ICONS[approved.slug] ?? null,
          ...(service.seo
            ? demoSeo
              ? { seo: { update: { metaTitle: approved.metaTitle, metaDescription: approved.metaDescription } } }
              : {}
            : { seo: { create: { metaTitle: approved.metaTitle, metaDescription: approved.metaDescription, schemaType: "SERVICE" } } }),
        },
      });
      await tx.fAQ.deleteMany({ where: { serviceId: service.id, cityId: null, serviceCityPageId: null, packageId: null } });
      await tx.fAQ.createMany({
        data: approved.faqs.map((faq, index) => ({ serviceId: service.id, question: faq.question, answer: faq.answer, order: index + 1, isActive: true })),
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          entityType: "Service",
          entityId: service.id,
          before: { replaced: "demo", name: service.name, shortDescription: service.shortDescription, body: service.body, faqs: service.faqs } as InputJsonValue,
          after: { slug: approved.slug, source: "prisma/site-content" },
        },
      });
    });
    out.replaced.push(approved.slug);
  }
}

async function writeHome(prisma: PrismaClient): Promise<string> {
  const page = await prisma.page.findFirst({
    where: { slug: "home", deletedAt: null },
    select: {
      id: true,
      seo: { select: { id: true, metaDescription: true } },
      sections: { orderBy: { order: "asc" }, select: { id: true, type: true, order: true, isVisible: true, content: true } },
    },
  });
  if (!page) return "homepage: none";

  const hero = page.sections.find((section) => section.type === "hero")?.content as Content | undefined;
  if (hero?.heading === HOME_BANDS[0]!.content.heading) return "homepage: already approved copy";
  const placeholder =
    hero?.heading === DEMO_HOME.heroHeading ? "demo" : typeof hero?.body === "string" && hero.body.startsWith(STARTER_HOME_BODY) ? "starter" : null;
  if (!placeholder) return "homepage: edited by someone, left alone";

  await prisma.$transaction(async (tx) => {
    const used = new Set<string>();
    for (const [index, band] of HOME_BANDS.entries()) {
      const order = band.type === "cta" ? 1000 : (index + 1) * 10;
      const existing = page.sections.find((section) => section.type === band.type);
      if (existing) {
        used.add(existing.id);
        await tx.pageSection.update({
          where: { id: existing.id },
          data: { order, isVisible: true, content: mergeBand(existing.content, band.content) as InputJsonValue },
        });
      } else {
        await tx.pageSection.create({ data: { pageId: page.id, type: band.type, order, content: band.content as InputJsonValue } });
      }
    }
    for (const [index, section] of page.sections.entries()) {
      if (used.has(section.id)) continue;
      const hide = (HOME_HIDDEN as readonly string[]).includes(section.type);
      await tx.pageSection.update({
        where: { id: section.id },
        data: { order: 100 + index, ...(hide ? { isVisible: false } : {}) },
      });
    }
    const ownSeo = page.seo?.metaDescription && page.seo.metaDescription !== DEMO_HOME.metaDescription;
    if (!ownSeo) {
      await tx.page.update({
        where: { id: page.id },
        data: { seo: page.seo ? { update: HOME_SEO } : { create: HOME_SEO } },
      });
    }
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        entityType: "Page",
        entityId: page.id,
        before: { replaced: placeholder, sections: page.sections } as InputJsonValue,
        after: { slug: "home", source: "prisma/site-content" },
      },
    });
  });
  return `homepage: replaced ${placeholder} copy`;
}

async function writeServiceCityPages(prisma: PrismaClient, out: { written: string[]; left: string[] }) {
  for (const approvedCity of CITIES) {
    const city = await prisma.city.findUnique({
      where: { slug: approvedCity.slug },
      select: { id: true, seo: { select: { metaTitle: true, metaDescription: true } } },
    });
    if (!city) continue;

    if (!city.seo || (!city.seo.metaTitle && !city.seo.metaDescription)) {
      const seo = { metaTitle: approvedCity.metaTitle, metaDescription: approvedCity.metaDescription };
      await prisma.city.update({ where: { id: city.id }, data: { seo: city.seo ? { update: seo } : { create: seo } } });
    }

    for (const approved of approvedCity.pages) {
      const service = await prisma.service.findUnique({ where: { slug: approved.serviceSlug }, select: { id: true } });
      if (!service) continue;
      const label = `${approved.serviceSlug}/${approvedCity.slug}`;

      const existing = await prisma.serviceCityPage.findUnique({
        where: { serviceId_cityId: { serviceId: service.id, cityId: city.id } },
        select: {
          id: true,
          status: true,
          localIntro: true,
          marketContext: true,
          seoId: true,
          faqs: { select: { question: true, answer: true } },
        },
      });
      if (existing?.localIntro === approved.localIntro) continue;
      const demo = existing && DEMO_SERVICE_CITY_INTROS.some((intro) => existing.localIntro?.startsWith(intro));
      if (existing && !demo) {
        out.left.push(label);
        continue;
      }

      const content = {
        localIntro: approved.localIntro,
        marketContext: approved.marketContext,
        industries: approved.industries,
        positioning: approved.positioning,
        ctaHeading: approved.ctaHeading,
        ctaBody: approved.ctaBody,
        // Never published from here: canPublish wants a real local case study
        // or testimonial, which only the business can supply.
        status: "DRAFT" as const,
        publishedAt: null,
      };
      const seo = { metaTitle: approved.metaTitle, metaDescription: approved.metaDescription, schemaType: "LOCAL_BUSINESS" as const };

      await prisma.$transaction(async (tx) => {
        const page = existing
          ? await tx.serviceCityPage.update({
              where: { id: existing.id },
              data: { ...content, seo: existing.seoId ? { update: seo } : { create: seo } },
              select: { id: true },
            })
          : await tx.serviceCityPage.create({
              data: { service: { connect: { id: service.id } }, city: { connect: { id: city.id } }, ...content, seo: { create: seo } },
              select: { id: true },
            });
        await tx.fAQ.deleteMany({ where: { serviceCityPageId: page.id } });
        await tx.fAQ.createMany({
          data: approved.faqs.map((faq, index) => ({ serviceCityPageId: page.id, question: faq.question, answer: faq.answer, order: index + 1, isActive: true })),
        });
        await tx.auditLog.create({
          data: {
            action: existing ? "UPDATE" : "CREATE",
            entityType: "ServiceCityPage",
            entityId: page.id,
            before: existing ? ({ replaced: "demo", ...existing } as InputJsonValue) : undefined,
            after: { page: label, status: "DRAFT", source: "prisma/site-content" },
          },
        });
      });
      out.written.push(label);
    }
  }
}

/**
 * The brand and contact details, while the settings still hold a placeholder:
 * the install defaults from prisma/platform (`seedSiteSettings`) or the demo's
 * invented ones (an `.example` email, a `000 0000` phone, a Gurgaon address).
 * A value someone typed stays. The contact details are the proprietor's own,
 * as given for the Privacy Policy.
 */
export const BRAND_SETTINGS: { key: string; placeholders: string[]; value: string }[] = [
  { key: "site.name", placeholders: ["Emporia"], value: "DigiEmporia" },
  {
    key: "site.tagline",
    placeholders: ["Digital marketing that compounds"],
    value: "Marketing that brings enquiries, not just impressions.",
  },
  {
    key: "site.description",
    placeholders: ["An independent digital marketing agency. We report on pipeline rather than impressions."],
    value: "SEO, Google and Meta ads, social media, content and websites for growing businesses, from a Delhi-based team.",
  },
  { key: "site.email", placeholders: ["hello@emporia.example"], value: "ceo@digiemporia.com" },
  { key: "site.phone", placeholders: ["+91 124 000 0000"], value: "+91 88160 81808" },
  {
    key: "site.address",
    placeholders: ["Sector 44, Gurgaon, Haryana 122003, India"],
    value: "S/F, A-73/2, Verma Cottage, Gurudwara Road, West Delhi, Delhi 110059, India",
  },
  { key: "seo.defaultMetaTitle", placeholders: ["Emporia", "Emporia — digital marketing that reports on pipeline"], value: "DigiEmporia" },
  {
    key: "seo.defaultMetaDescription",
    placeholders: [
      "",
      "An independent digital marketing agency running SEO, paid media, content and analytics as one measured programme.",
    ],
    value: HOME_SEO.metaDescription,
  },
  { key: "seo.titleTemplate", placeholders: ["%s · Emporia"], value: "%s · DigiEmporia" },
];

async function writeBrand(prisma: PrismaClient): Promise<string[]> {
  const set: string[] = [];
  for (const setting of BRAND_SETTINGS) {
    const { count } = await prisma.siteSetting.updateMany({
      where: { key: setting.key, OR: setting.placeholders.map((placeholder) => ({ value: { equals: placeholder } })) },
      data: { value: setting.value },
    });
    if (count > 0) set.push(setting.key);
  }
  return set;
}

/**
 * The demo's invented proof and sample content, identified by the demo's own
 * slug and wording together, so a real record that happens to share a slug is
 * never matched. These are taken off the public site — set to DRAFT, never
 * deleted — because publishing invented clients, results and quotes is exactly
 * what CLAUDE.md 5 forbids. An editor can put any of them back.
 */
export const DEMO_PUBLIC = {
  caseStudies: [
    { slug: "d2c-skincare-organic-growth", clientName: "Aarohi Skincare" },
    { slug: "b2b-saas-pipeline", clientName: "Northwind Logistics Software" },
    { slug: "multi-city-services-local", clientName: "Meridian Home Services" },
  ],
  testimonials: [
    { authorName: "Priya Raghavan", company: "Aarohi Skincare" },
    { authorName: "Deepak Menon", company: "Northwind Logistics Software" },
    { authorName: "Sana Qureshi", company: "Meridian Home Services" },
    { authorName: "Rohan Bhatt", company: "Lumen Interiors" },
  ],
  packages: [
    { slug: "starter", tagline: "For teams proving a channel works before committing budget." },
    { slug: "growth", tagline: "Two channels working together, with the measurement to prove it." },
    { slug: "scale", tagline: "Full-funnel programme with attribution your finance team will accept." },
  ],
  posts: [
    { slug: "why-most-city-landing-pages-fail", title: "Why most city landing pages fail" },
    { slug: "cost-per-lead-is-the-wrong-metric", title: "Cost per lead is the wrong metric" },
    { slug: "reporting-that-survives-a-cfo", title: "Building marketing reporting that survives a CFO" },
    { slug: "content-worth-citing", title: "How to publish content worth citing" },
  ],
  pages: [
    { slug: "about", heroHeading: "We report on pipeline, not impressions." },
    { slug: "careers", heroHeading: "Small team, unusually direct work." },
  ],
  serviceCityIntros: ["Almost every Mumbai account we have run has turned out to be a seasonality problem"],
};

async function withdrawDemo(prisma: PrismaClient): Promise<string[]> {
  const withdrawn: string[] = [];
  const note = async (entityType: string, id: string, label: string) => {
    await prisma.auditLog.create({
      data: { action: "UNPUBLISH", entityType, entityId: id, before: { status: "PUBLISHED", demo: true }, after: { status: "DRAFT", source: "prisma/site-content" } },
    });
    withdrawn.push(label);
  };

  for (const demo of DEMO_PUBLIC.caseStudies) {
    const row = await prisma.caseStudy.findFirst({ where: { ...demo, status: "PUBLISHED" }, select: { id: true } });
    if (!row) continue;
    await prisma.caseStudy.update({ where: { id: row.id }, data: { status: "DRAFT" } });
    await note("CaseStudy", row.id, `case study ${demo.slug}`);
  }
  for (const demo of DEMO_PUBLIC.testimonials) {
    const rows = await prisma.testimonial.findMany({ where: { ...demo, status: "PUBLISHED" }, select: { id: true } });
    for (const row of rows) {
      await prisma.testimonial.update({ where: { id: row.id }, data: { status: "DRAFT" } });
      await note("Testimonial", row.id, `testimonial ${demo.authorName}`);
    }
  }
  for (const demo of DEMO_PUBLIC.packages) {
    const row = await prisma.servicePackage.findFirst({ where: { ...demo, status: "PUBLISHED" }, select: { id: true } });
    if (!row) continue;
    await prisma.servicePackage.update({ where: { id: row.id }, data: { status: "DRAFT" } });
    await note("ServicePackage", row.id, `package ${demo.slug}`);
  }
  for (const demo of DEMO_PUBLIC.posts) {
    const row = await prisma.blogPost.findFirst({ where: { ...demo, status: "PUBLISHED" }, select: { id: true } });
    if (!row) continue;
    await prisma.blogPost.update({ where: { id: row.id }, data: { status: "DRAFT" } });
    await note("BlogPost", row.id, `post ${demo.slug}`);
  }
  for (const demo of DEMO_PUBLIC.pages) {
    const row = await prisma.page.findFirst({
      where: {
        slug: demo.slug,
        status: "PUBLISHED",
        deletedAt: null,
        sections: { some: { type: "hero", content: { path: ["heading"], equals: demo.heroHeading } } },
      },
      select: { id: true },
    });
    if (!row) continue;
    await prisma.page.update({ where: { id: row.id }, data: { status: "DRAFT" } });
    await note("Page", row.id, `page ${demo.slug}`);
  }
  for (const intro of DEMO_PUBLIC.serviceCityIntros) {
    const rows = await prisma.serviceCityPage.findMany({ where: { localIntro: { startsWith: intro }, status: "PUBLISHED" }, select: { id: true } });
    for (const row of rows) {
      await prisma.serviceCityPage.update({ where: { id: row.id }, data: { status: "DRAFT" } });
      await note("ServiceCityPage", row.id, "demo service-city page");
    }
  }
  return withdrawn;
}

export async function ensureSiteContent(prisma: PrismaClient): Promise<string> {
  const brand = await writeBrand(prisma);
  const services = { replaced: [] as string[], left: [] as string[], missing: [] as string[] };
  await writeServices(prisma, services);
  const home = await writeHome(prisma);
  const local = { written: [] as string[], left: [] as string[] };
  await writeServiceCityPages(prisma, local);
  const withdrawn = await withdrawDemo(prisma);

  const parts = [
    ...(brand.length ? [`brand set: ${brand.join(", ")}`] : []),
    services.replaced.length ? `services replaced: ${services.replaced.join(", ")}` : "services: nothing to replace",
    ...(services.left.length ? [`services edited by someone, left alone: ${services.left.join(", ")}`] : []),
    home,
    local.written.length ? `service-city drafts written: ${local.written.join(", ")}` : "service-city pages: nothing to write",
    ...(local.left.length ? [`service-city pages edited by someone, left alone: ${local.left.join(", ")}`] : []),
    ...(withdrawn.length ? [`demo taken off the site (now drafts): ${withdrawn.join(", ")}`] : []),
  ];
  return `site content: ${parts.join("; ")}.`;
}
