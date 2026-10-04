import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { notify } from "@/lib/services/notification.service";
import { confirmUpload, presignUpload } from "@/lib/services/media.service";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { log } from "@/lib/logger";
import { onboardingProgress, type OnboardingFacts, type OnboardingStepKey } from "@/lib/onboarding/steps";
import {
  chooseGscSiteFor,
  completeGscOAuthFor,
  gscAuthorizationUrlFor,
  listGscSitesFor,
  type SiteOption,
} from "@/lib/services/seo-intel/gsc-connection.service";
import { googleServiceAccount } from "@/lib/seo-intel/google/settings";
import { parseSiteInput } from "@/lib/seo-intel/net/site-input";
import {
  hoursSchema,
  socialStepSchema,
  WEEKDAYS,
  type BusinessStepInput,
  type CompanyStepInput,
  type OpeningHours,
  type SocialProfileEntry,
  type WebsiteStepInput,
} from "@/lib/validation/onboarding";
import type { Actor, PortalActor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Client onboarding (docs/CLIENT-ONBOARDING-PLAN.md).
 *
 * Two audiences, one rule each:
 *
 * - **The portal** acts only on the signed-in user's own client. Every
 *   function taking a `PortalActor` scopes by `actor.clientId` and nothing
 *   else — no client id is ever read from the caller.
 * - **Staff** read any client's onboarding with `clients.view` and may only
 *   mark steps not applicable (`clients.edit`); the data itself is the
 *   client's to give.
 *
 * Completion is derived from the data (lib/onboarding/steps.ts). No password
 * is ever collected: website access is the client adding the agency as a user.
 */

const onboardingLog = log("onboarding");

export const ACCESS_EMAIL_SETTING = "onboarding.accessEmail";
const MAX_BRAND_ASSETS = 20;

function portalOnly(actor: PortalActor): string {
  if (actor.type !== "CLIENT" || !actor.clientId) throw new ForbiddenError("Only a client's own users can do this.");
  return actor.clientId;
}

async function ensureOnboarding(clientId: string) {
  return db.clientOnboarding.upsert({ where: { clientId }, create: { clientId }, update: {} });
}

function socialProfiles(value: Prisma.JsonValue): SocialProfileEntry[] {
  const parsed = socialStepSchema.safeParse({ profiles: value });
  return parsed.success ? parsed.data.profiles : [];
}

function openingHours(value: Prisma.JsonValue | null): OpeningHours | null {
  const parsed = hoursSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Everything the step rules look at, for one client. */
async function factsFor(clientId: string): Promise<OnboardingFacts> {
  const [client, profile, onboarding, logos, brand, gsc, accounts] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { industry: true, website: true } }),
    db.clientBusinessProfile.findUnique({ where: { clientId } }),
    db.clientOnboarding.findUnique({ where: { clientId } }),
    db.clientBrandAsset.count({ where: { clientId, kind: "LOGO", media: { deletedAt: null } } }),
    db.socialBrandProfile.findUnique({ where: { clientId }, select: { brandColors: true } }),
    db.seoConnection.count({ where: { source: "SEARCH_CONSOLE", status: "CONNECTED", property: { clientId, isActive: true } } }),
    db.socialAccount.findMany({ where: { clientId, status: "CONNECTED" }, select: { provider: true } }),
  ]);
  const hours = openingHours(profile?.hours ?? null);
  return {
    company: {
      legalName: profile?.legalName ?? null,
      industry: client.industry,
      website: client.website,
      addressLine1: profile?.addressLine1 ?? null,
      city: profile?.city ?? null,
      countryCode: profile?.countryCode ?? null,
    },
    brand: { logos, colors: brand?.brandColors.length ?? 0 },
    website: { platform: onboarding?.websitePlatform ?? null, confirmed: Boolean(onboarding?.websiteAccessConfirmedAt) },
    analytics: { propertyId: onboarding?.ga4PropertyId ?? null, confirmed: Boolean(onboarding?.ga4AccessConfirmedAt) },
    searchConsoleConnected: gsc > 0,
    social: {
      listedPlatforms: socialProfiles(onboarding?.socialProfiles ?? []).map((entry) => entry.platform),
      connectedPlatforms: accounts.map((account) => account.provider),
    },
    business: {
      publicPhone: profile?.publicPhone ?? null,
      addressLine1: profile?.addressLine1 ?? null,
      openDays: hours ? WEEKDAYS.filter((day) => hours[day].length > 0).length : 0,
    },
    notApplicable: (onboarding?.notApplicable ?? []) as OnboardingStepKey[],
  };
}

