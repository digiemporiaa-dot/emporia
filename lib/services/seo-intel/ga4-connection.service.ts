import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { encryptSecret } from "@/lib/security/secret";
import { googleAuthorizationUrl, googleExchangeCode } from "@/lib/social/google-oauth";
import { googleServiceAccount, seoGoogleCallbackUrl } from "@/lib/seo-intel/google/settings";
import { GA4_SCOPE, GoogleAnalytics, PROPERTY_ID, type AnalyticsProvider, type Ga4PropertySummary } from "@/lib/seo-intel/providers/ga4";
import { siteHosts } from "@/lib/seo-intel/crawler/url";
import { googleAccountEmail, revokeGrant, seoOAuthConfig, tokenSource } from "@/lib/services/seo-intel/google-credentials";
import type { Actor } from "@/lib/actor/types";
import type { SeoConnection } from "@/generated/prisma/client";

/**
 * Connecting a website to Google Analytics 4 (Phase 9; decision D3: OAuth or
 * the agency's service account), the same way Search Console connects.
 *
 * The rule that keeps clients apart: a GA4 property is accepted only if these
 * credentials can see it *and* one of its web data streams is this website's
 * domain. The choice is re-read from Google on the server; nothing the
 * browser sends is trusted. Tokens never leave encrypted storage except to
 * call Google.
 */

const LABEL = "Analytics";
/** Most properties checked for a matching web stream when listing. */
const MATCH_CHECKS = 30;

function staffOnly(actor: Actor): void {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

async function propertyFor(propertyId: string) {
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true, domain: true } });
  if (!property) throw new NotFoundError("That SEO property does not exist.");
  return property;
}

export type SafeGa4Connection = {
  method: "OAUTH" | "SERVICE_ACCOUNT";
  status: "PENDING" | "CONNECTED" | "ERROR";
  accountEmail: string | null;
  ga4Property: string | null;
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  lastSyncError: string | null;
  failureCount: number;
  dataThrough: Date | null;
  backfilledFrom: Date | null;
};

function toSafe(connection: SeoConnection): SafeGa4Connection {
  return {
    method: connection.method,
    status: connection.status,
    accountEmail: connection.accountEmail,
    ga4Property: connection.externalId,
    lastSyncedAt: connection.lastSyncedAt,
    lastAttemptAt: connection.lastAttemptAt,
    lastSyncError: connection.lastSyncError,
    failureCount: connection.failureCount,
    dataThrough: connection.dataThrough,
    backfilledFrom: connection.backfilledFrom,
  };
}

export async function getGa4Connection(actor: Actor, propertyId: string): Promise<SafeGa4Connection | null> {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await propertyFor(propertyId);
  const connection = await db.seoConnection.findUnique({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } } });
  return connection ? toSafe(connection) : null;
}

export async function ga4AuthorizationUrl(actor: Actor, propertyId: string, state: string): Promise<string> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);
  return googleAuthorizationUrl(await seoOAuthConfig(GA4_SCOPE, LABEL), state, seoGoogleCallbackUrl());
}

type Grant = {
  method: "OAUTH" | "SERVICE_ACCOUNT";
  status: "PENDING";
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  accountEmail: string | null;
};

async function saveGrant(actor: Actor, propertyId: string, data: Grant, audit: Record<string, unknown>) {
  const reset = { externalId: null, permissionLevel: null, lastSyncError: null, failureCount: 0, connectedById: actor.type === "STAFF" ? actor.userId : null };
  await db.$transaction(async (tx) => {
    await tx.seoConnection.upsert({
      where: { propertyId_source: { propertyId, source: "ANALYTICS" } },
      create: { propertyId, source: "ANALYTICS", ...data, ...reset },
      update: { ...data, ...reset },
    });
    await tx.seoProperty.update({ where: { id: propertyId }, data: { ga4PropertyId: null } });
    await record({ actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, after: audit }, tx);
  });
}

/** The callback's half: exchange the code, store the grant, wait for a property to be chosen. */
export async function completeGa4OAuth(actor: Actor, propertyId: string, code: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);
  const credentials = await googleExchangeCode(await seoOAuthConfig(GA4_SCOPE, LABEL), (url, init) => fetch(url, init), code, seoGoogleCallbackUrl());
  const accountEmail = await googleAccountEmail(credentials.accessToken);
  await saveGrant(
    actor,
    propertyId,
    {
      method: "OAUTH",
      status: "PENDING",
      accessToken: encryptSecret(credentials.accessToken),
      refreshToken: credentials.refreshToken ? encryptSecret(credentials.refreshToken) : null,
      tokenExpiresAt: credentials.expiresAt,
      scopes: credentials.scopes ? [...credentials.scopes] : [],
      accountEmail,
    },
    { analytics: "signed in", method: "OAUTH", accountEmail },
  );
}

