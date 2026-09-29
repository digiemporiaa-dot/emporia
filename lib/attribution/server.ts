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
import { utmValue } from "@/lib/social/utm";

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

  // Last touch wins, which is the convention for campaign attribution on a
  // single lead; the first touch is the fallback when the last named nothing.
  const touch = context.lastTouch?.campaign || context.lastTouch?.content ? context.lastTouch : context.firstTouch;
  const campaignId = touch ? await campaignForTouch(tx, touch) : null;

  return { firstTouchId, lastTouchId, campaignId };
}

/**
 * The campaign a touch's UTM tags point to, or null when they do not point to
 * exactly one.
 *
 * In order of certainty:
 *  1. `utm_content` naming one of our social posts — the tag the publisher
 *     stamps on every post — gives that post's campaign.
 *  2. `utm_campaign` equal to a campaign's name, ignoring case.
 *  3. `utm_campaign` equal to a campaign's name in the form the publisher
 *     writes it (`Diwali 2026` goes out as `diwali-2026`). Before this step a
 *     lead from a social link never matched its campaign at all.
 *
 * Steps 2 and 3 attribute only when exactly one campaign matches: two
 * clients' "Diwali 2026" is a guess, and a guess is not attribution.
 */
export async function campaignForTouch(tx: DbClient, touch: Pick<TouchData, "campaign" | "content">): Promise<string | null> {
  if (touch.content) {
    const post = await tx.socialPost.findFirst({
      where: { utmContent: touch.content.trim().toLowerCase() },
      select: { contentItem: { select: { campaignId: true } } },
    });
    if (post?.contentItem.campaignId) return post.contentItem.campaignId;
  }

  const name = touch.campaign?.trim();
  if (!name) return null;

  const exact = await tx.campaign.findMany({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null;

  const slug = utmValue(name);
  const tokens = slug.split("-").filter(Boolean);
  if (tokens.length === 0) return null;
  const candidates = await tx.campaign.findMany({
    where: { AND: tokens.map((token) => ({ name: { contains: token, mode: "insensitive" as const } })) },
    select: { id: true, name: true },
    take: 50,
  });
  const matches = candidates.filter((campaign) => utmValue(campaign.name) === slug);
  return matches.length === 1 ? matches[0]!.id : null;
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
