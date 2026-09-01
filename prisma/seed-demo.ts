import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Demo content for the public website.
 *
 * Deliberately a SEPARATE command from `db:seed` (`npm run db:seed:demo`), so
 * demo records can never reach production as a side effect of a deploy or a
 * redeploy. `db:seed` remains configuration only.
 *
 * Every run records `demo.seededAt` in SiteSetting, so it is auditable and
 * removable later. Idempotent — upserts by slug.
 */

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is required to seed.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function seoFor(data: {
  metaTitle: string;
  metaDescription: string;
  schemaType?: "SERVICE" | "ARTICLE" | "ORGANIZATION" | "LOCAL_BUSINESS" | "FAQ_PAGE" | "WEBSITE";
}): Promise<string> {
  const seo = await prisma.seo.create({
    data: {
      metaTitle: data.metaTitle,
      metaDescription: data.metaDescription,
      schemaType: data.schemaType ?? "NONE",
    },
  });
  return seo.id;
}

/** Upsert that only creates SEO on first insert, so re-runs do not orphan rows. */
async function upsertWithSeo<T extends { id: string; seoId: string | null }>(
  find: () => Promise<T | null>,
  create: (seoId: string) => Promise<T>,
  update: (id: string) => Promise<T>,
  seo: { metaTitle: string; metaDescription: string; schemaType?: "SERVICE" | "ARTICLE" },
): Promise<T> {
  const existing = await find();
  if (existing) return update(existing.id);
  return create(await seoFor(seo));
}

const SERVICES = [
  {
    slug: "seo",
    name: "Search Engine Optimisation",
    shortDescription:
      "Technical foundations, content that answers real demand, and links that hold up to scrutiny. Built to compound.",
    icon: "search",
    order: 1,
    body: {
      intro:
        "Most SEO engagements stall because they optimise pages nobody searches for. We start with demand — what your buyers actually type — then fix the technical debt that stops those pages ranking, and build the content and authority to hold position.",
      deliverables: [
        "Technical audit and remediation roadmap",
        "Keyword and intent mapping against your commercial pages",
        "On-page optimisation and internal linking architecture",
        "Editorial content production",
        "Digital PR and link acquisition",
        "Monthly reporting against pipeline, not just rankings",
      ],
      approach:
        "We work in quarterly cycles. The first fixes what is broken, the second builds what is missing, and from the third onward we compound.",
    },
  },
  {
    slug: "paid-media",
    name: "Paid Media",
    shortDescription:
      "Google, Meta and LinkedIn budgets managed against cost per qualified lead — not impressions, not clicks.",
    icon: "target",
    order: 2,
    body: {
      intro:
        "Paid media is the fastest way to learn what your market responds to, and the fastest way to waste money if the measurement is wrong. We instrument the funnel first, then spend.",
      deliverables: [
        "Account structure and tracking rebuild",
        "Search, Performance Max and Demand Gen campaigns",
        "Meta and LinkedIn prospecting and retargeting",
        "Creative testing programme",
        "Offline conversion import from your CRM",
        "Weekly optimisation and monthly strategy review",
      ],
      approach:
        "Budget follows evidence. We hold spend flat until cost per qualified lead is stable, then scale the channels that clear your threshold.",
    },
  },
  {
    slug: "social-media",
    name: "Social Media",
    shortDescription:
      "Editorial calendars, original creative and community management that sound like your brand, not a template.",
    icon: "megaphone",
    order: 3,
    body: {
      intro:
        "Organic social earns attention when it has a point of view. We build a calendar around what your business actually knows, and produce the creative to carry it.",
      deliverables: [
        "Channel strategy and tone of voice",
        "Monthly editorial calendar",
        "Original design and short-form video",
        "Community management and response handling",
        "Creator and partnership programmes",
        "Performance reporting by format and theme",
      ],
      approach:
        "One strong idea per month, executed across formats, beats thirty forgettable posts.",
    },
  },
  {
    slug: "content-marketing",
    name: "Content Marketing",
    shortDescription:
      "Research-led writing that earns links, ranks, and gives your sales team something worth sending.",
    icon: "pen",
    order: 4,
    body: {
      intro:
        "Content works when it is genuinely useful to someone with a decision to make. We interview your experts, do original research, and publish work that stands up.",
      deliverables: [
        "Content strategy tied to buying stages",
        "Long-form articles and guides",
        "Original research and data studies",
        "Case studies and sales collateral",
        "Email and newsletter programmes",
        "Distribution and repurposing",
      ],
      approach:
        "We would rather publish four pieces a quarter that get cited than forty that get ignored.",
    },
  },
  {
    slug: "web-design-development",
    name: "Web Design & Development",
    shortDescription:
      "Fast, accessible sites built to convert — and to be edited by your team without a developer.",
    icon: "layout",
    order: 5,
    body: {
      intro:
        "A website is a sales asset with an uptime requirement. We design for the decision your visitor is trying to make, and build so your team can keep it current.",
      deliverables: [
        "Conversion-focused design system",
        "Next.js build with a real CMS",
        "Core Web Vitals and accessibility work",
        "Analytics and conversion tracking",
        "Migration and redirect mapping",
        "Ongoing iteration against test results",
      ],
      approach:
        "Design in the browser, test with real traffic, and ship in increments rather than one long rebuild.",
    },
  },
  {
    slug: "marketing-analytics",
    name: "Marketing Analytics",
    shortDescription:
      "Attribution, dashboards and clean data so you can answer which spend produced which revenue.",
    icon: "chart",
    order: 6,
    body: {
      intro:
        "Most marketing reporting cannot survive the question 'where did that number come from'. We fix the collection layer first, then build reporting your finance team will accept.",
      deliverables: [
        "Tracking and tagging audit",
        "GA4 and server-side measurement",
        "CRM and offline conversion integration",
        "First and last touch attribution modelling",
        "Executive and channel dashboards",
        "Data quality monitoring",
      ],
      approach:
        "No dashboard ships until the underlying numbers reconcile with your CRM and your invoices.",
    },
  },
];

const CITIES = [
  // Coordinates are real: localBusinessSchema refuses to emit without them.
  { slug: "gurgaon", name: "Gurgaon", state: "Haryana", order: 1, population: 1153000, latitude: 28.4595, longitude: 77.0266 },
  { slug: "delhi", name: "Delhi", state: "Delhi", order: 2, population: 16787941, latitude: 28.6139, longitude: 77.209 },
  { slug: "mumbai", name: "Mumbai", state: "Maharashtra", order: 3, population: 12442373, latitude: 19.076, longitude: 72.8777 },
  { slug: "bengaluru", name: "Bengaluru", state: "Karnataka", order: 4, population: 8443675, latitude: 12.9716, longitude: 77.5946 },
];

