import type { PrismaClient } from "../generated/prisma/client.js";
import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { STARTER_MARKER, starterSectionCount } from "../lib/content/starter.js";

/**
 * DigiEmporia's Privacy Policy and Terms and Conditions, as approved by the
 * proprietor on 14 October 2026.
 *
 * The two legal pages hold reserved slugs, so a fresh install gives them
 * starter drafts (prisma/ensure-starter-pages) that cannot be published. This
 * replaces that starter text with the real policy and publishes it, once, on
 * the next boot.
 *
 * **Only ever over placeholder text.** A page is rewritten only while it is
 * still one of the two placeholders this codebase lays down:
 *
 * - the starter draft, every section still carrying STARTER_MARKER; or
 * - the sample policy from `npm run db:seed:demo` (one `legal` block with the
 *   demo's own intro and date), which is published, and which a production
 *   database that was demo-seeded is serving as if it were real.
 *
 * Once the real text is in, neither matches and this never touches the page
 * again: from then on Admin → Website → Pages is the only way to change it. A
 * page someone has partly written, archived or deleted is left exactly as it
 * is. What is replaced is kept in full in the audit row.
 */

export const LEGAL_UPDATED = "14 October 2026";

type Section = { type: string; content: Record<string, unknown> };
type LegalPage = { slug: string; title: string; metaDescription: string; sections: Section[] };

const text = (body: string, heading?: string): Section => ({
  type: "richText",
  content: heading ? { heading, body } : { body },
});
const table = (headers: string[], rows: string[][], heading?: string): Section => ({
  type: "table",
  content: heading ? { heading, headers, rows } : { headers, rows },
});
const list = (items: string[], heading?: string): Section => ({
  type: "list",
  content: heading ? { heading, style: "bulleted", items } : { style: "bulleted", items },
});
const hero = (heading: string): Section => ({
  type: "hero",
  content: { heading, body: `Last updated: ${LEGAL_UPDATED}`, layout: "stacked" },
});
const paragraphs = (...lines: string[]) => lines.join("\n\n");

const OWNER = "DigiEmporia, a sole proprietorship owned by **Nishita** (GSTIN 07CXOPV1073K1ZT) (“DigiEmporia”, “we”, “us”)";
const ADDRESS = "S/F, A-73/2, Verma Cottage, Gurudwara Road, West Delhi, Delhi 110059, India";
const EMAIL = "ceo@digiemporia.com";
const PHONE = "+91 88160 81808";