/**
 * Re-derive completion after any change. The first time every applicable step
 * is done, it is stamped and the account owner is told — once.
 */
async function refreshCompletion(clientId: string, actor: Actor | PortalActor) {
  const progress = onboardingProgress(await factsFor(clientId));
  if (!progress.complete) return progress;
  const stamped = await db.clientOnboarding.updateMany({ where: { clientId, completedAt: null }, data: { completedAt: new Date() } });
  if (stamped.count === 1) {
    const client = await db.client.findUnique({ where: { id: clientId }, select: { name: true, ownerId: true } });
    await record({ actor: actor as Actor, action: "STATUS_CHANGE", entityType: "ClientOnboarding", entityId: clientId, after: { completed: true } });
    if (client?.ownerId) {
      await notify({
        userId: client.ownerId,
        title: `${client.name} finished setting up their account`,
        body: "Every onboarding step is complete.",
        href: `/admin/clients/${clientId}/onboarding`,
        entity: { type: "Client", id: clientId },
      }).catch((error: unknown) => onboardingLog.warn({ err: error, clientId }, "onboarding completion notice failed"));
    }
  }
  return progress;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const EMPTY_ONBOARDING = {
  websitePlatform: null,
  websiteLoginUrl: null,
  websiteNotes: null,
  websiteAccessConfirmedAt: null,
  ga4PropertyId: null,
  ga4AccessConfirmedAt: null,
  socialProfiles: [] as Prisma.JsonValue,
  notApplicable: [] as string[],
  completedAt: null,
};

export type OnboardingView = Awaited<ReturnType<typeof viewFor>>;

async function viewFor(clientId: string) {
  const [client, profile, onboarding, assets, brand, properties, accounts, accessEmail, serviceAccount] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, industry: true, website: true, logo: { select: { url: true } } } }),
    db.clientBusinessProfile.findUnique({ where: { clientId } }),
    // Read-only: a page view never creates the row; the first save does.
    db.clientOnboarding.findUnique({ where: { clientId } }).then((row) => row ?? EMPTY_ONBOARDING),
    db.clientBrandAsset.findMany({
      where: { clientId, media: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, createdAt: true, media: { select: { url: true, filename: true, mimeType: true, size: true } } },
    }),
    db.socialBrandProfile.findUnique({ where: { clientId }, select: { brandColors: true } }),
    db.seoProperty.findMany({
      where: { clientId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, domain: true, displayName: true, gscSiteUrl: true, connections: { where: { source: "SEARCH_CONSOLE" }, select: { status: true, method: true, accountEmail: true } } },
    }),
    db.socialAccount.findMany({ where: { clientId, status: "CONNECTED" }, select: { provider: true, name: true, username: true } }),
    db.siteSetting.findUnique({ where: { key: ACCESS_EMAIL_SETTING }, select: { value: true } }),
    googleServiceAccount().catch(() => null),
  ]);
  const progress = onboardingProgress(await factsFor(clientId));
  return {
    client,
    progress,
    profile: {
      legalName: profile?.legalName ?? null,
      taxId: profile?.taxId ?? null,
      addressLine1: profile?.addressLine1 ?? null,
      addressLine2: profile?.addressLine2 ?? null,
      city: profile?.city ?? null,
      region: profile?.region ?? null,
      postalCode: profile?.postalCode ?? null,
      countryCode: profile?.countryCode ?? null,
      publicPhone: profile?.publicPhone ?? null,
      publicEmail: profile?.publicEmail ?? null,
      hours: openingHours(profile?.hours ?? null),
      serviceAreas: profile?.serviceAreas ?? [],
      googleBusinessUrl: profile?.googleBusinessUrl ?? null,
    },
    brandColors: brand?.brandColors ?? [],
    assets,
    website: {
      platform: onboarding.websitePlatform,
      loginUrl: onboarding.websiteLoginUrl,
      notes: onboarding.websiteNotes,
      confirmedAt: onboarding.websiteAccessConfirmedAt,
    },
    analytics: { propertyId: onboarding.ga4PropertyId, confirmedAt: onboarding.ga4AccessConfirmedAt },
    socialProfiles: socialProfiles(onboarding.socialProfiles),
    connectedSocial: accounts,
    searchConsole: properties.map((property) => ({
      id: property.id,
      domain: property.domain,
      displayName: property.displayName,
      siteUrl: property.gscSiteUrl,
      status: property.connections[0]?.status ?? null,
      accountEmail: property.connections[0]?.accountEmail ?? null,
    })),
    accessEmail: typeof accessEmail?.value === "string" && accessEmail.value ? accessEmail.value : null,
    serviceAccountEmail: serviceAccount?.email ?? null,
    notApplicable: onboarding.notApplicable as OnboardingStepKey[],
    completedAt: onboarding.completedAt,
  };
}