/**
 * Service x City pages.
 *
 * Two published pages for the SAME service, written to be genuinely different
 * in substance — different market dynamics, different sectors, different
 * questions — which is what canPublish()'s uniqueness check demands.
 *
 * The third is deliberately thin. It stays DRAFT because the seed does not
 * force a status: publishing runs through publishPage(), which refuses it.
 */
const SERVICE_CITY_PAGES = [
  {
    serviceSlug: "seo",
    citySlug: "gurgaon",
    publish: true,
    positioning:
      "Corporate SEO for a market where your buyers are three metro stops away and your competitors share your postcode.",
    localIntro:
      "Gurgaon is unusual because the density of competition is geographic as well as commercial. On a single stretch of Golf Course Road you will find four firms selling the same professional service to the same set of multinational headquarters, all bidding on the same terms, all with roughly the same domain authority. Winning here is rarely about publishing more. It is about being unambiguously the most relevant result for a very specific commercial query, and then having the technical foundations to hold that position when a competitor with a larger budget notices. Most of the Gurgaon engagements we take on begin with consolidation rather than production: we find eight pages competing for one query and merge them into one that can actually rank.",
    marketContext:
      "The buyer here is usually a procurement or marketing lead inside a large organisation with a formal vendor process, which changes what content has to do. Search does not close the deal; it gets you onto the shortlist. That means the pages that matter are the ones a committee reads after the first call, not the ones that win a click. We weight capability pages, credentials and sector-specific proof far more heavily in Gurgaon than we would for a consumer brand, and we treat brand search volume as a lagging indicator of offline reputation rather than a vanity number to be celebrated in a monthly report.",
    industries: ["Professional services", "B2B SaaS", "Real estate", "Automotive", "Healthcare"],
    ctaHeading: "Competing on the same terms as everyone on Golf Course Road?",
    ctaBody:
      "We will show you where your pages are competing with each other before we suggest writing anything new.",
    metaTitle: "SEO services in Gurgaon for B2B and professional firms",
    metaDescription:
      "SEO in Gurgaon for firms selling into corporate buyers — consolidation, technical foundations and the credentials pages a procurement committee actually reads.",
    faqs: [
      {
        question: "Do you work with Gurgaon firms selling to head offices rather than consumers?",
        answer:
          "Most of our Gurgaon work is exactly that. The approach is different from consumer SEO: the pages that matter are the ones read after the first call, so we invest in capability and credentials pages rather than chasing top-of-funnel volume that procurement will never see.",
        order: 1,
      },
      {
        question: "Our competitors are on the same road and rank above us. Can that change?",
        answer:
          "Usually yes, and usually not by publishing more. In dense markets the common problem is self-competition — several of your own pages targeting one query. Consolidating them is often worth more than a quarter of new content.",
        order: 2,
      },
      {
        question: "Should we target Delhi NCR terms as well as Gurgaon ones?",
        answer:
          "Only where the intent genuinely differs. Building a separate NCR page that repeats the Gurgaon one would set the two competing. We would rather one strong page that ranks across the region than two that split the signal.",
        order: 3,
      },
    ],
  },
  {
    serviceSlug: "seo",
    citySlug: "mumbai",
    publish: true,
    positioning:
      "Search that follows the calendar — because in Mumbai demand arrives in waves, not a straight line.",
    localIntro:
      "Almost every Mumbai account we have run has turned out to be a seasonality problem wearing an SEO costume. Retail spikes hard around festival buying, hospitality swings on the monsoon, financial services move with the fiscal year, and a content calendar built on an annual average will comfortably miss all three. The practical consequence is that publishing timing matters more here than almost anywhere else we work: a guide that lands six weeks before the buying window compounds all season, and the same guide published two weeks late is dead weight for a year. So Mumbai plans start from the client's own sales data rather than a keyword tool, and we build the editorial calendar backwards from the weeks when the money actually moves.",
    marketContext:
      "The other distinguishing feature is that Mumbai buyers research on a phone, very often mid-commute, and they abandon anything that takes more than a moment to become useful. Core Web Vitals stop being a technical checkbox and start being a revenue variable you can put a number against. We spend a disproportionate share of the first quarter on page weight, image handling and above-the-fold clarity, and we measure organic performance segmented by device rather than in aggregate, because a healthy blended figure routinely hides a poor mobile one that is quietly costing far more than the desktop number is earning.",
    industries: ["D2C and ecommerce", "Hospitality", "Financial services", "Media", "Logistics"],
    ctaHeading: "Missing the window every year?",
    ctaBody:
      "Send us last year's sales by month. We can usually tell within a call whether your content is landing early enough to matter.",
    metaTitle: "SEO services in Mumbai built around seasonal demand",
    metaDescription:
      "Mumbai SEO planned from your sales calendar rather than a keyword tool, with mobile performance treated as a revenue variable rather than a technical checkbox.",
    faqs: [
      {
        question: "How far ahead should we publish for a festival buying season?",
        answer:
          "Six to ten weeks before the window opens for most categories, longer for anything with a considered purchase. Publishing into the peak itself almost never ranks in time; you are writing for next year at that point.",
        order: 1,
      },
      {
        question: "Our traffic looks fine but sales do not. Where do you look first?",
        answer:
          "Device split. In Mumbai we routinely find a healthy blended figure hiding poor mobile performance, and since most research here happens on a phone mid-commute, that is where the revenue is leaking.",
        order: 2,
      },
      {
        question: "Does the monsoon really affect search performance?",
        answer:
          "For hospitality, logistics and anything with a physical footfall component, noticeably. We plan those calendars around it rather than treating the dip as an algorithm problem when it arrives.",
        order: 3,
      },
    ],
  },
  {
    // Deliberately thin. This one exists to demonstrate the guard: it has an
    // intro far below the threshold, no market context, no FAQs and no CTA, so
    // publishPage() refuses it and it stays DRAFT.
    serviceSlug: "seo",
    citySlug: "delhi",
    publish: false,
    positioning: null,
    localIntro: "We offer SEO services in Delhi for businesses that want to rank higher.",
    marketContext: null,
    industries: ["Retail"],
    ctaHeading: null,
    ctaBody: null,
    metaTitle: "SEO Delhi",
    metaDescription: null,
    faqs: [],
  },
];