const PRIVACY: LegalPage = {
  slug: "privacy-policy",
  title: "Privacy Policy",
  metaDescription:
    "How DigiEmporia collects, uses, shares and protects personal data under India's Digital Personal Data Protection Act, 2023, and how to exercise your rights.",
  sections: [
    hero("Privacy Policy"),
    text(
      paragraphs(
        `This Privacy Policy explains how ${OWNER}, collects, uses, shares and protects personal data. It applies when you visit www.digiemporia.in, contact us, use our client portal, or work with us as a client.`,
        "We process personal data in line with India's Digital Personal Data Protection Act, 2023 (“DPDP Act”) and the Information Technology Act, 2000. For the purposes of the DPDP Act, DigiEmporia is the Data Fiduciary for the personal data described here.",
        `Registered office: ${ADDRESS}.`,
      ),
    ),
    table(
      ["When", "What we collect"],
      [
        ["You fill in a contact, enquiry or popup form", "Name, email, phone number, company, the service and city you are interested in, your budget if you give it, and your message"],
        ["You arrive on our website", "How you reached us: the landing page, the referring website, campaign tags (UTM source, medium, campaign, term, content), device type, and which popup you saw"],
        ["You use the client portal", "Your name, email, password (stored only as a one-way hash), sign-in times, files you upload, messages, and your approvals of our work"],
        ["You become a client", "Business details such as legal name, tax ID (for example GSTIN), address, public phone and email, opening hours, website, brand assets and social media profiles; proposals, contracts, invoices and payment records"],
        ["You pay an invoice online", "Payment status and reference from our payment provider. We never see or store your card, UPI PIN or bank login"],
        ["You connect a social or Google account", "The account's name, handle and profile link, access tokens, and the posts, insights and reports we read with your permission (see the section on connected accounts)"],
      ],
      "What we collect",
    ),
    text(
      paragraphs(
        "We also keep technical logs (IP address, browser and time of request) for security, and an audit record of changes made in our systems.",
        "We do not knowingly collect sensitive personal data such as health, financial account or biometric information.",
      ),
    ),
    text(
      "We use personal data only for the purposes below. Where the DPDP Act requires consent, we ask for it at the point of collection, and you can withdraw it at any time. Where we rely on another lawful basis, it is named.",
      "Why we collect it",
    ),
    table(
      ["Purpose", "Lawful basis"],
      [
        ["Reply to your enquiry and send a proposal", "Your consent, given when you submit the form"],
        ["Understand which pages and campaigns bring enquiries (attribution)", "Your consent, and our legitimate use under section 7 of the DPDP Act to respond to requests you make"],
        ["Deliver the services in a signed agreement: content, social media, SEO, reporting, approvals", "Performance of the agreement you or your company entered into"],
        ["Run the client portal and keep it secure", "Performance of the agreement; security and fraud prevention"],
        ["Issue invoices, take payments and keep accounts", "Legal obligation under the GST and tax laws"],
        ["Send service emails such as invoices, payment reminders, approvals and reports", "Performance of the agreement"],
        ["Send marketing emails", "Your consent only. Every marketing email has an unsubscribe link"],
      ],
    ),
    text(
      paragraphs(
        "We do not sell personal data, and we do not use it for any purpose not listed here without asking you first.",
        "**AI-assisted drafting.** We use AI tools to help our team draft content, summarise enquiries and suggest replies. A person always reviews the output before it is used. We do not use your data to train AI models, and we use AI providers only on paid business plans whose terms do not allow them to train on what we send.",
      ),
    ),
    text(
      "Our website uses a small number of first-party cookies that it needs to work, and optional analytics and advertising tools that load **only after you agree** in the cookie banner.",
      "Cookies and tracking",
    ),
    table(
      ["Cookie", "Purpose", "Lasts"],
      [
        ["em_vid", "An anonymous visitor ID, so we can tell which page and campaign led to an enquiry", "2 years"],
        ["em_ft, em_lt", "The first and latest way you reached us (referrer and campaign tags)", "2 years, 90 days"],
        ["em_ses", "Marks a browsing session", "Session"],
        ["em_pop", "Remembers which popups you have seen, so we do not repeat them", "1 year"],
        ["emporia_consent", "Remembers your cookie choice", "6 months"],
        ["Sign-in cookies", "Keep portal and staff users signed in. Secure and HTTP-only", "Until you sign out"],
      ],
    ),
    text(
      paragraphs(
        "**Optional tools, only with your consent:** Google Analytics 4, Google Tag Manager, Google Ads, Meta Pixel, Microsoft Clarity and Hotjar. These are set by those providers, under their own privacy policies.",
        "You can change your choice at any time with the “Cookie settings” button on the website, or clear cookies in your browser. Declining optional cookies does not stop the site from working.",
      ),
    ),
    text(
      "We share personal data only with service providers that process it for us (Data Processors), under contract, and only as far as each one needs. We never sell it.",
      "Who we share it with",
    ),
    table(
      ["Provider", "What they do for us", "Where"],
      [
        ["Contabo", "Hosts our website, portal and database", "Asia"],
        ["Cloudflare (R2)", "Stores files and images you upload", "Global"],
        ["Hostinger", "Delivers our emails", "Global"],
        ["Razorpay", "Processes online payments", "India"],
        ["Anthropic or Google (Gemini)", "AI-assisted drafting and summaries, reviewed by our team", "United States"],
        ["Google, Meta, LinkedIn, X", "Only when you connect your account: publishing, insights and reports", "Global"],
        ["Analytics and advertising tools", "Only after your cookie consent", "Global"],
      ],
    ),
    text(
      paragraphs(
        "We may also disclose data when the law requires it, for example to a court or a government authority with legal power to ask, or to protect our rights in a legal claim.",
        "**Transfers outside India.** Some providers above store or process data outside India. We transfer data only to countries not restricted by the Government of India under section 16 of the DPDP Act, and only to providers that protect it to a standard comparable to this policy.",
      ),
    ),
    text(
      "Clients and our team can connect a social media or Google account to our platform. You sign in on the platform's own page; **we never see or store your password**. We store the access token the platform gives us, encrypted, and use it only for the purposes below.",
      "Connected social and Google accounts",
    ),
    table(
      ["Account", "Permissions we ask for", "What we use them for"],
      [
        ["Google Search Console", "Read-only access to search performance data", "Show search clicks, queries and pages in your SEO reports"],
        ["Google Analytics 4", "Read-only access to analytics data", "Show traffic, channels and conversions in your SEO reports"],
        ["YouTube", "Upload videos, and read your channel and video statistics", "Publish videos you have approved, and report on how they perform"],
        ["Google Business Profile", "Manage your business locations", "Publish approved posts, and read reviews and listing details for reports"],
        ["Instagram (Business or Creator)", "Basic profile, publish content, manage comments, read insights", "Publish approved posts and the first comment, and report on performance"],
        ["Facebook Pages", "List your Pages, publish posts, read engagement and insights", "Publish approved posts to the Page you choose, and report on performance"],
        ["LinkedIn", "Your basic profile and email, and posting on your behalf", "Publish approved posts to your profile"],
        ["X (Twitter)", "Read and write posts, read your profile, upload media", "Publish approved posts with their images"],
      ],
    ),
    text(
      paragraphs(
        "We publish only content you or your team have approved. We do not post anything else, send messages, follow, like, or change your account settings.",
        "**Google API data.** DigiEmporia's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. We use Google user data only to provide the reporting and publishing features you asked for. We do not use it for advertising, do not sell it, do not let people read it except your account team as needed for support, security or the law, and do not use it to train AI models.",
        "**Disconnecting.** Your account team can disconnect an account in our platform at any time, which deletes the stored token. You can also remove our access yourself:",
      ),
    ),
    list([
      "Google: myaccount.google.com/permissions",
      "Facebook and Instagram: Settings → Business integrations, or Instagram Settings → Apps and websites",
      "LinkedIn: Settings → Data privacy → Permitted services",
      "X: Settings → Security and account access → Apps and sessions",
    ]),
    table(
      ["Data", "How long"],
      [
        ["Enquiries that do not become clients", "Up to 3 years after our last contact, then deleted"],
        ["Client records, content, approvals and reports", "For the agreement, then up to 3 years"],
        ["Invoices, payments and contracts", "As long as tax and company law require, currently up to 8 years"],
        ["Connected account tokens", "Until the account is disconnected, when they are deleted"],
        ["Website analytics cookies", "As listed under Cookies and tracking"],
        ["Security and audit logs", "Up to 2 years"],
      ],
      "How long we keep it",
    ),
    text("When you ask us to delete your data, we delete it or remove what identifies you, except what the law requires us to keep."),
    list(
      [
        "All traffic to our website and portal is encrypted (HTTPS).",
        "Passwords are stored only as one-way hashes (Argon2), never in readable form.",
        "Social and Google access tokens are encrypted at rest (AES-256-GCM).",
        "Staff see only what their role needs. Every change to client data is recorded in an audit log.",
        "Each client sees only their own projects, files, invoices and messages in the portal.",
        "Sign-in and forms are rate-limited to stop automated attacks.",
      ],
      "How we protect it",
    ),
    text("No system is perfectly secure. If a breach affects your personal data, we will inform you and the Data Protection Board of India as the DPDP Act requires."),
    text(
      "Our website and services are for businesses and adults. We do not knowingly collect personal data from anyone under 18. If you believe a child has given us their data, contact us and we will delete it.",
      "Children",
    ),
    text(
      "We may update this policy when our services or the law change. The date at the top shows the latest version. If a change materially affects how we use your data, we will tell clients by email or in the portal before it takes effect.",
      "Changes to this policy",
    ),
    list(
      [
        "get a summary of the personal data we hold about you and how we use it;",
        "have inaccurate or incomplete data corrected or updated;",
        "have your data erased when it is no longer needed, unless the law requires us to keep it;",
        "withdraw any consent you gave, as easily as you gave it;",
        "nominate another person to exercise these rights if you die or become unable to;",
        "have a grievance addressed by us, and then by the Data Protection Board of India.",
      ],
      "Your rights and how to contact us",
    ),
    text(
      paragraphs(
        `**How to delete your data.** Email ${EMAIL} from the address you used with us, with the subject “Delete my data”. Tell us which account or enquiry it concerns, and whether you also want connected social or Google accounts removed. We confirm by email when it is done, within 30 days. This also serves as our data deletion instructions for Facebook and Instagram users.`,
        "We reply to every rights request within 30 days. We may ask you to confirm your identity first.",
      ),
    ),
    list(
      [
        "Name: Nishita, Proprietor, DigiEmporia",
        `Address: ${ADDRESS}`,
        `Email: ${EMAIL}`,
        `Phone: ${PHONE}`,
      ],
      "Grievance Officer",
    ),
    text("We acknowledge grievances within 48 hours and resolve them within 30 days. If you are not satisfied, you may complain to the Data Protection Board of India."),
  ],
};

