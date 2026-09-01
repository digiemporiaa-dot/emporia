import "server-only";
import { cookies, headers } from "next/headers";
import { db, type DbClient } from "@/lib/db";
import {
  COOKIE,
  decodeTouch,
  deviceFromUserAgent,
  type DeviceClass,
  type TouchData,
} from "@/lib/attribution/cookies";

/**
 * Server-side attribution.
 *
 * Reads the cookies middleware maintains and turns them into UTMTracking rows
 * at the moment a lead is captured — not on every page view, which would fill
 * the table with bot traffic.
 *
 * Nothing here trusts the request body.
 */

export type VisitorContext = {
  visitorId: string;
  sessionId: string | null;
  device: DeviceClass;
  userAgent: string | null;
  referrer: string | null;
  firstTouch: TouchData | null;
  lastTouch: TouchData | null;
  /** True when this visitor has no prior session cookie. */
  isNewVisitor: boolean;
};

export async function readVisitorContext(): Promise<VisitorContext> {
  const [jar, head] = await Promise.all([cookies(), headers()]);

  const visitorId = jar.get(COOKIE.visitorId)?.value ?? "";
  const sessionId = jar.get(COOKIE.session)?.value ?? null;
  const userAgent = head.get("user-agent");

  return {
    visitorId,
    sessionId,
    device: deviceFromUserAgent(userAgent),
    userAgent,
    referrer: head.get("referer"),
    firstTouch: decodeTouch(jar.get(COOKIE.firstTouch)?.value),
    lastTouch: decodeTouch(jar.get(COOKIE.lastTouch)?.value),
    // A visitor id that exists without a first touch is still returning if the
    // cookie predates this session; the session cookie is the reliable signal.
    isNewVisitor: !jar.get(COOKIE.firstTouch) && !jar.get(COOKIE.lastTouch),
  };
}

export type PersistedTouches = {
  firstTouchId: string | null;
  lastTouchId: string | null;
  campaignId: string | null;
};

/**
 * Persist first and last touch as UTMTracking rows.
 *
 * Runs inside the caller's transaction so attribution commits with the lead it
 * belongs to, never on its own.
 */
export async function persistTouches(
  tx: DbClient,
  context: VisitorContext,
  landingPath: string | null,
): Promise<PersistedTouches> {
  if (!context.visitorId) {
    return { firstTouchId: null, lastTouchId: null, campaignId: null };
  }

  const write = async (touch: TouchData | null, kind: "FIRST" | "LAST") => {
    if (!touch) return null;
    const row = await tx.uTMTracking.create({
      data: {
        visitorId: context.visitorId,
        source: touch.source ?? null,
        medium: touch.medium ?? null,
        campaign: touch.campaign ?? null,
        term: touch.term ?? null,
        content: touch.content ?? null,
        landingPath: touch.landingPath ?? landingPath,
        referrer: touch.referrer ?? context.referrer,
        device: context.device,
        touch: kind,
        occurredAt: new Date(touch.at),
      },
      select: { id: true },
    });
    return row.id;
  };

  const [firstTouchId, lastTouchId] = await Promise.all([
    write(context.firstTouch, "FIRST"),
    write(context.lastTouch, "LAST"),
  ]);

  // Match the campaign by name when the UTM names one we track. Last touch
  // wins, which is the convention for campaign attribution on a single lead.
  const campaignName = context.lastTouch?.campaign ?? context.firstTouch?.campaign ?? null;
  let campaignId: string | null = null;
  if (campaignName) {
    const campaign = await tx.campaign.findFirst({
      where: { name: { equals: campaignName, mode: "insensitive" } },
      select: { id: true },
    });
    campaignId = campaign?.id ?? null;
  }

  return { firstTouchId, lastTouchId, campaignId };
}

/** Resolve a public path to the service and city it represents, if any. */
export async function resolvePageContext(path: string): Promise<{
  serviceId: string | null;
  cityId: string | null;
  packageId: string | null;
  serviceCityPageId: string | null;
}> {
  const empty = { serviceId: null, cityId: null, packageId: null, serviceCityPageId: null };
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return empty;

  const [first, second, third] = segments;

  if (first === "services" && second) {
    if (third) {
      const page = await db.serviceCityPage.findFirst({
        where: { service: { slug: second }, city: { slug: third } },
        select: { id: true, serviceId: true, cityId: true },
      });
      if (page) {
        return {
          serviceId: page.serviceId,
          cityId: page.cityId,
          packageId: null,
          serviceCityPageId: page.id,
        };
      }
      return empty;
    }
    const service = await db.service.findUnique({ where: { slug: second }, select: { id: true } });
    return { ...empty, serviceId: service?.id ?? null };
  }

  if (first === "cities" && second) {
    const city = await db.city.findUnique({ where: { slug: second }, select: { id: true } });
    return { ...empty, cityId: city?.id ?? null };
  }

  if (first === "packages" && second) {
    const pkg = await db.servicePackage.findUnique({
      where: { slug: second },
      select: { id: true, serviceId: true },
    });
    return { ...empty, packageId: pkg?.id ?? null, serviceId: pkg?.serviceId ?? null };
  }

  return empty;
}
