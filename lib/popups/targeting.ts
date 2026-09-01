/**
 * Popup targeting and frequency.
 *
 * Pure functions: given the candidate popups, the page context and the
 * visitor's state, decide which single popup should be shown.
 *
 * Resolution happens on the server and the response carries at most one popup
 * (CLAUDE.md 10). A design where the client filtered a list would leak every
 * campaign, its targeting and its schedule to anyone reading the network tab.
 */

export type TargetType = "GLOBAL" | "PAGE" | "SERVICE" | "CITY" | "SERVICE_CITY" | "PACKAGE";
export type VisitorType = "NEW" | "RETURNING" | "ANY";
export type DeviceType = "DESKTOP" | "TABLET" | "MOBILE" | "ANY";
export type Frequency =
  | "EVERY_VISIT"
  | "ONCE_PER_SESSION"
  | "ONCE_PER_DAY"
  | "ONCE_PER_WEEK"
  | "ONCE_PER_USER";

export type PopupTargetRule = {
  type: TargetType;
  path: string | null;
  serviceId: string | null;
  cityId: string | null;
  serviceCityPageId: string | null;
  packageId: string | null;
  visitorType: VisitorType;
  device: DeviceType;
};

export type PopupCandidate = {
  id: string;
  priority: number;
  frequency: Frequency;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  updatedAt: Date;
  targets: PopupTargetRule[];
};

export type PageContext = {
  path: string;
  serviceId: string | null;
  cityId: string | null;
  serviceCityPageId: string | null;
  packageId: string | null;
};

export type VisitorState = {
  device: "DESKTOP" | "TABLET" | "MOBILE";
  isNewVisitor: boolean;
  /** popupId -> epoch ms it was last shown. */
  seen: Record<string, number>;
  /** popupIds already shown in this browser session. */
  seenThisSession: readonly string[];
  now: Date;
};

function normalisePath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? path;
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Path matching. Supports an exact path and a single trailing wildcard, which
 * is enough for "/services/*" without inviting a regex an admin can get wrong.
 */
export function pathMatches(rule: string, path: string): boolean {
  const target = normalisePath(rule);
  const actual = normalisePath(path);

  if (target === actual) return true;
  if (target.endsWith("/*")) {
    const prefix = target.slice(0, -2);
    return actual === prefix || actual.startsWith(`${prefix}/`);
  }
  return false;
}

function deviceMatches(rule: DeviceType, device: VisitorState["device"]): boolean {
  return rule === "ANY" || rule === device;
}

function visitorMatches(rule: VisitorType, isNew: boolean): boolean {
  if (rule === "ANY") return true;
  return rule === "NEW" ? isNew : !isNew;
}

/** Does one target rule match this page and visitor? */
export function targetMatches(
  rule: PopupTargetRule,
  page: PageContext,
  visitor: VisitorState,
): boolean {
  if (!deviceMatches(rule.device, visitor.device)) return false;
  if (!visitorMatches(rule.visitorType, visitor.isNewVisitor)) return false;

  switch (rule.type) {
    case "GLOBAL":
      return true;
    case "PAGE":
      return rule.path ? pathMatches(rule.path, page.path) : false;
    case "SERVICE":
      return Boolean(rule.serviceId) && rule.serviceId === page.serviceId;
    case "CITY":
      return Boolean(rule.cityId) && rule.cityId === page.cityId;
    case "SERVICE_CITY":
      // Either an explicit local page, or the service and city pair matching.
      if (rule.serviceCityPageId) return rule.serviceCityPageId === page.serviceCityPageId;
      return (
        Boolean(rule.serviceId) &&
        Boolean(rule.cityId) &&
        rule.serviceId === page.serviceId &&
        rule.cityId === page.cityId
      );
    case "PACKAGE":
      return Boolean(rule.packageId) && rule.packageId === page.packageId;
    default:
      return false;
  }
}

export function isScheduled(popup: PopupCandidate, now: Date): boolean {
  if (!popup.isActive) return false;
  if (popup.startsAt && popup.startsAt > now) return false;
  if (popup.endsAt && popup.endsAt < now) return false;
  return true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Has this visitor's frequency cap been spent for this popup? */
export function frequencyAllows(popup: PopupCandidate, visitor: VisitorState): boolean {
  const lastSeen = visitor.seen[popup.id];

  switch (popup.frequency) {
    case "EVERY_VISIT":
      return true;
    case "ONCE_PER_SESSION":
      return !visitor.seenThisSession.includes(popup.id);
    case "ONCE_PER_DAY":
      return lastSeen === undefined || visitor.now.getTime() - lastSeen >= DAY_MS;
    case "ONCE_PER_WEEK":
      return lastSeen === undefined || visitor.now.getTime() - lastSeen >= 7 * DAY_MS;
    case "ONCE_PER_USER":
      return lastSeen === undefined;
    default:
      return false;
  }
}

/**
 * Select the single popup to show, or null.
 *
 * A popup with no targets never fires — an untargeted popup is almost always a
 * half-finished one, and firing it everywhere is the wrong failure mode.
 * Ties break on priority, then on most recently updated.
 */
export function selectPopup(
  candidates: readonly PopupCandidate[],
  page: PageContext,
  visitor: VisitorState,
): PopupCandidate | null {
  const eligible = candidates.filter((popup) => {
    if (!isScheduled(popup, visitor.now)) return false;
    if (popup.targets.length === 0) return false;
    if (!popup.targets.some((rule) => targetMatches(rule, page, visitor))) return false;
    return frequencyAllows(popup, visitor);
  });

  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0] as PopupCandidate;
}