const TERMS: LegalPage = {
  slug: "terms-and-conditions",
  title: "Terms and Conditions",
  metaDescription:
    "The terms that govern use of the DigiEmporia website and client portal: pricing and proposals, payments, intellectual property, liability and governing law.",
  sections: [
    hero("Terms and Conditions"),
    text(
      paragraphs(
        `These Terms govern your use of www.digiemporia.in and the DigiEmporia client portal, operated by ${OWNER}. By using the website or the portal, you agree to these Terms and to our [Privacy Policy](/privacy-policy). If you do not agree, please do not use them.`,
        "Our marketing services are governed by the proposal and the signed agreement for each engagement. Where that agreement and these Terms differ, the agreement wins.",
      ),
    ),
    text("You may browse the site, read our content and contact us for your own business purposes. You agree not to:", "Use of this site"),
    list([
      "copy, republish or sell our content, case studies or designs without written permission;",
      "send false, misleading or spam enquiries, or submit someone else's details without their permission;",
      "try to break into, overload, scrape or disrupt the site or the portal, or get around its security;",
      "use the site for anything unlawful.",
    ]),
    text(
      paragraphs(
        "Case studies and results on the site describe past work for specific clients. They are not a promise of the same results for you: marketing outcomes depend on your market, budget, offer and many factors outside our control.",
        "We may change, suspend or remove any part of the site at any time.",
      ),
    ),
    {
      type: "textList",
      content: {
        heading: "Pricing, proposals and payments",
        items: [
          { title: "Prices on the site are indicative", text: "They are in Indian Rupees (INR) and exclude GST, which is added at the applicable rate. The price that binds is the one in your accepted proposal or signed agreement." },
          { title: "Proposals", text: "Proposals are valid for 30 days from the date they are sent, unless the proposal says otherwise." },
          { title: "Advertising spend", text: "Ad spend on Google, Meta or other platforms is separate from our fees and is paid to those platforms, unless your agreement says we pay it on your behalf." },
          { title: "Invoices", text: "Invoices are due by the date shown on them. Retainers are invoiced at the start of each billing cycle in your agreement. We may pause work on overdue accounts after giving notice." },
          { title: "Online payments", text: "Online payments are processed by Razorpay. An invoice is marked paid only when Razorpay confirms the payment to us, not when the payment page says it succeeded." },
          { title: "Refunds", text: "Refunds follow your agreement. Fees for work already delivered or time already spent are not refundable." },
        ],
      },
    },
    list(
      [
        "Portal access is by invitation, for a client's own staff. Keep your password private. You are responsible for what is done through your login, and must tell us at once if you think someone else has used it.",
        "You see only your own company's projects, files, invoices, reports and messages.",
        "When you connect a social media or Google account, you confirm that you are allowed to manage it, and you authorise us to publish the content you have approved and to read its performance data, as described in our Privacy Policy.",
        "You can ask us to disconnect a connected account at any time.",
        "Approving content in the portal authorises us to publish it at the scheduled time. You are responsible for checking facts, offers, prices and claims in content before you approve it.",
        "Each platform's own rules apply to what is published there. We are not responsible if a platform changes its features, limits or policies, rejects a post, or restricts an account.",
        "We may suspend portal access to protect the service or if an agreement ends. Your financial records remain available to you on request.",
      ],
      "Client portal and connected accounts",
    ),
    text(
      paragraphs(
        "The website, its text, design, graphics, logos and code belong to DigiEmporia or our licensors. You may not use them without our written permission.",
        "Work we create for a client is owned as set out in that client's agreement. Unless it says otherwise, ownership of final deliverables passes to the client once the related invoices are paid in full. We keep the right to show the work in our portfolio, unless the client asks us not to.",
        "You keep ownership of the logos, brand assets, content and data you give us. You give us permission to use them only to deliver our services, and you confirm you have the right to give them to us.",
      ),
      "Intellectual property",
    ),
    list(
      [
        "The website's content is general information, not professional advice for your business. We work to keep it accurate but do not guarantee it is complete or current.",
        "We do not guarantee specific results, such as rankings, traffic, leads, followers or sales.",
        "To the extent the law allows, we are not liable for indirect or consequential losses, such as lost profits, revenue or data, arising from your use of the site or portal.",
        "For work under an agreement, our total liability is limited to the fees you paid us for that work in the 3 months before the claim, unless the agreement says otherwise.",
        "Nothing in these Terms limits liability that cannot be limited under Indian law, such as for fraud.",
      ],
      "Liability",
    ),
    text(
      paragraphs(
        "**Indemnity.** You agree to cover our reasonable losses if they arise from content or materials you gave us, or from your breach of these Terms.",
        "**Third-party links and services.** The site and portal link to and rely on third parties such as social platforms, Google and Razorpay. We are not responsible for their content, availability or policies.",
      ),
    ),
    text(
      paragraphs(
        "**Governing law.** These Terms are governed by the laws of India. The courts at Delhi have exclusive jurisdiction over any dispute arising from them.",
        "**Changes.** We may update these Terms from time to time. The date at the top shows the latest version. Continuing to use the site or the portal after a change means you accept the updated Terms.",
        "**Severability.** If any part of these Terms is found unenforceable, the rest stays in force.",
        `**Contact.** DigiEmporia (proprietor: Nishita), ${ADDRESS}. Email: ${EMAIL}. Phone: ${PHONE}.`,
      ),
      "Governing law, changes and contact",
    ),
  ],
};