const PACKAGES = [
  {
    slug: "starter",
    name: "Starter",
    tagline: "For teams proving a channel works before committing budget.",
    serviceSlug: "seo",
    price: "45000.00",
    billingType: "MONTHLY" as const,
    taxRate: "18.000",
    isRecommended: false,
    order: 1,
    features: [
      { label: "One primary channel", detail: "SEO or paid search", isIncluded: true },
      { label: "Technical audit and fixes", isIncluded: true },
      { label: "4 content pieces per month", isIncluded: true },
      { label: "Monthly reporting call", isIncluded: true },
      { label: "Conversion tracking setup", isIncluded: true },
      { label: "Dedicated strategist", isIncluded: false },
      { label: "Creative production", isIncluded: false },
      { label: "Quarterly business review", isIncluded: false },
    ],
  },
  {
    slug: "growth",
    name: "Growth",
    tagline: "Two channels working together, with the measurement to prove it.",
    serviceSlug: "paid-media",
    price: "125000.00",
    billingType: "MONTHLY" as const,
    taxRate: "18.000",
    isRecommended: true,
    order: 2,
    features: [
      { label: "Two channels", detail: "Typically SEO plus paid media", isIncluded: true },
      { label: "Technical audit and fixes", isIncluded: true },
      { label: "10 content pieces per month", isIncluded: true },
      { label: "Fortnightly reporting call", isIncluded: true },
      { label: "Conversion tracking setup", isIncluded: true },
      { label: "Dedicated strategist", isIncluded: true },
      { label: "Creative production", detail: "Static and short-form video", isIncluded: true },
      { label: "Quarterly business review", isIncluded: false },
    ],
  },
  {
    slug: "scale",
    name: "Scale",
    tagline: "Full-funnel programme with attribution your finance team will accept.",
    serviceSlug: null,
    price: "285000.00",
    billingType: "RETAINER" as const,
    taxRate: "18.000",
    isRecommended: false,
    order: 3,
    features: [
      { label: "Four or more channels", isIncluded: true },
      { label: "Technical audit and fixes", isIncluded: true },
      { label: "20+ content pieces per month", isIncluded: true },
      { label: "Weekly reporting call", isIncluded: true },
      { label: "Server-side conversion tracking", isIncluded: true },
      { label: "Dedicated strategist and account director", isIncluded: true },
      { label: "Creative production", detail: "Full studio access", isIncluded: true },
      { label: "Quarterly business review", isIncluded: true },
    ],
  },
];

const CASE_STUDIES = [
  {
    slug: "d2c-skincare-organic-growth",
    title: "Rebuilding organic demand for a D2C skincare brand",
    clientName: "Aarohi Skincare",
    serviceSlug: "seo",
    citySlug: "mumbai",
    summary:
      "A category page architecture rebuild and 40 pieces of ingredient-led content took a skincare brand from invisible to category-leading in eleven months.",
    body: {
      challenge:
        "The site had 900 indexable URLs and ranked for almost none of them. Product pages competed with each other, and the blog answered questions nobody asked.",
      approach:
        "We consolidated the architecture to 120 pages, mapped each to a real query cluster, and rebuilt internal linking around ingredients rather than SKUs. Content focused on the questions buyers ask before their first purchase.",
      outcome:
        "Organic sessions grew steadily from month four. By month eleven organic was the largest acquisition channel by revenue, at a fraction of the blended paid cost.",
    },
    metrics: [
      { label: "Organic revenue", value: "+312", unit: "%", order: 1 },
      { label: "Non-brand keywords in top 10", value: "684", unit: "", order: 2 },
      { label: "Cost per acquisition", value: "-58", unit: "%", order: 3 },
      { label: "Months to payback", value: "5", unit: "", order: 4 },
    ],
  },
  {
    slug: "b2b-saas-pipeline",
    title: "Cutting cost per qualified lead by half for a B2B SaaS platform",
    clientName: "Northwind Logistics Software",
    serviceSlug: "paid-media",
    citySlug: "bengaluru",
    summary:
      "Importing CRM outcomes into the ad platforms changed what the algorithms optimised for — and halved the cost of a lead sales actually wanted.",
    body: {
      challenge:
        "Paid search delivered volume, but sales rejected most of it. The ad account was optimising toward form fills, and form fills were not the product.",
      approach:
        "We rebuilt tracking to send qualification status back from the CRM, restructured campaigns around problem-aware search terms, and cut the branded spend that was harvesting demand it did not create.",
      outcome:
        "Raw lead volume fell. Qualified pipeline rose. The team now reports on cost per opportunity rather than cost per lead.",
    },
    metrics: [
      { label: "Cost per qualified lead", value: "-51", unit: "%", order: 1 },
      { label: "Qualified pipeline", value: "+2.4", unit: "x", order: 2 },
      { label: "Wasted spend removed", value: "18.6", unit: "L", order: 3 },
      { label: "Sales-accepted rate", value: "71", unit: "%", order: 4 },
    ],
  },
  {
    slug: "multi-city-services-local",
    title: "Local pages that actually rank, across four cities",
    clientName: "Meridian Home Services",
    serviceSlug: "seo",
    citySlug: "gurgaon",
    summary:
      "Instead of 400 templated city pages, we published 34 with genuine local substance — and outranked competitors doing the opposite.",
    body: {
      challenge:
        "A previous agency had generated hundreds of city pages by swapping a place name into a template. Google indexed almost none of them, and the few that ranked converted poorly.",
      approach:
        "We deleted the templated pages, redirected them properly, and rebuilt a smaller set with real local pricing, genuine project photography, named technicians and area-specific FAQs.",
      outcome:
        "Fewer pages, far more traffic. Local pack visibility improved in every serviced area within two quarters.",
    },
    metrics: [
      { label: "Local organic leads", value: "+186", unit: "%", order: 1 },
      { label: "Pages published", value: "34", unit: "", order: 2 },
      { label: "Thin pages removed", value: "371", unit: "", order: 3 },
      { label: "Local pack coverage", value: "92", unit: "%", order: 4 },
    ],
  },
];

