import "server-only";
import { readVisitorContext } from "@/lib/attribution/server";
import { forVisitor } from "@/lib/content/queries";
import { assign } from "@/lib/experiments/assign";
import { runningExperimentsFor } from "@/lib/services/experiment.service";
import type { AudienceVisitor } from "@/lib/content/audience";
import type { ParsedSection } from "@/lib/content/sections";
import type { PublishedPage } from "@/lib/content/queries";

/**
 * The bands this visitor should see.
 *
 * One function rather than six copies of "read the visitor, then filter". Every
 * public page render goes through it, including the ones with no personalised
 * bands — a page with no rules returns its sections unchanged, so the cost of
 * routing everything through here is nothing, and the cost of *not* doing so is
 * a page that quietly ignores its own targeting.
 *
 * Reading the visitor makes the render dynamic for that request. The page's
 * content is still cached by slug; only the choice of which bands to keep is
 * per-visitor, which is the split that lets personalisation exist without a
 * cache serving one visitor's variant to everybody.
 */
export async function visibleSections(page: PublishedPage): Promise<ParsedSection[]> {
  const targeted = Object.keys(page.audiences).length > 0;
  const inTest = Object.keys(page.variants).length > 0;

  // Nothing on this page varies, so nothing about the visitor matters. Skipping
  // the read keeps such a page as static as it was before either feature.
  if (!targeted && !inTest) return page.sections;

  const context = await readVisitorContext();
  const sections = targeted ? forVisitor(page, visitorFrom(context)) : [...page.sections];

  if (!inTest) return sections;
  return experimentSections(page, sections, context.visitorId);
}

/**
 * Drop the bands belonging to an arm this visitor is not in.
 *
 * Assignment is derived, not looked up, so this costs one query for the running
 * experiments and no write. The exposure — the thing that *is* written — is
 * recorded by a client beacon after the page has rendered, so counting a sample
 * never sits on the critical path of serving one.
 *
 * A visitor with no id yet (a first request, before the cookie is set) is shown
 * the page without its variant bands rather than assigned arbitrarily. Assigning
 * them would mean a different arm on their next request, which is the one thing
 * deterministic assignment exists to prevent.
 */
async function experimentSections(
  page: PublishedPage,
  sections: readonly ParsedSection[],
  visitorId: string,
): Promise<ParsedSection[]> {
  const variantIds = [...new Set(Object.values(page.variants))];
  const running = await runningExperimentsFor(variantIds);

  // An arm whose experiment is not running is not part of the page at all: a
  // draft or stopped test must not leak its variant onto the live site.
  const live = new Set(running.keys());

  if (!visitorId) {
    return sections.filter((section) => !page.variants[section.id]);
  }

  const chosen = new Map<string, string | null>();
  for (const [variantId, experiment] of running) {
    if (chosen.has(experiment.experimentId)) continue;
    const pick = assign(visitorId, experiment.experimentKey, experiment.variants);
    chosen.set(experiment.experimentId, pick?.id ?? null);
    void variantId;
  }

  return sections.filter((section) => {
    const variantId = page.variants[section.id];
    if (!variantId) return true;
    if (!live.has(variantId)) return false;

    const experiment = running.get(variantId);
    if (!experiment) return false;
    return chosen.get(experiment.experimentId) === variantId;
  });
}

/**
 * Which arm this visitor is in, for the bands on this page.
 *
 * Returned to the client so it can report the exposure. Only the arm the
 * visitor is actually in is sent — the others, and their targeting, stay on the
 * server.
 */
export async function assignedArms(
  page: PublishedPage,
  visitorId: string,
): Promise<{ experimentId: string; variantId: string }[]> {
  if (!visitorId || Object.keys(page.variants).length === 0) return [];

  const running = await runningExperimentsFor([...new Set(Object.values(page.variants))]);
  const seen = new Set<string>();
  const arms: { experimentId: string; variantId: string }[] = [];

  for (const experiment of running.values()) {
    if (seen.has(experiment.experimentId)) continue;
    seen.add(experiment.experimentId);
    const pick = assign(visitorId, experiment.experimentKey, experiment.variants);
    if (pick) arms.push({ experimentId: experiment.experimentId, variantId: pick.id });
  }

  return arms;
}

/** The attribution context, reduced to what an audience rule may look at. */
export function visitorFrom(context: {
  device: "DESKTOP" | "TABLET" | "MOBILE";
  isNewVisitor: boolean;
  referrer: string | null;
  lastTouch: { source?: string; medium?: string; campaign?: string } | null;
}): AudienceVisitor {
  return {
    device: context.device,
    isNewVisitor: context.isNewVisitor,
    // Last touch, not first: "show this to people arriving from today's ad" is
    // about how they got here now, not how they first found the site.
    utmSource: context.lastTouch?.source ?? null,
    utmMedium: context.lastTouch?.medium ?? null,
    utmCampaign: context.lastTouch?.campaign ?? null,
    referrer: context.referrer,
  };
}