export async function getMyOnboarding(actor: PortalActor) {
  return viewFor(portalOnly(actor));
}

/** For the portal home card: just the numbers. */
export async function myOnboardingProgress(actor: PortalActor) {
  return onboardingProgress(await factsFor(portalOnly(actor)));
}

export async function getClientOnboarding(actor: Actor, clientId: string) {
  requirePermission(actor, "clients.view");
  const client = await db.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true } });
  if (!client) throw new NotFoundError("That client does not exist.");
  return viewFor(clientId);
}

// ---------------------------------------------------------------------------
// The client's steps
// ---------------------------------------------------------------------------

export async function saveCompanyStep(actor: PortalActor, input: CompanyStepInput) {
  const clientId = portalOnly(actor);
  await db.$transaction(async (tx) => {
    const before = await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { industry: true, website: true } });
    await tx.client.update({ where: { id: clientId }, data: { industry: input.industry, website: input.website } });
    const profile = {
      legalName: input.legalName,
      taxId: input.taxId,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      countryCode: input.countryCode,
      updatedById: actor.userId,
    };
    await tx.clientBusinessProfile.upsert({ where: { clientId }, create: { clientId, ...profile }, update: profile });
    await record({ actor: actor as Actor, action: "UPDATE", entityType: "Client", entityId: clientId, before, after: { industry: input.industry, website: input.website, onboarding: "company" } }, tx);
  });
  return refreshCompletion(clientId, actor);
}

export async function saveBrandColors(actor: PortalActor, colors: string[]) {
  const clientId = portalOnly(actor);
  await db.socialBrandProfile.upsert({
    where: { clientId },
    create: { clientId, brandColors: colors, updatedById: actor.userId },
    update: { brandColors: colors, updatedById: actor.userId },
  });
  await record({ actor: actor as Actor, action: "UPDATE", entityType: "Client", entityId: clientId, after: { brandColors: colors } });
  return refreshCompletion(clientId, actor);
}

async function uploadLimit(actor: PortalActor) {
  const result = await checkRateLimit(`brand-upload:${actor.userId}`, { limit: 20, windowMs: 10 * 60_000 });
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds, "Too many uploads. Try again in a few minutes.");
}

/** Start a brand upload: the verified media path, with the types narrowed to images and PDFs. */
export async function presignBrandAsset(actor: PortalActor, input: { filename: string; contentType: string; size: number }) {
  const clientId = portalOnly(actor);
  await uploadLimit(actor);
  const count = await db.clientBrandAsset.count({ where: { clientId, media: { deletedAt: null } } });
  if (count >= MAX_BRAND_ASSETS) throw new ValidationError(`Up to ${MAX_BRAND_ASSETS} brand files. Remove one first.`);
  return presignUpload(actor as Actor, { filename: input.filename, contentType: input.contentType, size: input.size });
}

