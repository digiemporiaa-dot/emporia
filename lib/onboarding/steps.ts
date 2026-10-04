/**
 * Client onboarding steps and when each is complete. Pure.
 *
 * Completion is derived from what is actually there — a logo uploaded, a
 * Search Console connected — never from a box someone ticked. Staff can mark a
 * step not applicable (a client with no social presence); that removes it from
 * the count, it does not mark it done.
 */

export const ONBOARDING_STEPS = ["COMPANY", "BRAND", "WEBSITE", "ANALYTICS", "SEARCH_CONSOLE", "SOCIAL", "BUSINESS"] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

export const STEP_LABEL: Record<OnboardingStepKey, string> = {
  COMPANY: "Company details",
  BRAND: "Brand assets",
  WEBSITE: "Website access",
  ANALYTICS: "Google Analytics",
  SEARCH_CONSOLE: "Search Console",
  SOCIAL: "Social accounts",
  BUSINESS: "Business information",
};

/** What each step needs, said to the client. */
export const STEP_NEEDS: Record<OnboardingStepKey, string> = {
  COMPANY: "Legal name, industry, website and registered address.",
  BRAND: "Your logo and at least one brand colour.",
  WEBSITE: "Add us as a user on your website, then confirm here.",
  ANALYTICS: "Your GA4 property ID, after giving us access.",
  SEARCH_CONSOLE: "Connect your website's Search Console.",
  SOCIAL: "List your social profiles; we connect them for you.",
  BUSINESS: "Public phone, address and opening hours.",
};

export type OnboardingFacts = {
  company: { legalName: string | null; industry: string | null; website: string | null; addressLine1: string | null; city: string | null; countryCode: string | null };
  brand: { logos: number; colors: number };
  website: { platform: string | null; confirmed: boolean };
  analytics: { propertyId: string | null; confirmed: boolean };
  searchConsoleConnected: boolean;
  social: { listedPlatforms: string[]; connectedPlatforms: string[] };
  business: { publicPhone: string | null; addressLine1: string | null; openDays: number };
  notApplicable: OnboardingStepKey[];
};

const filled = (value: string | null) => Boolean(value && value.trim());

export function stepComplete(step: OnboardingStepKey, facts: OnboardingFacts): boolean {
  switch (step) {
    case "COMPANY": {
      const c = facts.company;
      return [c.legalName, c.industry, c.website, c.addressLine1, c.city, c.countryCode].every(filled);
    }
    case "BRAND":
      return facts.brand.logos > 0 && facts.brand.colors > 0;
    case "WEBSITE":
      return filled(facts.website.platform) && facts.website.confirmed;
    case "ANALYTICS":
      return filled(facts.analytics.propertyId) && facts.analytics.confirmed;
    case "SEARCH_CONSOLE":
      return facts.searchConsoleConnected;
    case "SOCIAL": {
      const listed = new Set(facts.social.listedPlatforms);
      if (listed.size === 0) return false;
      const connected = new Set(facts.social.connectedPlatforms);
      return [...listed].every((platform) => connected.has(platform));
    }
    case "BUSINESS":
      return filled(facts.business.publicPhone) && filled(facts.business.addressLine1) && facts.business.openDays > 0;
  }
}

export type StepStatus = { step: OnboardingStepKey; label: string; state: "done" | "todo" | "not-applicable" };

export function onboardingProgress(facts: OnboardingFacts): { steps: StepStatus[]; done: number; applicable: number; percent: number; complete: boolean } {
  const steps = ONBOARDING_STEPS.map((step): StepStatus => ({
    step,
    label: STEP_LABEL[step],
    state: facts.notApplicable.includes(step) ? "not-applicable" : stepComplete(step, facts) ? "done" : "todo",
  }));
  const applicable = steps.filter((s) => s.state !== "not-applicable").length;
  const done = steps.filter((s) => s.state === "done").length;
  // Nothing applicable means there is nothing left to do.
  const percent = applicable === 0 ? 100 : Math.floor((done / applicable) * 100);
  return { steps, done, applicable, percent, complete: done === applicable };
}