export const LEGAL_PAGES: LegalPage[] = [PRIVACY, TERMS];

/** True while a page is still exactly what a fresh install laid down: every section marked. */
function untouchedStarter(sections: readonly { content: unknown }[]): boolean {
  return sections.length > 0 && starterSectionCount(sections) === sections.length;
}

/**
 * The sample legal pages prisma/seed-demo.ts publishes, recognised by the
 * demo's own intro and date. That file runs on import, so the fingerprint is
 * repeated here rather than imported; tests/legal-pages.db.test.ts checks the
 * two still agree.
 */
export const DEMO_LEGAL: Record<string, { updatedAt: string; intro: string; metaDescription: string }> = {
  "privacy-policy": {
    updatedAt: "2026-01-15",
    intro: "This policy explains what personal data we collect, why we collect it, and what rights you have over it.",
    metaDescription: "How Emporia collects, uses and protects personal data.",
  },
  "terms-and-conditions": {
    updatedAt: "2026-01-15",
    intro:
      "These terms govern your use of this website. Client engagements are governed by a separate signed agreement, which takes precedence over anything here.",
    metaDescription: "The terms governing use of the Emporia website and services.",
  },
};

function demoPlaceholder(slug: string, sections: readonly { type: string; content: unknown }[]): boolean {
  const demo = DEMO_LEGAL[slug];
  const [only] = sections;
  if (!demo || sections.length !== 1 || only?.type !== "legal") return false;
  const content = only.content as { updatedAt?: unknown; intro?: unknown } | null;
  return content?.updatedAt === demo.updatedAt && content.intro === demo.intro;
}

