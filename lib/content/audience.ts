/**
 * Who a section is for.
 *
 * Pure functions, deliberately shaped like `lib/popups/targeting.ts`: given a
 * band's rules and the visitor in front of it, decide whether it belongs on
 * this render. Resolution happens on the server and the response carries only
 * the bands the visitor should see — a design where the client hid them would
 * ship every variant, and its targeting, to anyone reading the network tab
 * (CLAUDE.md 10).
 *
 * ## What is deliberately absent
 *
 * There is no visitor city and no country. This application has no geo-IP and
 * adding one is a third-party dependency and a credential, not a line of code;
 * a "visitor in Gurgaon" rule that guessed would be a fabricated audience
 * (CLAUDE.md 5). The attributes below are the ones already captured for
 * attribution and therefore genuinely known.
 *
 * Nothing here reads a sensitive attribute, and none is available to read.
 */

export type VisitorType = "NEW" | "RETURNING" | "ANY";
export type DeviceType = "DESKTOP" | "TABLET" | "MOBILE" | "ANY";

export type AudienceRule = {
  visitorType: VisitorType;
  device: DeviceType;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerContains: string | null;
};

/** What the server knows about whoever is asking for the page. */
export type AudienceVisitor = {
  device: "DESKTOP" | "TABLET" | "MOBILE";
  isNewVisitor: boolean;
  /** From the visitor's last touch, where one was captured. */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
};

/** Case- and whitespace-insensitive, because a UTM is typed by a person. */
function sameTag(rule: string | null, actual: string | null): boolean {
  if (rule === null || rule.trim() === "") return true;
  if (actual === null) return false;
  return rule.trim().toLowerCase() === actual.trim().toLowerCase();
}

function referrerMatches(rule: string | null, referrer: string | null): boolean {
  if (rule === null || rule.trim() === "") return true;
  if (!referrer) return false;
  return referrer.toLowerCase().includes(rule.trim().toLowerCase());
}

function deviceMatches(rule: DeviceType, device: AudienceVisitor["device"]): boolean {
  return rule === "ANY" || rule === device;
}

function visitorMatches(rule: VisitorType, isNew: boolean): boolean {
  if (rule === "ANY") return true;
  return rule === "NEW" ? isNew : !isNew;
}

/** Every field of one rule must match. An unset field matches anything. */
export function ruleMatches(rule: AudienceRule, visitor: AudienceVisitor): boolean {
  return (
    deviceMatches(rule.device, visitor.device) &&
    visitorMatches(rule.visitorType, visitor.isNewVisitor) &&
    sameTag(rule.utmSource, visitor.utmSource) &&
    sameTag(rule.utmMedium, visitor.utmMedium) &&
    sameTag(rule.utmCampaign, visitor.utmCampaign) &&
    referrerMatches(rule.referrerContains, visitor.referrer)
  );
}

/**
 * Should this band be rendered for this visitor?
 *
 * **No rules means everyone.** A section nobody has named an audience for is an
 * ordinary section, not a hidden one — the opposite of a popup, where no
 * targets means never shown. Getting that backwards would make every existing
 * page disappear the day the feature shipped.
 *
 * Several rules are OR-ed: "paid traffic *or* returning visitors".
 */
export function audienceAllows(
  rules: readonly AudienceRule[],
  visitor: AudienceVisitor,
): boolean {
  if (rules.length === 0) return true;
  return rules.some((rule) => ruleMatches(rule, visitor));
}

/** A one-line description of a rule, for the builder and the preview banner. */
export function describeRule(rule: AudienceRule): string {
  const parts: string[] = [];
  if (rule.visitorType !== "ANY") {
    parts.push(rule.visitorType === "NEW" ? "first-time visitors" : "returning visitors");
  }
  if (rule.device !== "ANY") parts.push(`on ${rule.device.toLowerCase()}`);
  if (rule.utmSource) parts.push(`from ${rule.utmSource}`);
  if (rule.utmMedium) parts.push(`via ${rule.utmMedium}`);
  if (rule.utmCampaign) parts.push(`in ${rule.utmCampaign}`);
  if (rule.referrerContains) parts.push(`referred by ${rule.referrerContains}`);
  return parts.length === 0 ? "Everyone" : parts.join(", ");
}
