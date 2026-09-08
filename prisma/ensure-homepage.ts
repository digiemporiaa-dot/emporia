import type { PrismaClient } from "../generated/prisma/client.js";
import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { BANDS } from "./migrate-homepage.js";

/**
 * Give a fresh install a homepage.
 *
 * `/` renders the CMS page with slug `home`, and `home` is a reserved slug, so
 * it cannot be created from Admin → Website → Pages. On a database that has
 * never had one — a first deploy, or one seeded with configuration but no
 * content — that combination means the front page 404s and there is no way to
 * fix it from the admin. This is the only path that can create it.
 *
 * Two properties it has to have, because it runs unattended on every boot:
 *
 * **Never destructive.** If a `Page` row with that slug exists at all — even
 * soft-deleted, even a draft, even one whose sections someone has emptied — it
 * does nothing. A homepage an editor deleted stays deleted; a draft stays a
 * draft. There is no path here that overwrites or resurrects a page.
 *
 * **No invented business data.** The bands it lays down are the dynamic ones
 * that read live records — services, case studies, packages, testimonials,
 * posts — so they render what is actually published and an empty state when
 * nothing is (CLAUDE.md 2 rule 5). The only prose is the hero and the closing
 * call to action, which say what they are: placeholder copy to replace. No
 * metrics, no claims, no fake clients.
 */

/**
 * Neutral headings for the dynamic bands.
 *
 * Each of these bands renders nothing at all until there is something published
 * to render, so on day one they are invisible; these are the words that appear
 * the moment the first service or case study goes live.
 */
const STARTER_WORDING: Record<string, Record<string, string>> = {
  serviceGrid: { eyebrow: "Services", heading: "What we do." },
  stats: { eyebrow: "Results", heading: "By the numbers." },
  packageGrid: { eyebrow: "Packages", heading: "Ways to work together." },
  blogGrid: { eyebrow: "Insights", heading: "Latest writing." },
};

/** Editable placeholder copy. Deliberately generic and obviously provisional. */
function starterSections(siteName: string, tagline: string) {
  const hero = {
    type: "hero",
    content: {
      eyebrow: siteName,
      heading: tagline || "Say what you do, in one line.",
      body: "This is your homepage, and it is a normal CMS page. Edit this copy, reorder the bands below, hide the ones you do not need yet, or add new ones — Admin → Website → Pages → Home.",
      ctaLabel: "Start a project",
      ctaHref: "/contact",
      layout: "editorial",
    },
  };

  const cta = {
    type: "cta",
    content: {
      heading: "Tell us what you are trying to move.",
      body: "Replace this with your own closing line. The button goes wherever you point it.",
      ctaLabel: "Get in touch",
      ctaHref: "/contact",
      size: "large",
    },
  };

  // The same bands the migration adds to an existing homepage — same types,
  // same modes, same limits — so a fresh install and a migrated one are the
  // same page. Only the wording differs, and it has to: the migration carries
  // the copy the old homepage was actually written with, and a heading like
  // "Six disciplines, run as one programme" is a claim about a business this
  // install knows nothing about (CLAUDE.md 2 rule 5).
  const bands = BANDS.map((band) => {
    const wording = STARTER_WORDING[band.type];
    return wording ? { ...band, content: { ...band.content, ...wording } } : band;
  });

  return [hero, ...bands, cta];
}

export async function ensureHomepage(prisma: PrismaClient): Promise<string> {
  // Deliberately unfiltered by `deletedAt`: a soft-deleted homepage still holds
  // the slug, and recreating one would both collide on the unique index and
  // undo somebody's decision.
  const existing = await prisma.page.findFirst({
    where: { slug: "home" },
    select: { id: true },
  });
  if (existing) return "homepage: already exists.";

  const settings = await prisma.siteSetting.findMany({
    where: { key: { in: ["site.name", "site.tagline"] } },
    select: { key: true, value: true },
  });
  const text = (key: string) => {
    const value = settings.find((row) => row.key === key)?.value;
    return typeof value === "string" ? value : "";
  };

  const sections = starterSections(text("site.name") || "Emporia", text("site.tagline"));

  await prisma.page.create({
    data: {
      slug: "home",
      title: "Home",
      internalName: "Home",
      description:
        "Created automatically on first deploy so / has something to serve. Edit or replace everything here.",
      // Published on purpose: a draft would leave the front page 404ing, which
      // is the problem this exists to solve.
      status: "PUBLISHED",
      publishedAt: new Date(),
      sections: {
        create: sections.map((section, index) => ({
          type: section.type,
          order: (index + 1) * 10,
          content: section.content as InputJsonValue,
        })),
      },
    },
  });

  return `homepage: created with ${sections.length} sections — edit it in Admin → Website → Pages.`;
}