export async function ensureLegalPages(prisma: PrismaClient): Promise<string> {
  const published: string[] = [];
  const left: string[] = [];

  for (const legal of LEGAL_PAGES) {
    const page = await prisma.page.findUnique({
      where: { slug: legal.slug },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        publishedAt: true,
        seo: { select: { id: true, metaDescription: true } },
        sections: { orderBy: { order: "asc" }, select: { type: true, order: true, content: true } },
      },
    });
    // ensureStarterPages runs first, so a missing page means someone removed
    // the row by hand; recreating it is not this function's call.
    if (!page || page.deletedAt || page.status === "ARCHIVED") continue;
    const replacing =
      page.status === "DRAFT" && untouchedStarter(page.sections)
        ? "starter"
        : demoPlaceholder(legal.slug, page.sections)
          ? "demo"
          : null;
    if (!replacing) {
      if (page.status === "DRAFT" && starterSectionCount(page.sections) > 0) left.push(legal.slug);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.pageSection.deleteMany({ where: { pageId: page.id } });
      await tx.pageSection.createMany({
        data: legal.sections.map((section, index) => ({
          pageId: page.id,
          type: section.type,
          order: (index + 1) * 10,
          content: section.content as InputJsonValue,
        })),
      });
      // An SEO record an editor wrote stays; an empty one or the demo's gets the policy's description.
      const ownDescription = page.seo?.metaDescription && page.seo.metaDescription !== DEMO_LEGAL[legal.slug]?.metaDescription;
      const seo = !page.seo
        ? { create: { metaDescription: legal.metaDescription } }
        : ownDescription
          ? undefined
          : { update: { metaDescription: legal.metaDescription } };
      await tx.page.update({
        where: { id: page.id },
        data: {
          title: legal.title,
          description: `Policy text approved ${LEGAL_UPDATED}. Edit here; deploys no longer change it.`,
          status: "PUBLISHED",
          workflow: "APPROVED",
          publishedAt: page.publishedAt ?? new Date(),
          ...(seo ? { seo } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "PUBLISH",
          entityType: "Page",
          entityId: page.id,
          before: { status: page.status, replaced: replacing, sections: page.sections } as InputJsonValue,
          after: { status: "PUBLISHED", slug: legal.slug, source: "prisma/legal-pages" },
        },
      });
    });
    published.push(legal.slug);
  }

  const parts = [
    published.length ? `published ${published.join(", ")}` : "nothing to publish",
    ...(left.length ? [`left alone (partly edited, still marked “${STARTER_MARKER}”): ${left.join(", ")}`] : []),
  ];
  return `legal pages: ${parts.join("; ")}.`;
}