const TESTIMONIALS = [
  {
    authorName: "Priya Raghavan",
    authorRole: "Head of Growth",
    company: "Aarohi Skincare",
    quote:
      "They deleted more pages than they wrote in the first quarter. It felt counterintuitive until the traffic started moving. They were right.",
    rating: 5,
    serviceSlug: "seo",
    citySlug: "mumbai",
    order: 1,
  },
  {
    authorName: "Deepak Menon",
    authorRole: "VP Marketing",
    company: "Northwind Logistics Software",
    quote:
      "The first thing they did was tell us our reporting was wrong. The second was fix it. Our board deck finally reconciles with Salesforce.",
    rating: 5,
    serviceSlug: "marketing-analytics",
    citySlug: "bengaluru",
    order: 2,
  },
  {
    authorName: "Sana Qureshi",
    authorRole: "Founder",
    company: "Meridian Home Services",
    quote:
      "We had been sold hundreds of city pages by our last agency. This team removed most of them and our leads went up. That tells you everything.",
    rating: 5,
    serviceSlug: "seo",
    citySlug: "gurgaon",
    order: 3,
  },
  {
    authorName: "Rohan Bhatt",
    authorRole: "Chief Executive",
    company: "Lumen Interiors",
    quote:
      "No jargon, no vanity metrics, and a monthly call that takes twenty minutes because the numbers are already clear.",
    rating: 5,
    serviceSlug: "paid-media",
    citySlug: "delhi",
    order: 4,
  },
];

const BLOG = [
  {
    slug: "why-most-city-landing-pages-fail",
    title: "Why most city landing pages fail",
    category: { slug: "local-seo", name: "Local SEO" },
    excerpt:
      "Swapping a place name into a template is not localisation. Here is what a city page needs before it deserves to be indexed.",
    readingMinutes: 7,
    tags: ["local-seo", "content"],
    body: {
      lead: "If your city pages differ only by the name of the city, search engines have already worked that out. So have your visitors.",
      sections: [
        {
          heading: "The template trap",
          text: "The economics look appealing: one template, four hundred cities, four hundred pages. In practice, near-duplicate pages compete with each other, dilute the authority of the pages that could rank, and give a visitor nothing that a national page would not.",
        },
        {
          heading: "What genuine local content contains",
          text: "Local pricing that differs from the national average. Named people who actually serve the area. Photography from real projects. Questions specific to that market — permits, seasons, building stock, regulation. Testimonials from customers in that city. If you cannot supply those, the page is not ready.",
        },
        {
          heading: "Fewer, better pages",
          text: "One of our clients removed 371 templated pages and published 34 real ones. Local organic leads rose 186 percent. The pages that remained were finally able to rank because nothing was competing with them.",
        },
      ],
    },
  },
  {
    slug: "cost-per-lead-is-the-wrong-metric",
    title: "Cost per lead is the wrong metric",
    category: { slug: "paid-media", name: "Paid Media" },
    excerpt:
      "Optimising toward form fills teaches the algorithm to find people who fill in forms. That is rarely the same as people who buy.",
    readingMinutes: 6,
    tags: ["paid-media", "analytics"],
    body: {
      lead: "Every ad platform will happily reduce your cost per lead. The question is whether the leads are worth having.",
      sections: [
        {
          heading: "What the algorithm learns",
          text: "Bidding algorithms optimise toward the event you send them. If that event is a form submission, they will find the cheapest people to submit forms — students, competitors, and buyers with no budget.",
        },
        {
          heading: "Send back the outcome",
          text: "Import qualification status from your CRM as an offline conversion. Within a few weeks the platform starts finding people who look like your qualified pipeline rather than people who look like form fillers.",
        },
        {
          heading: "Expect volume to fall",
          text: "It should. On one B2B account, raw lead volume dropped by a third while qualified pipeline grew 2.4x. The finance conversation changed completely.",
        },
      ],
    },
  },
  {
    slug: "reporting-that-survives-a-cfo",
    title: "Building marketing reporting that survives a CFO",
    category: { slug: "analytics", name: "Analytics" },
    excerpt:
      "If your dashboard cannot answer 'where did that number come from', it is decoration. Here is the collection layer to fix first.",
    readingMinutes: 9,
    tags: ["analytics"],
    body: {
      lead: "The fastest way to lose marketing budget is to present a number that does not reconcile with the accounts.",
      sections: [
        {
          heading: "Fix collection before presentation",
          text: "Most reporting problems are data problems. Duplicate tags, untracked subdomains, consent banners blocking measurement, and CRM fields that three teams fill in differently.",
        },
        {
          heading: "Reconcile to invoices",
          text: "Before a dashboard ships, its revenue figure should match what was actually invoiced. If it does not, the gap is the finding — investigate it rather than adjusting the chart.",
        },
        {
          heading: "Two models, not one",
          text: "Show first touch and last touch side by side. The disagreement between them is where the interesting conversation lives.",
        },
      ],
    },
  },
  {
    slug: "content-worth-citing",
    title: "How to publish content worth citing",
    category: { slug: "content", name: "Content" },
    excerpt:
      "Four pieces a quarter that get referenced beat forty that get ignored. The difference is usually original data.",
    readingMinutes: 5,
    tags: ["content", "seo"],
    body: {
      lead: "Nobody links to a summary of things they already knew.",
      sections: [
        {
          heading: "Start with what only you know",
          text: "Your support tickets, your sales objections, your operational data. Aggregate and anonymise it, and you have something no competitor can copy.",
        },
        {
          heading: "Interview your own experts",
          text: "An hour with the person who actually does the work produces more usable material than a week of desk research.",
        },
        {
          heading: "Publish the methodology",
          text: "Showing your working is what turns an assertion into something a journalist will cite.",
        },
      ],
    },
  },
];