export async function connectGa4WithServiceAccount(actor: Actor, propertyId: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);
  const account = await googleServiceAccount();
  if (!account) throw new IntegrationNotConfiguredError("No service account is set up. Add its key in SEO settings first.");
  await saveGrant(
    actor,
    propertyId,
    { method: "SERVICE_ACCOUNT", status: "PENDING", accessToken: null, refreshToken: null, tokenExpiresAt: null, scopes: [GA4_SCOPE], accountEmail: account.email },
    { analytics: "service account", accountEmail: account.email },
  );
}

/** The provider for a stored connection, whichever way it authenticates. */
export function analyticsFor(connection: Pick<SeoConnection, "id" | "method">): AnalyticsProvider {
  return new GoogleAnalytics(tokenSource(connection, GA4_SCOPE, LABEL), (url, init) => fetch(url, init));
}

async function connectionOf(propertyId: string) {
  const connection = await db.seoConnection.findUnique({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } } });
  if (!connection) throw new NotFoundError("Analytics is not connected for this website. Start again.");
  return connection;
}

/** Whether any of a property's web streams is this website (www or not). */
async function streamMatches(provider: AnalyticsProvider, ga4Property: string, domain: string): Promise<boolean> {
  const hosts = siteHosts(domain);
  const streams = await provider.listWebStreams(ga4Property);
  return streams.some((stream) => {
    try {
      return hosts.has(new URL(stream.defaultUri).host.toLowerCase());
    } catch {
      return false;
    }
  });
}

export type Ga4PropertyOption = Ga4PropertySummary & { matches: boolean | null };

/** The GA4 properties the connection can see; the first few checked for this website's stream, matches first. */
export async function listGa4Properties(actor: Actor, propertyId: string, options: { provider?: AnalyticsProvider } = {}): Promise<Ga4PropertyOption[]> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  const property = await propertyFor(propertyId);
  const provider = options.provider ?? analyticsFor(await connectionOf(propertyId));
  const summaries = await provider.listProperties();
  const out: Ga4PropertyOption[] = [];
  for (const [i, summary] of summaries.entries()) {
    out.push({ ...summary, matches: i < MATCH_CHECKS ? await streamMatches(provider, summary.property, property.domain) : null });
  }
  return out.sort((a, b) => Number(b.matches === true) - Number(a.matches === true) || a.displayName.localeCompare(b.displayName));
}

/**
 * Attach the chosen GA4 property. Re-read from Google, so only a property
 * these credentials see can be chosen, and only one whose web stream is this
 * website — one client's Analytics can never feed another client's website.
 */
export async function chooseGa4Property(actor: Actor, propertyId: string, ga4Property: string, options: { provider?: AnalyticsProvider } = {}): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  if (!PROPERTY_ID.test(ga4Property)) throw new ValidationError("Choose a GA4 property.");
  const property = await propertyFor(propertyId);
  const connection = await connectionOf(propertyId);
  const provider = options.provider ?? analyticsFor(connection);

  const visible = (await provider.listProperties()).find((summary) => summary.property === ga4Property);
  if (!visible) throw new ValidationError("That GA4 property is not visible to this account.");
  if (!(await streamMatches(provider, ga4Property, property.domain))) {
    throw new ValidationError(`That GA4 property has no web data stream for ${property.domain}. Choose the one for this website.`);
  }
  const detail = await provider.getProperty(ga4Property);

  await db.$transaction(async (tx) => {
    await tx.seoConnection.update({
      where: { id: connection.id },
      // A different property's history does not continue this one's.
      data: { status: "CONNECTED", externalId: ga4Property, lastSyncError: null, failureCount: 0, backfilledFrom: null, dataThrough: null },
    });
    await tx.seoProperty.update({ where: { id: propertyId }, data: { ga4PropertyId: ga4Property, ga4Currency: detail.currencyCode, ga4TimeZone: detail.timeZone } });
    // Rows from a previously connected property would mix two sites' numbers.
    await tx.ga4LandingDaily.deleteMany({ where: { propertyId } });
    await tx.ga4DailyTotal.deleteMany({ where: { propertyId } });
    await record(
      { actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, after: { analytics: "connected", ga4Property, displayName: detail.displayName, currency: detail.currencyCode, method: connection.method } },
      tx,
    );
  });
}

/** Disconnect: the credentials go, the stored history stays. */
export async function disconnectGa4(actor: Actor, propertyId: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);
  const connection = await db.seoConnection.findUnique({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } } });
  if (!connection) return;
  await revokeGrant(connection);
  await db.$transaction(async (tx) => {
    await tx.seoConnection.delete({ where: { id: connection.id } });
    await tx.seoProperty.update({ where: { id: propertyId }, data: { ga4PropertyId: null } });
    await record(
      { actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, before: { analytics: connection.externalId, method: connection.method }, after: { analytics: "disconnected" } },
      tx,
    );
  });
}
