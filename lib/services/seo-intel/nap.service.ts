import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { napReport, type NapSubject, type NapTruth } from "@/lib/seo-intel/engine/nap";
import type { BusinessEntity } from "@/lib/seo-intel/crawler/parse";
import type { Actor } from "@/lib/actor/types";

/**
 * Name, address and phone checks (Phase 8). The client's business profile
 * (onboarding) is the truth; the latest crawl's structured data and phone
 * links, and each synced Google listing, are compared with it.
 */

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

type ListingAddress = { lines?: string[]; locality?: string | null; postalCode?: string | null };

/** The analysis, without an actor: callers scope the website. */
export async function computeNap(propertyId: string) {
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: {
      id: true,
      clientId: true,
      client: {
        select: {
          name: true,
          businessProfile: { select: { legalName: true, addressLine1: true, addressLine2: true, city: true, region: true, postalCode: true, countryCode: true, publicPhone: true } },
        },
      },
    },
  });
  if (!property) throw new NotFoundError("That website was not found.");
  const profile = property.client.businessProfile;
  const street = [profile?.addressLine1, profile?.addressLine2].filter((line): line is string => !!line?.trim()).join(", ") || null;
  const truth: NapTruth = {
    names: [property.client.name, profile?.legalName].filter((name): name is string => !!name?.trim()),
    street,
    locality: profile?.city?.trim() || null,
    region: profile?.region?.trim() || null,
    postalCode: profile?.postalCode?.trim() || null,
    country: profile?.countryCode ?? null,
    phone: profile?.publicPhone?.trim() || null,
  };
  // Without an address or a phone there is nothing to hold anything to.
  const profileReady = !!(truth.street || truth.locality || truth.postalCode || truth.phone);

  const [run, accounts] = await Promise.all([
    db.crawlRun.findFirst({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { id: true, finishedAt: true } }),
    db.socialAccount.findMany({
      where: { clientId: property.clientId, provider: "GOOGLE_BUSINESS_PROFILE", status: "CONNECTED", gbpListing: { lastSyncedAt: { not: null } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, gbpListing: { select: { title: true, phone: true, address: true, lastSyncedAt: true } } },
    }),
  ]);

  const pages = run
    ? await db.crawlPage.findMany({
        where: { runId: run.id, state: "FETCHED", statusCode: 200, OR: [{ localBusiness: { not: Prisma.DbNull } }, { phones: { isEmpty: false } }] },
        select: { url: true, localBusiness: true, phones: true },
      })
    : [];
  const listings = accounts.map((account) => {
    const address = (account.gbpListing?.address ?? null) as ListingAddress | null;
    const subject: NapSubject = {
      name: account.gbpListing?.title ?? null,
      phone: account.gbpListing?.phone ?? null,
      street: address?.lines?.length ? address.lines.join(", ") : null,
      locality: address?.locality ?? null,
      postalCode: address?.postalCode ?? null,
    };
    return { id: account.id, name: account.name, subject, syncedAt: account.gbpListing?.lastSyncedAt ?? null };
  });

  // Without a crawl the site half of the report is empty; callers check `run`.
  const report =
    profileReady
      ? napReport(
          truth,
          pages.map((page) => ({ url: page.url, phones: page.phones, localBusiness: Array.isArray(page.localBusiness) ? (page.localBusiness as BusinessEntity[]) : [] })),
          listings.map((listing) => ({ name: listing.name, subject: listing.subject })),
        )
      : null;

  return { truth, profileReady, run, report, listings };
}

export async function napOverview(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  return computeNap(propertyId);
}