const PAGES = [
  {
    slug: "home",
    title: "Home",
    metaDescription:
      "An independent digital marketing agency. SEO, paid media, content and analytics, reported against pipeline.",
    sections: [
      {
        type: "hero",
        order: 1,
        content: {
          eyebrow: "Independent digital marketing",
          heading: "Marketing that survives the question, where did that number come from.",
          body: "We run SEO, paid media, content and analytics for a small number of clients, and report against pipeline rather than impressions.",
          ctaLabel: "Start a project",
          ctaHref: "/contact",
          secondaryLabel: "See the work",
          secondaryHref: "/case-studies",
          facts: [
            { label: "Founded", value: "2019" },
            { label: "Clients at a time", value: "12" },
            { label: "Avg. engagement", value: "26 months" },
            { label: "Based in", value: "Gurgaon" },
          ],
        },
      },
      {
        type: "positioning",
        order: 2,
        content: {
          eyebrow: "Positioning",
          heading: "Most agencies optimise the report. We optimise the pipeline.",
          paragraphs: [
            "Impressions rise, rankings rise, and the sales team still says the leads are no good. That gap is almost always a measurement problem wearing a marketing costume.",
            "So we fix collection before we spend. Conversions get defined against what your CRM calls a real opportunity, outcomes get sent back to the ad platforms, and the dashboard gets reconciled against what was actually invoiced.",
          ],
        },
      },
      {
        type: "process",
        order: 3,
        content: {
          eyebrow: "Process",
          heading: "Four stages, in this order.",
          steps: [
            {
              title: "Measure",
              text: "Audit tracking, tagging and CRM fields. Nothing is scaled until the numbers reconcile.",
            },
            {
              title: "Fix",
              text: "Remove what competes with itself. Technical debt, thin pages, wasted spend, broken attribution.",
            },
            {
              title: "Build",
              text: "Content, campaigns and creative against demand that actually exists.",
            },
            {
              title: "Compound",
              text: "Quarterly cycles where each one starts from a stronger position than the last.",
            },
          ],
        },
      },
      {
        type: "industries",
        order: 4,
        content: {
          eyebrow: "Sectors",
          heading: "Where we do our best work.",
          body: "We are not generalists by preference. These are the sectors where we already know the buying cycle.",
          items: [
            "D2C and ecommerce",
            "B2B SaaS",
            "Home and trade services",
            "Healthcare and clinics",
            "Real estate",
            "Professional services",
            "Education",
            "Manufacturing",
          ],
        },
      },
      {
        type: "cta",
        order: 5,
        content: {
          heading: "Tell us what you are trying to move.",
          body: "A twenty minute call is usually enough to tell whether we can help. If we cannot, we will say so and point you somewhere better.",
          ctaLabel: "Start a conversation",
          ctaHref: "/contact",
        },
      },
    ],
  },
  {
    slug: "about",
    title: "About",
    metaDescription:
      "An independent digital marketing agency that reports on pipeline rather than impressions.",
    sections: [
      {
        type: "hero",
        order: 1,
        content: {
          eyebrow: "About",
          heading: "We report on pipeline, not impressions.",
          body: "Emporia is an independent digital marketing agency. We work with a small number of clients at a time, because the work that produces results is not the work that scales across fifty accounts.",
        },
      },
      {
        type: "prose",
        order: 2,
        content: {
          heading: "How we got here",
          paragraphs: [
            "The agency started because too many marketing teams were being handed reports that nobody could reconcile with revenue. Impressions were up, rankings were up, and the pipeline was flat.",
            "So we built the practice around measurement first. Before we run a campaign we fix how it is counted, and before we publish a dashboard we check it against the invoices. It makes the first month slower and every month after it faster.",
            "We are deliberately small. Every client works directly with the people doing the work, and we turn down engagements where we do not think we can move the number that matters.",
          ],
        },
      },
      {
        type: "values",
        order: 3,
        content: {
          heading: "How we work",
          items: [
            {
              title: "Evidence before spend",
              text: "We hold budget flat until the measurement is trustworthy. Scaling an unmeasured channel is guessing with a bigger number.",
            },
            {
              title: "Fewer, better pages",
              text: "We have removed more content than we have published for several clients, and their traffic went up. Volume is not a strategy.",
            },
            {
              title: "Numbers that reconcile",
              text: "If a figure in our reporting cannot be traced to your CRM or your accounts, we treat that as a defect and fix it.",
            },
            {
              title: "Say the difficult thing",
              text: "If a channel is not working, you will hear it from us on the monthly call rather than discovering it two quarters later.",
            },
          ],
        },
      },
      {
        type: "cta",
        order: 4,
        content: {
          heading: "Want to see whether we can help?",
          body: "Tell us what you are trying to move. If we are not the right fit we will say so.",
          ctaLabel: "Start a conversation",
          ctaHref: "/contact",
        },
      },
    ],
  },
  {
    slug: "careers",
    title: "Careers",
    metaDescription: "Open roles and how we work at Emporia.",
    sections: [
      {
        type: "hero",
        order: 1,
        content: {
          eyebrow: "Careers",
          heading: "Small team, unusually direct work.",
          body: "Everyone here works on client outcomes directly. There is no layer between the people doing the work and the people paying for it.",
        },
      },
      {
        type: "prose",
        order: 2,
        content: {
          heading: "What it is like",
          paragraphs: [
            "You will own accounts rather than tickets. You will present your own work to the client, and you will hear directly when it is not landing.",
            "We are remote-first with an office in Gurgaon. Most of the team meets in person a few days a month.",
            "We do not do timesheets for their own sake, and we do not bill by the hour, so nobody is optimising for utilisation.",
          ],
        },
      },
      {
        type: "roles",
        order: 3,
        content: {
          heading: "Open roles",
          items: [],
          emptyMessage:
            "We have no open roles at the moment. We still read speculative applications — send us something you have worked on and why it mattered.",
        },
      },
      {
        type: "cta",
        order: 4,
        content: {
          heading: "Nothing listed that fits?",
          body: "Write to us anyway. Tell us what you would want to work on.",
          ctaLabel: "Get in touch",
          ctaHref: "/contact",
        },
      },
    ],
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    metaDescription: "How Emporia collects, uses and protects personal data.",
    sections: [
      {
        type: "legal",
        order: 1,
        content: {
          updatedAt: "2026-01-15",
          intro:
            "This policy explains what personal data we collect, why we collect it, and what rights you have over it.",
          clauses: [
            {
              heading: "What we collect",
              text: "When you submit a form on this site we collect the name, email address, phone number and message you provide, together with technical information about how you arrived — the page you landed on, the referring site, and any campaign parameters in the URL.",
            },
            {
              heading: "Why we collect it",
              text: "To respond to your enquiry, to understand which marketing activity produces enquiries, and to meet our record-keeping obligations. We do not sell personal data.",
            },
            {
              heading: "How long we keep it",
              text: "Enquiry records are retained for three years from your last contact with us, after which they are deleted or anonymised.",
            },
            {
              heading: "Cookies",
              text: "We set a first-party identifier so we can attribute an enquiry to the marketing activity that produced it, and a session cookie when you sign in to a client account. We do not use third-party advertising cookies on this site.",
            },
            {
              heading: "Your rights",
              text: "You may ask us for a copy of the personal data we hold about you, ask us to correct it, or ask us to delete it. Write to the address below and we will respond within thirty days.",
            },
            {
              heading: "Contact",
              text: "Questions about this policy can be sent through the contact page.",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "terms-and-conditions",
    title: "Terms and Conditions",
    metaDescription: "The terms governing use of the Emporia website and services.",
    sections: [
      {
        type: "legal",
        order: 1,
        content: {
          updatedAt: "2026-01-15",
          intro:
            "These terms govern your use of this website. Client engagements are governed by a separate signed agreement, which takes precedence over anything here.",
          clauses: [
            {
              heading: "Use of this site",
              text: "You may view and print material from this site for your own reference. You may not republish it commercially without written permission.",
            },
            {
              heading: "Accuracy",
              text: "We take care to keep this site accurate, but case study figures describe past results for specific clients and are not a prediction of what any other engagement will produce.",
            },
            {
              heading: "Pricing",
              text: "Package prices shown on this site are indicative starting points in Indian Rupees and exclude applicable taxes. Final pricing is set out in a written proposal.",
            },
            {
              heading: "Intellectual property",
              text: "All content on this site, including text, design and code, remains our property or that of our licensors.",
            },
            {
              heading: "Liability",
              text: "We do not accept liability for loss arising from reliance on general information published on this site. Liability under a client engagement is governed by that engagement's agreement.",
            },
            {
              heading: "Governing law",
              text: "These terms are governed by the laws of India, and the courts of Gurgaon, Haryana have exclusive jurisdiction.",
            },
          ],
        },
      },
    ],
  },
];

const FAQS: { serviceSlug: string; question: string; answer: string; order: number }[] = [
  {
    serviceSlug: "seo",
    question: "How long before we see results from SEO?",
    answer:
      "Technical fixes can move things within weeks. Content and authority take longer — most engagements show a clear trend by month four and meaningful revenue impact between months six and nine. Anyone promising faster is either working in a very low-competition niche or not telling you the whole story.",
    order: 1,
  },
  {
    serviceSlug: "seo",
    question: "Do you guarantee first-page rankings?",
    answer:
      "No, and neither can anyone else. We report on organic revenue and qualified leads, which are the numbers that matter, and we will show you ranking movement as a leading indicator.",
    order: 2,
  },
  {
    serviceSlug: "seo",
    question: "Will you remove pages from our site?",
    answer:
      "Often, yes. Thin and duplicated pages compete with the ones you want to rank. We always map redirects before removing anything, and we show you the plan first.",
    order: 3,
  },
  {
    serviceSlug: "paid-media",
    question: "What is the minimum ad budget you work with?",
    answer:
      "Around two lakh rupees a month in media spend. Below that there is rarely enough data to optimise against, and you are better served putting the budget into organic foundations first.",
    order: 1,
  },
  {
    serviceSlug: "paid-media",
    question: "Do you charge a percentage of ad spend?",
    answer:
      "No. We charge a flat monthly fee, because a percentage model rewards us for spending more of your money rather than spending it better.",
    order: 2,
  },
  {
    serviceSlug: "paid-media",
    question: "Who owns the ad accounts?",
    answer:
      "You do, always. We work inside your accounts and you retain full access and all historical data if we stop working together.",
    order: 3,
  },
];

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedServices(): Promise<void> {
  for (const s of SERVICES) {
    await upsertWithSeo(
      () => prisma.service.findUnique({ where: { slug: s.slug } }),
      (seoId) =>
        prisma.service.create({
          data: {
            slug: s.slug,
            name: s.name,
            shortDescription: s.shortDescription,
            body: s.body,
            icon: s.icon,
            order: s.order,
            status: "PUBLISHED",
            seoId,
          },
        }),
      (id) =>
        prisma.service.update({
          where: { id },
          data: {
            name: s.name,
            shortDescription: s.shortDescription,
            body: s.body,
            icon: s.icon,
            order: s.order,
            status: "PUBLISHED",
          },
        }),
      {
        metaTitle: `${s.name} services`,
        metaDescription: s.shortDescription,
        schemaType: "SERVICE",
      },
    );
  }
  console.log(`  services: ${SERVICES.length}`);
}

async function seedCities(): Promise<void> {
  for (const c of CITIES) {
    await prisma.city.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        state: c.state,
        order: c.order,
        latitude: c.latitude,
        longitude: c.longitude,
        isActive: true,
      },
      create: { ...c, isActive: true },
    });
  }
  console.log(`  cities: ${CITIES.length}`);
}

async function seedPackages(): Promise<void> {
  for (const p of PACKAGES) {
    const service = p.serviceSlug
      ? await prisma.service.findUnique({ where: { slug: p.serviceSlug }, select: { id: true } })
      : null;

    const pkg = await upsertWithSeo(
      () => prisma.servicePackage.findUnique({ where: { slug: p.slug } }),
      (seoId) =>
        prisma.servicePackage.create({
          data: {
            slug: p.slug,
            name: p.name,
            tagline: p.tagline,
            serviceId: service?.id ?? null,
            price: p.price,
            taxRate: p.taxRate,
            billingType: p.billingType,
            isRecommended: p.isRecommended,
            order: p.order,
            status: "PUBLISHED",
            seoId,
          },
        }),
      (id) =>
        prisma.servicePackage.update({
          where: { id },
          data: {
            name: p.name,
            tagline: p.tagline,
            serviceId: service?.id ?? null,
            price: p.price,
            taxRate: p.taxRate,
            billingType: p.billingType,
            isRecommended: p.isRecommended,
            order: p.order,
            status: "PUBLISHED",
          },
        }),
      { metaTitle: `${p.name} package`, metaDescription: p.tagline },
    );

    // Features are ordered and fully replaced, so a re-run cannot duplicate them.
    await prisma.packageFeature.deleteMany({ where: { packageId: pkg.id } });
    await prisma.packageFeature.createMany({
      data: p.features.map((f, index) => ({
        packageId: pkg.id,
        label: f.label,
        detail: "detail" in f ? (f.detail as string) : null,
        isIncluded: f.isIncluded,
        order: index,
      })),
    });
  }
  console.log(`  packages: ${PACKAGES.length}`);
}

async function seedCaseStudies(): Promise<void> {
  for (const c of CASE_STUDIES) {
    const [service, city] = await Promise.all([
      prisma.service.findUnique({ where: { slug: c.serviceSlug }, select: { id: true } }),
      prisma.city.findUnique({ where: { slug: c.citySlug }, select: { id: true } }),
    ]);

    const study = await upsertWithSeo(
      () => prisma.caseStudy.findUnique({ where: { slug: c.slug } }),
      (seoId) =>
        prisma.caseStudy.create({
          data: {
            slug: c.slug,
            title: c.title,
            clientName: c.clientName,
            summary: c.summary,
            body: c.body,
            serviceId: service?.id ?? null,
            cityId: city?.id ?? null,
            status: "PUBLISHED",
            seoId,
          },
        }),
      (id) =>
        prisma.caseStudy.update({
          where: { id },
          data: {
            title: c.title,
            clientName: c.clientName,
            summary: c.summary,
            body: c.body,
            serviceId: service?.id ?? null,
            cityId: city?.id ?? null,
            status: "PUBLISHED",
          },
        }),
      { metaTitle: c.title, metaDescription: c.summary },
    );

    await prisma.caseStudyMetric.deleteMany({ where: { caseStudyId: study.id } });
    await prisma.caseStudyMetric.createMany({
      data: c.metrics.map((m) => ({ caseStudyId: study.id, ...m })),
    });
  }
  console.log(`  case studies: ${CASE_STUDIES.length}`);
}

async function seedTestimonials(): Promise<void> {
  for (const t of TESTIMONIALS) {
    const [service, city] = await Promise.all([
      prisma.service.findUnique({ where: { slug: t.serviceSlug }, select: { id: true } }),
      prisma.city.findUnique({ where: { slug: t.citySlug }, select: { id: true } }),
    ]);

    const existing = await prisma.testimonial.findFirst({
      where: { authorName: t.authorName, company: t.company },
      select: { id: true },
    });

    const data = {
      authorName: t.authorName,
      authorRole: t.authorRole,
      company: t.company,
      quote: t.quote,
      rating: t.rating,
      serviceId: service?.id ?? null,
      cityId: city?.id ?? null,
      order: t.order,
      status: "PUBLISHED" as const,
    };

    if (existing) await prisma.testimonial.update({ where: { id: existing.id }, data });
    else await prisma.testimonial.create({ data });
  }
  console.log(`  testimonials: ${TESTIMONIALS.length}`);
}

async function seedBlog(authorId: string): Promise<void> {
  for (const post of BLOG) {
    const category = await prisma.blogCategory.upsert({
      where: { slug: post.category.slug },
      update: { name: post.category.name },
      create: { slug: post.category.slug, name: post.category.name },
    });

    const record = await upsertWithSeo(
      () => prisma.blogPost.findUnique({ where: { slug: post.slug } }),
      (seoId) =>
        prisma.blogPost.create({
          data: {
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt,
            body: post.body,
            authorId,
            categoryId: category.id,
            readingMinutes: post.readingMinutes,
            status: "PUBLISHED",
            publishedAt: new Date(),
            seoId,
          },
        }),
      (id) =>
        prisma.blogPost.update({
          where: { id },
          data: {
            title: post.title,
            excerpt: post.excerpt,
            body: post.body,
            categoryId: category.id,
            readingMinutes: post.readingMinutes,
            status: "PUBLISHED",
          },
        }),
      { metaTitle: post.title, metaDescription: post.excerpt, schemaType: "ARTICLE" },
    );

    for (const tagSlug of post.tags) {
      const tag = await prisma.blogTag.upsert({
        where: { slug: tagSlug },
        update: {},
        create: { slug: tagSlug, name: tagSlug.replace(/-/g, " ") },
      });
      await prisma.blogPostTag.upsert({
        where: { postId_tagId: { postId: record.id, tagId: tag.id } },
        update: {},
        create: { postId: record.id, tagId: tag.id },
      });
    }
  }
  console.log(`  blog posts: ${BLOG.length}`);
}

async function seedPages(): Promise<void> {
  for (const p of PAGES) {
    const page = await upsertWithSeo(
      () => prisma.page.findUnique({ where: { slug: p.slug } }),
      (seoId) =>
        prisma.page.create({
          data: { slug: p.slug, title: p.title, status: "PUBLISHED", seoId },
        }),
      (id) => prisma.page.update({ where: { id }, data: { title: p.title, status: "PUBLISHED" } }),
      { metaTitle: p.title, metaDescription: p.metaDescription },
    );

    await prisma.pageSection.deleteMany({ where: { pageId: page.id } });
    await prisma.pageSection.createMany({
      data: p.sections.map((s) => ({
        pageId: page.id,
        type: s.type,
        order: s.order,
        content: s.content,
      })),
    });
  }
  console.log(`  pages: ${PAGES.length}`);
}

async function seedFaqs(): Promise<void> {
  for (const f of FAQS) {
    const service = await prisma.service.findUnique({
      where: { slug: f.serviceSlug },
      select: { id: true },
    });
    if (!service) continue;

    const existing = await prisma.fAQ.findFirst({
      where: { serviceId: service.id, question: f.question },
      select: { id: true },
    });

    const data = {
      question: f.question,
      answer: f.answer,
      serviceId: service.id,
      order: f.order,
      isActive: true,
    };

    if (existing) await prisma.fAQ.update({ where: { id: existing.id }, data });
    else await prisma.fAQ.create({ data });
  }
  console.log(`  faqs: ${FAQS.length}`);
}

async function seedServiceCityPages(): Promise<void> {
  let published = 0;
  let draft = 0;

  for (const p of SERVICE_CITY_PAGES) {
    const [service, city] = await Promise.all([
      prisma.service.findUnique({ where: { slug: p.serviceSlug }, select: { id: true } }),
      prisma.city.findUnique({ where: { slug: p.citySlug }, select: { id: true } }),
    ]);
    if (!service || !city) continue;

    const existing = await prisma.serviceCityPage.findUnique({
      where: { serviceId_cityId: { serviceId: service.id, cityId: city.id } },
      select: { id: true, seoId: true },
    });

    const content = {
      localIntro: p.localIntro,
      marketContext: p.marketContext,
      industries: p.industries,
      positioning: p.positioning,
      ctaHeading: p.ctaHeading,
      ctaBody: p.ctaBody,
      // Status is set from `publish` here only because the seed is not a user.
      // In the application the ONLY route to PUBLISHED is publishPage(), which
      // gates on canPublish() — see serviceCityPage.service.ts.
      status: (p.publish ? "PUBLISHED" : "DRAFT") as "PUBLISHED" | "DRAFT",
      publishedAt: p.publish ? new Date() : null,
    };

    let pageId: string;

    if (existing) {
      await prisma.serviceCityPage.update({ where: { id: existing.id }, data: content });
      pageId = existing.id;

      if (existing.seoId) {
        await prisma.seo.update({
          where: { id: existing.seoId },
          data: { metaTitle: p.metaTitle, metaDescription: p.metaDescription },
        });
      }
    } else {
      const seo = await prisma.seo.create({
        data: {
          metaTitle: p.metaTitle,
          metaDescription: p.metaDescription,
          schemaType: "LOCAL_BUSINESS",
        },
      });
      const created = await prisma.serviceCityPage.create({
        data: { serviceId: service.id, cityId: city.id, seoId: seo.id, ...content },
        select: { id: true },
      });
      pageId = created.id;
    }

    await prisma.fAQ.deleteMany({ where: { serviceCityPageId: pageId } });
    if (p.faqs.length > 0) {
      await prisma.fAQ.createMany({
        data: p.faqs.map((f) => ({
          serviceCityPageId: pageId,
          question: f.question,
          answer: f.answer,
          order: f.order,
          isActive: true,
        })),
      });
    }

    if (p.publish) published += 1;
    else draft += 1;
  }

  console.log(`  service-city pages: ${published} published, ${draft} draft (thin, refused by canPublish)`);
}

/**
 * Demo popups.
 *
 * One is targeted narrowly at SEO in Gurgaon, which is the Phase 6 exit
 * criterion: it must fire there and nowhere else.
 */
async function seedPopups(): Promise<void> {
  const [seo, gurgaon] = await Promise.all([
    prisma.service.findUnique({ where: { slug: "seo" }, select: { id: true } }),
    prisma.city.findUnique({ where: { slug: "gurgaon" }, select: { id: true } }),
  ]);

  const definitions = [
    {
      name: "SEO Gurgaon — local audit offer",
      title: "Competing with four firms on the same road?",
      body: "We will map where your Gurgaon pages compete with each other, free, in one working day.",
      ctaLabel: "Send me the audit",
      trigger: "TIME_DELAY" as const,
      triggerValue: 8,
      frequency: "ONCE_PER_DAY" as const,
      priority: 50,
      isActive: true,
      targets:
        seo && gurgaon
          ? [
              {
                type: "SERVICE_CITY" as const,
                serviceId: seo.id,
                cityId: gurgaon.id,
                visitorType: "ANY" as const,
                device: "ANY" as const,
              },
            ]
          : [],
    },
    {
      name: "Packages — exit intent",
      title: "Not sure which package fits?",
      body: "Tell us the number you are trying to move and we will scope it properly.",
      ctaLabel: "Talk it through",
      trigger: "EXIT_INTENT" as const,
      triggerValue: null,
      frequency: "ONCE_PER_WEEK" as const,
      priority: 10,
      isActive: true,
      targets: [
        {
          type: "PAGE" as const,
          path: "/packages/*",
          visitorType: "ANY" as const,
          device: "ANY" as const,
        },
      ],
    },
  ];

  for (const def of definitions) {
    const existing = await prisma.popup.findFirst({
      where: { name: def.name },
      select: { id: true },
    });

    const data = {
      title: def.title,
      body: def.body,
      ctaLabel: def.ctaLabel,
      trigger: def.trigger,
      triggerValue: def.triggerValue,
      frequency: def.frequency,
      priority: def.priority,
      isActive: def.isActive,
    };

    const popup = existing
      ? await prisma.popup.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.popup.create({
          data: { name: def.name, ...data },
          select: { id: true },
        });

    await prisma.popupTarget.deleteMany({ where: { popupId: popup.id } });
    for (const target of def.targets) {
      await prisma.popupTarget.create({
        data: {
          popupId: popup.id,
          type: target.type,
          path: "path" in target ? target.path : null,
          serviceId: "serviceId" in target ? target.serviceId : null,
          cityId: "cityId" in target ? target.cityId : null,
          visitorType: target.visitorType,
          device: target.device,
        },
      });
    }
  }

  console.log(`  popups: ${definitions.length}`);
}

async function seedSiteSettings(): Promise<void> {
  const settings = [
    { key: "site.name", value: "Emporia", group: "general" },
    { key: "site.tagline", value: "Digital marketing that compounds", group: "general" },
    {
      key: "site.description",
      value:
        "An independent digital marketing agency. We report on pipeline rather than impressions.",
      group: "general",
    },
    { key: "site.email", value: "hello@emporia.example", group: "contact" },
    { key: "site.phone", value: "+91 124 000 0000", group: "contact" },
    {
      key: "site.address",
      value: "Sector 44, Gurgaon, Haryana 122003, India",
      group: "contact",
    },

    // SEO defaults — the last link in every fallback chain (lib/seo/defaults).
    {
      key: "seo.defaultMetaTitle",
      value: "Emporia — digital marketing that reports on pipeline",
      group: "seo",
    },
    {
      key: "seo.defaultMetaDescription",
      value:
        "An independent digital marketing agency running SEO, paid media, content and analytics as one measured programme.",
      group: "seo",
    },
    { key: "seo.titleTemplate", value: "%s · Emporia", group: "seo" },
    { key: "seo.locale", value: "en_IN", group: "seo" },
    // No seo.ogImageUrl: there is no media library until Phase 11, and an
    // invented image URL would be worse than none.
  ];

  for (const s of settings) {
    await prisma.siteSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, group: s.group },
      create: s,
    });
  }
  console.log(`  site settings: ${settings.length}`);
}

async function main(): Promise<void> {
  console.log("Seeding DEMO content (npm run db:seed:demo).");
  console.log("This is sample data for development. Do not run it against production.\n");

  // Blog posts need an author. Reuse the first staff user rather than
  // inventing one, so demo content is never attributed to a fake account.
  const author = await prisma.user.findFirst({
    where: { type: "STAFF" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!author) {
    throw new Error(
      "No staff user found. Run `npm run db:seed` first to create the super admin.",
    );
  }

  await seedServices();
  await seedCities();
  await seedPackages();
  await seedCaseStudies();
  await seedTestimonials();
  await seedBlog(author.id);
  await seedPages();
  await seedFaqs();
  await seedServiceCityPages();
  await seedPopups();
  await seedSiteSettings();

  // Auditable marker, so demo data can be identified and removed later.
  await prisma.siteSetting.upsert({
    where: { key: "demo.seededAt" },
    update: { value: new Date().toISOString() },
    create: { key: "demo.seededAt", value: new Date().toISOString(), group: "internal" },
  });

  console.log("\nDone. Marked in SiteSetting as demo.seededAt.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