/** Finish a brand upload: the bytes are checked by `confirmUpload`, then filed under this client. */
export async function confirmBrandAsset(actor: PortalActor, uploadId: string, kind: "LOGO" | "GUIDELINES" | "OTHER") {
  const clientId = portalOnly(actor);
  const media = await confirmUpload(actor as Actor, uploadId);
  await db.$transaction(async (tx) => {
    await tx.clientBrandAsset.create({ data: { clientId, mediaId: media.id, kind, uploadedById: actor.userId } });
    // The first logo becomes the client's logo; staff can change it later.
    if (kind === "LOGO" && media.type === "IMAGE") {
      await tx.client.updateMany({ where: { id: clientId, logoId: null }, data: { logoId: media.id } });
    }
    await record({ actor: actor as Actor, action: "CREATE", entityType: "ClientBrandAsset", entityId: media.id, after: { clientId, kind, filename: media.filename } }, tx);
  });
  return refreshCompletion(clientId, actor);
}

export async function removeBrandAsset(actor: PortalActor, assetId: string) {
  const clientId = portalOnly(actor);
  // Scoped by client: another client's asset id is simply not found.
  const asset = await db.clientBrandAsset.findFirst({ where: { id: assetId, clientId }, select: { id: true, mediaId: true } });
  if (!asset) throw new NotFoundError("That file does not exist.");
  await db.$transaction(async (tx) => {
    await tx.client.updateMany({ where: { id: clientId, logoId: asset.mediaId }, data: { logoId: null } });
    await tx.clientBrandAsset.delete({ where: { id: asset.id } });
    await tx.media.update({ where: { id: asset.mediaId }, data: { deletedAt: new Date() } });
    await record({ actor: actor as Actor, action: "DELETE", entityType: "ClientBrandAsset", entityId: asset.mediaId, before: { clientId } }, tx);
  });
  return refreshCompletion(clientId, actor);
}

export async function saveWebsiteStep(actor: PortalActor, input: WebsiteStepInput) {
  const clientId = portalOnly(actor);
  const current = await ensureOnboarding(clientId);
  await db.clientOnboarding.update({
    where: { clientId },
    data: {
      websitePlatform: input.platform,
      websiteLoginUrl: input.loginUrl,
      websiteNotes: input.notes,
      // Kept from the first confirmation; unticking clears it.
      websiteAccessConfirmedAt: input.confirmed ? (current.websiteAccessConfirmedAt ?? new Date()) : null,
    },
  });
  await record({ actor: actor as Actor, action: "UPDATE", entityType: "ClientOnboarding", entityId: clientId, after: { step: "WEBSITE", platform: input.platform, confirmed: input.confirmed } });
  return refreshCompletion(clientId, actor);
}

export async function saveAnalyticsStep(actor: PortalActor, input: { propertyId: string; confirmed: boolean }) {
  const clientId = portalOnly(actor);
  const current = await ensureOnboarding(clientId);
  await db.clientOnboarding.update({
    where: { clientId },
    data: { ga4PropertyId: input.propertyId, ga4AccessConfirmedAt: input.confirmed ? (current.ga4AccessConfirmedAt ?? new Date()) : null },
  });
  await record({ actor: actor as Actor, action: "UPDATE", entityType: "ClientOnboarding", entityId: clientId, after: { step: "ANALYTICS", propertyId: input.propertyId, confirmed: input.confirmed } });
  return refreshCompletion(clientId, actor);
}

export async function saveSocialProfiles(actor: PortalActor, profiles: SocialProfileEntry[]) {
  const clientId = portalOnly(actor);
  await ensureOnboarding(clientId);
  await db.clientOnboarding.update({ where: { clientId }, data: { socialProfiles: profiles } });
  await record({ actor: actor as Actor, action: "UPDATE", entityType: "ClientOnboarding", entityId: clientId, after: { step: "SOCIAL", profiles } });
  return refreshCompletion(clientId, actor);
}

export async function saveBusinessStep(actor: PortalActor, input: BusinessStepInput) {
  const clientId = portalOnly(actor);
  const data = {
    publicPhone: input.publicPhone,
    publicEmail: input.publicEmail,
    hours: input.hours,
    serviceAreas: input.serviceAreas,
    googleBusinessUrl: input.googleBusinessUrl,
    updatedById: actor.userId,
  };
  await db.clientBusinessProfile.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
  await record({ actor: actor as Actor, action: "UPDATE", entityType: "ClientOnboarding", entityId: clientId, after: { step: "BUSINESS" } });
  return refreshCompletion(clientId, actor);
}

