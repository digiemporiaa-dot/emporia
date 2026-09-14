import "server-only";
import { readVisitorContext } from "@/lib/attribution/server";
import { forVisitor } from "@/lib/content/queries";
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
  // Nothing on this page is targeted, so nothing about the visitor matters.
  // Skipping the read keeps such a page as static as it was before.
  if (Object.keys(page.audiences).length === 0) return page.sections;

  const context = await readVisitorContext();
  return forVisitor(page, visitorFrom(context));
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
