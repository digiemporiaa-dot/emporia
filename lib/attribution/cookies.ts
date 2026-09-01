/**
 * Attribution cookie shapes.
 *
 * Edge-safe: no Prisma, no `server-only`, no Node APIs — middleware imports
 * this. Cookies are the transport; persistence happens in Node route handlers
 * (lib/attribution/server.ts).
 *
 * Everything here is httpOnly. Attribution is read server-side from these
 * cookies and never from a request body, so a caller cannot forge the source of
 * their own enquiry (docs/ARCHITECTURE.md 14.2).
 */

export const COOKIE = {
  visitorId: "em_vid",
  firstTouch: "em_ft",
  lastTouch: "em_lt",
  popupState: "em_pop",
  session: "em_ses",
} as const;

export const COOKIE_MAX_AGE = {
  visitorId: 60 * 60 * 24 * 730, // 2 years
  firstTouch: 60 * 60 * 24 * 730,
  lastTouch: 60 * 60 * 24 * 90,
  popupState: 60 * 60 * 24 * 365,
} as const;

export type TouchData = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  landingPath?: string;
  referrer?: string;
  /** Epoch milliseconds. */
  at: number;
};

const UTM_PARAMS = ["source", "medium", "campaign", "term", "content"] as const;

/** Extract UTM parameters from a URL's search params, if any are present. */
export function readUtm(searchParams: URLSearchParams): Partial<TouchData> | null {
  const data: Partial<TouchData> = {};
  let found = false;

  for (const key of UTM_PARAMS) {
    const value = searchParams.get(`utm_${key}`);
    if (value) {
      data[key] = value.slice(0, 200);
      found = true;
    }
  }

  // Common ad-platform click ids imply paid traffic even without utm_source.
  if (!found) {
    for (const [param, source] of [
      ["gclid", "google"],
      ["fbclid", "facebook"],
      ["msclkid", "bing"],
    ] as const) {
      if (searchParams.get(param)) {
        data.source = source;
        data.medium = "cpc";
        found = true;
        break;
      }
    }
  }

  return found ? data : null;
}

export function encodeTouch(touch: TouchData): string {
  return encodeURIComponent(JSON.stringify(touch));
}

export function decodeTouch(raw: string | undefined): TouchData | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    const touch = parsed as TouchData;
    return typeof touch.at === "number" ? touch : null;
  } catch {
    return null;
  }
}

/** popupId -> epoch ms of the last time it was shown to this visitor. */
export type PopupState = Record<string, number>;

export function decodePopupState(raw: string | undefined): PopupState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: PopupState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function encodePopupState(state: PopupState): string {
  return encodeURIComponent(JSON.stringify(state));
}

export type DeviceClass = "DESKTOP" | "TABLET" | "MOBILE";

/** Coarse device class from the User-Agent, derived server-side. */
export function deviceFromUserAgent(userAgent: string | null): DeviceClass {
  if (!userAgent) return "DESKTOP";
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(userAgent)) return "TABLET";
  if (/Mobi|Android|iPhone|iPod|Opera Mini|IEMobile/i.test(userAgent)) return "MOBILE";
  return "DESKTOP";
}
