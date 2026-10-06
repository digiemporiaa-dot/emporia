import type { PrismaClient } from "../generated/prisma/client.js";
import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { STARTER_MARKER } from "../lib/content/starter.js";

/**
 * Give a fresh install its About, Careers, Privacy Policy and Terms pages — as
 * drafts.
 *
 * Those four addresses are reserved slugs (the bespoke routes read the CMS page
 * by exactly that slug), so they cannot be created from Admin → Website →
 * Pages. Without this they would 404 for ever on a database that was never
 * given the demo seed. Same rules as `ensureHomepage`:
 *
 * **Never destructive.** A page row with the slug — even a draft, even
 * soft-deleted — means nothing is done.
 *
 * **No invented business data, and never live.** Each page is a DRAFT built
 * from ordinary builder blocks, and every paragraph is guidance that starts
 * with STARTER_MARKER. A page carrying the marker cannot be published, and the
 * header and footer hide links to unpublished pages, so nothing here can reach
 * a visitor until a person has written the real text.
 */

const say = (text: string) => `${STARTER_MARKER} ${text}`;

const richText = (heading: string, text: string) => ({ type: "richText", content: { heading, body: say(text) } });

type Starter = { slug: string; title: string; description: string; sections: { type: string; content: Record<string, unknown> }[] };

export const STARTER_PAGES: Starter[] = [
  {
    slug: "about",
    title: "About",
    description: "Starter page created on first deploy. Replace every marked paragraph, then publish.",
    sections: [
      { type: "hero", content: { eyebrow: "About", heading: "Who we are", body: say("One or two sentences on who you are and who you work for."), layout: "stacked" } },
      richText("How we work", "How you run engagements, what clients can expect, and what you will not do. Only claims you can stand behind."),
      richText("The team", "Who leads the work. Add a Team block from the builder if you want photos and roles."),
      { type: "cta", content: { heading: "Want to work together?", body: say("Your closing line."), ctaLabel: "Get in touch", ctaHref: "/contact" } },
    ],
  },
  {
    slug: "careers",
    title: "Careers",
    description: "Starter page created on first deploy. Replace every marked paragraph, then publish.",
    sections: [
      { type: "hero", content: { eyebrow: "Careers", heading: "Work with us", body: say("What it is like to work here, in a sentence or two."), layout: "stacked" } },
      richText("Open roles", "List current openings, or say there are none and how to apply speculatively."),
      { type: "cta", content: { heading: "Nothing that fits?", body: say("Tell people how to reach you anyway."), ctaLabel: "Get in touch", ctaHref: "/contact" } },
    ],
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    description: "Starter page created on first deploy. Have the text written or reviewed by a lawyer, then publish.",
    sections: [
      { type: "hero", content: { heading: "Privacy Policy", body: say("When this policy was last updated, and who it applies to."), layout: "stacked" } },
      richText("What we collect", "This site's contact, page and popup forms collect name, email, phone and message, plus how the visitor arrived (landing page, referrer, campaign parameters, device). Client portal accounts hold the user's name and email. Say exactly what you collect."),
      richText("Why we collect it", "The purposes and the lawful basis for each — for India, the Digital Personal Data Protection Act, 2023."),
      richText("Cookies and tracking", "This site sets a first-party visitor identifier for attribution and session cookies for signed-in users; analytics or advertising pixels load only after consent, if configured. List what you actually use."),
      richText("Who we share it with", "Processors such as email delivery, file storage, payments and analytics providers, and where they are."),
      richText("How long we keep it", "Retention periods for enquiries, client records and invoices."),
      richText("Your rights and how to contact us", "Access, correction, erasure and grievance rights, with the contact and grievance officer details required by law."),
    ],
  },
  {
    slug: "terms-and-conditions",
    title: "Terms and Conditions",
    description: "Starter page created on first deploy. Have the text written or reviewed by a lawyer, then publish.",
    sections: [
      { type: "hero", content: { heading: "Terms and Conditions", body: say("When these terms were last updated, and that client engagements are governed by their own signed agreement."), layout: "stacked" } },
      richText("Use of this site", "What visitors may and may not do with the content of this site."),
      richText("Pricing and proposals", "Whether prices shown are indicative, which currency, and whether taxes are included."),
      richText("Intellectual property", "Who owns the site's content."),
      richText("Liability", "Limits of liability for information on this site."),
      richText("Governing law", "Which law governs these terms and which courts have jurisdiction."),
    ],
  },
];

export async function ensureStarterPages(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.page.findMany({ where: { slug: { in: STARTER_PAGES.map((page) => page.slug) } }, select: { slug: true } });
  const have = new Set(existing.map((page) => page.slug));
  const created: string[] = [];
  for (const page of STARTER_PAGES) {
    if (have.has(page.slug)) continue;
    await prisma.page.create({
      data: {
        slug: page.slug,
        title: page.title,
        internalName: page.title,
        description: page.description,
        status: "DRAFT",
        sections: { create: page.sections.map((section, index) => ({ type: section.type, order: (index + 1) * 10, content: section.content as InputJsonValue })) },
      },
    });
    created.push(page.slug);
  }
  return created.length
    ? `starter pages: created ${created.join(", ")} as drafts — replace the marked text in Admin → Website → Pages, then publish.`
    : "starter pages: already exist.";
}