// ---------------------------------------------------------------------------
// Search Console from the portal
// ---------------------------------------------------------------------------

/** The client's own property, or nothing — another client's id is not found. */
async function ownProperty(clientId: string, propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, clientId, client: { deletedAt: null } }, select: { id: true } });
  if (!property) throw new NotFoundError("That website does not exist.");
  return property.id;
}

/**
 * The website to connect: the client's first active SEO property, or — when
 * there is none yet — one made from the website they gave in Company details.
 */
export async function ensurePortalProperty(actor: PortalActor): Promise<string> {
  const clientId = portalOnly(actor);
  const existing = await db.seoProperty.findFirst({ where: { clientId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (existing) return existing.id;

  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, website: true } });
  if (!client.website) throw new ValidationError("Add your website in Company details first.");
  const site = parseSiteInput(client.website);
  const created = await db.seoProperty.upsert({
    where: { clientId_domain: { clientId, domain: site.domain } },
    create: { clientId, domain: site.domain, protocol: site.protocol ?? "HTTPS", displayName: client.name, createdById: actor.userId },
    update: { isActive: true },
    select: { id: true },
  });
  await record({ actor: actor as Actor, action: "CREATE", entityType: "SeoProperty", entityId: created.id, after: { clientId, domain: site.domain, via: "onboarding" } });
  return created.id;
}

export async function portalGscAuthorizationUrl(actor: PortalActor, propertyId: string, state: string): Promise<string> {
  return gscAuthorizationUrlFor(await ownProperty(portalOnly(actor), propertyId), state);
}

export async function portalCompleteGsc(actor: PortalActor, propertyId: string, code: string): Promise<void> {
  await completeGscOAuthFor(actor as Actor, await ownProperty(portalOnly(actor), propertyId), code);
}

export async function portalListGscSites(actor: PortalActor, propertyId: string): Promise<SiteOption[]> {
  return listGscSitesFor(await ownProperty(portalOnly(actor), propertyId));
}

export async function portalChooseGscSite(actor: PortalActor, propertyId: string, siteUrl: string) {
  const clientId = portalOnly(actor);
  await chooseGscSiteFor(actor as Actor, await ownProperty(clientId, propertyId), siteUrl);
  return refreshCompletion(clientId, actor);
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function setStepNotApplicable(actor: Actor, input: { clientId: string; step: OnboardingStepKey; notApplicable: boolean }) {
  requirePermission(actor, "clients.edit");
  if (actor.type === "CLIENT") throw new ForbiddenError("Only staff can change this.");
  const client = await db.client.findFirst({ where: { id: input.clientId, deletedAt: null }, select: { id: true } });
  if (!client) throw new NotFoundError("That client does not exist.");
  const current = await ensureOnboarding(input.clientId);
  const next = new Set(current.notApplicable as OnboardingStepKey[]);
  if (input.notApplicable) next.add(input.step);
  else next.delete(input.step);
  await db.clientOnboarding.update({ where: { clientId: input.clientId }, data: { notApplicable: [...next] } });
  await record({ actor, action: "UPDATE", entityType: "ClientOnboarding", entityId: input.clientId, before: { notApplicable: current.notApplicable }, after: { notApplicable: [...next] } });
  return refreshCompletion(input.clientId, actor);
}

export async function getAccessEmail(actor: Actor): Promise<string | null> {
  requirePermission(actor, "settings.view");
  const row = await db.siteSetting.findUnique({ where: { key: ACCESS_EMAIL_SETTING }, select: { value: true } });
  return typeof row?.value === "string" && row.value ? row.value : null;
}

export async function setAccessEmail(actor: Actor, email: string | null): Promise<void> {
  requirePermission(actor, "settings.edit");
  await db.siteSetting.upsert({ where: { key: ACCESS_EMAIL_SETTING }, create: { key: ACCESS_EMAIL_SETTING, value: email ?? "" }, update: { value: email ?? "" } });
  await record({ actor, action: "UPDATE", entityType: "SiteSetting", entityId: ACCESS_EMAIL_SETTING, after: { email } });
}
