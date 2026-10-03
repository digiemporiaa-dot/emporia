import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { googleAuthorizationUrl, googleExchangeCode, googleRefresh, type GoogleOAuthConfig } from "@/lib/social/google-oauth";
import { googleOAuthApp, googleServiceAccount, seoGoogleCallbackUrl } from "@/lib/seo-intel/google/settings";
import { serviceAccountToken } from "@/lib/seo-intel/google/service-account";
import { GoogleSearchConsole, GSC_SCOPE } from "@/lib/seo-intel/providers/gsc";
import { SeoCredentialsError } from "@/lib/seo-intel/providers/errors";
import { siteMatchesDomain } from "@/lib/seo-intel/gsc-site";
import type { Actor } from "@/lib/actor/types";
import type { GscSite, SearchConsoleProvider } from "@/lib/seo-intel/providers/types";
import type { SeoConnection } from "@/generated/prisma/client";

/**
 * Connecting a property to Search Console (decision D3: OAuth or the agency's
 * service account).
 *
 * The rule that keeps clients apart here: a site is only accepted if the
 * credentials can actually see it *and* it is the property's own domain. A
 * site picked in the browser is re-checked against Google's own list on the
 * server; a client-supplied site URL is never trusted.
 *
 * Tokens are encrypted at rest, decrypted only to call Google, and never
 * returned — `SafeGscConnection` is the only shape that leaves.
 */

const OAUTH_SCOPES = [GSC_SCOPE, "openid", "email"] as const;
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function staffOnly(actor: Actor): void {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

async function propertyFor(propertyId: string) {
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: { id: true, domain: true, clientId: true, displayName: true },
  });
  if (!property) throw new NotFoundError("That SEO property does not exist.");
  return property;
}

async function oauthConfig(): Promise<GoogleOAuthConfig> {
  const app = await googleOAuthApp();
  if (!app) throw new IntegrationNotConfiguredError("Google sign-in is not set up. Add the OAuth client in SEO settings first.");
  return { ...app, scopes: OAUTH_SCOPES, requiredScopes: [GSC_SCOPE], label: "Search Console" };
}

export type SafeGscConnection = {
  method: "OAUTH" | "SERVICE_ACCOUNT";
  status: "PENDING" | "CONNECTED" | "ERROR";
  accountEmail: string | null;
  siteUrl: string | null;
  permissionLevel: string | null;
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  lastSyncError: string | null;
  failureCount: number;
  dataThrough: Date | null;
  backfilledFrom: Date | null;
};

function toSafe(connection: SeoConnection): SafeGscConnection {
  return {
    method: connection.method,
    status: connection.status,
    accountEmail: connection.accountEmail,
    siteUrl: connection.externalId,
    permissionLevel: connection.permissionLevel,
    lastSyncedAt: connection.lastSyncedAt,
    lastAttemptAt: connection.lastAttemptAt,
    lastSyncError: connection.lastSyncError,
    failureCount: connection.failureCount,
    dataThrough: connection.dataThrough,
    backfilledFrom: connection.backfilledFrom,
  };
}

export async function getGscConnection(actor: Actor, propertyId: string): Promise<SafeGscConnection | null> {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await propertyFor(propertyId);
  const connection = await db.seoConnection.findUnique({ where: { propertyId_source: { propertyId, source: "SEARCH_CONSOLE" } } });
  return connection ? toSafe(connection) : null;
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

/** Where to send the browser to sign in. The property id travels in the signed state. */
export async function gscAuthorizationUrl(actor: Actor, propertyId: string, state: string): Promise<string> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);
  return googleAuthorizationUrl(await oauthConfig(), state, seoGoogleCallbackUrl());
}

/** The callback's half: exchange the code, store the grant, wait for a site to be chosen. */
export async function completeGscOAuth(actor: Actor, propertyId: string, code: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);

  const config = await oauthConfig();
  const credentials = await googleExchangeCode(config, (url, init) => fetch(url, init), code, seoGoogleCallbackUrl());

  // Which Google account this is, so the screen can say. Optional: a failure
  // here costs a label, not the connection.
  let accountEmail: string | null = null;
  try {
    const response = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${credentials.accessToken}` }, signal: AbortSignal.timeout(10_000) });
    const body = (await response.json().catch(() => ({}))) as { email?: unknown };
    if (response.ok && typeof body.email === "string") accountEmail = body.email;
  } catch {
    accountEmail = null;
  }

  const data = {
    method: "OAUTH" as const,
    status: "PENDING" as const,
    accessToken: encryptSecret(credentials.accessToken),
    refreshToken: credentials.refreshToken ? encryptSecret(credentials.refreshToken) : null,
    tokenExpiresAt: credentials.expiresAt,
    scopes: credentials.scopes ? [...credentials.scopes] : [],
    accountEmail,
    externalId: null,
    permissionLevel: null,
    lastSyncError: null,
    failureCount: 0,
    connectedById: actor.type === "STAFF" ? actor.userId : null,
  };

  await db.$transaction(async (tx) => {
    await tx.seoConnection.upsert({
      where: { propertyId_source: { propertyId, source: "SEARCH_CONSOLE" } },
      create: { propertyId, source: "SEARCH_CONSOLE", ...data },
      update: data,
    });
    await tx.seoProperty.update({ where: { id: propertyId }, data: { gscSiteUrl: null, verifiedAt: null } });
    await record(
      { actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, after: { searchConsole: "signed in", method: "OAUTH", accountEmail } },
      tx,
    );
  });
}

/** Use the agency's service account instead of a sign-in. */
export async function connectGscWithServiceAccount(actor: Actor, propertyId: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);
  const account = await googleServiceAccount();
  if (!account) throw new IntegrationNotConfiguredError("No service account is set up. Add its key in SEO settings first.");

  const data = {
    method: "SERVICE_ACCOUNT" as const,
    status: "PENDING" as const,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    scopes: [GSC_SCOPE],
    accountEmail: account.email,
    externalId: null,
    permissionLevel: null,
    lastSyncError: null,
    failureCount: 0,
    connectedById: actor.type === "STAFF" ? actor.userId : null,
  };
  await db.$transaction(async (tx) => {
    await tx.seoConnection.upsert({
      where: { propertyId_source: { propertyId, source: "SEARCH_CONSOLE" } },
      create: { propertyId, source: "SEARCH_CONSOLE", ...data },
      update: data,
    });
    await tx.seoProperty.update({ where: { id: propertyId }, data: { gscSiteUrl: null, verifiedAt: null } });
    await record(
      { actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, after: { searchConsole: "service account", accountEmail: account.email } },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Reading with the stored credentials
// ---------------------------------------------------------------------------

const expiring = (expiresAt: Date | null) => !expiresAt || expiresAt.getTime() - Date.now() < 120_000;

/**
 * A fresh OAuth access token, renewed and stored if it is about to expire.
 * Serialised per connection: whoever renews second uses the first one's token
 * rather than spending the refresh token twice.
 */
async function oauthAccessToken(connectionId: string): Promise<string> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-credentials:${connectionId}`}))`;
      const current = await tx.seoConnection.findUnique({ where: { id: connectionId } });
      if (!current) throw new SeoCredentialsError("This Search Console connection no longer exists.");
      const access = decryptSecret(current.accessToken);
      const refresh = decryptSecret(current.refreshToken);
      if (access && !expiring(current.tokenExpiresAt)) return access;
      if (!refresh) throw new SeoCredentialsError("This Search Console connection can no longer be read. Reconnect it.");

      let fresh;
      try {
        fresh = await googleRefresh(await oauthConfig(), (url, init) => fetch(url, init), {
          accessToken: access ?? "",
          refreshToken: refresh,
          expiresAt: current.tokenExpiresAt,
        });
      } catch (error) {
        if (error instanceof IntegrationNotConfiguredError) throw error;
        throw new SeoCredentialsError("Google no longer accepts this Search Console connection. Reconnect it.");
      }
      await tx.seoConnection.update({
        where: { id: connectionId },
        data: {
          accessToken: encryptSecret(fresh.accessToken),
          refreshToken: fresh.refreshToken ? encryptSecret(fresh.refreshToken) : current.refreshToken,
          tokenExpiresAt: fresh.expiresAt,
          ...(fresh.scopes ? { scopes: [...fresh.scopes] } : {}),
        },
      });
      return fresh.accessToken;
    },
    { timeout: 30_000 },
  );
}

/** The provider for a stored connection, whichever way it authenticates. */
export function searchConsoleFor(connection: Pick<SeoConnection, "id" | "method">): SearchConsoleProvider {
  const token =
    connection.method === "OAUTH"
      ? () => oauthAccessToken(connection.id)
      : async () => {
          const account = await googleServiceAccount();
          if (!account) throw new SeoCredentialsError("The service account key is no longer set up. Add it in SEO settings, then reconnect.");
          return serviceAccountToken(account, [GSC_SCOPE]);
        };
  return new GoogleSearchConsole(token, (url, init) => fetch(url, init));
}

async function connectionOf(propertyId: string) {
  const connection = await db.seoConnection.findUnique({ where: { propertyId_source: { propertyId, source: "SEARCH_CONSOLE" } } });
  if (!connection) throw new NotFoundError("Search Console is not connected for this website. Start again.");
  return connection;
}

export type SiteOption = GscSite & { matches: boolean; usable: boolean };

/** The sites the connection can see, this property's own first. */
export async function listGscSites(actor: Actor, propertyId: string): Promise<SiteOption[]> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  const property = await propertyFor(propertyId);
  const connection = await connectionOf(propertyId);
  const sites = await searchConsoleFor(connection).listSites();
  return sites
    .map((site) => ({
      ...site,
      matches: siteMatchesDomain(site.siteUrl, property.domain),
      usable: site.permissionLevel !== "siteUnverifiedUser",
    }))
    .sort((a, b) => Number(b.matches) - Number(a.matches) || Number(b.usable) - Number(a.usable) || a.siteUrl.localeCompare(b.siteUrl));
}

/**
 * Attach the chosen site. Re-read from Google, so the browser can only pick a
 * site these credentials really see; and it must be this property's domain,
 * so one client's Search Console can never feed another client's property.
 */
export async function chooseGscSite(actor: Actor, propertyId: string, siteUrl: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  const property = await propertyFor(propertyId);
  const connection = await connectionOf(propertyId);
  const site = (await searchConsoleFor(connection).listSites()).find((candidate) => candidate.siteUrl === siteUrl);

  if (!site) throw new ValidationError("That Search Console property is not visible to this account.");
  if (site.permissionLevel === "siteUnverifiedUser") {
    throw new ValidationError("This account is not verified for that Search Console property, so Google will not share its data.");
  }
  if (!siteMatchesDomain(site.siteUrl, property.domain)) {
    throw new ValidationError(`That Search Console property is not for ${property.domain}. Choose the one for this website.`);
  }

  await db.$transaction(async (tx) => {
    await tx.seoConnection.update({
      where: { id: connection.id },
      data: { status: "CONNECTED", externalId: site.siteUrl, permissionLevel: site.permissionLevel, lastSyncError: null, failureCount: 0 },
    });
    // Google listing the site with real access is the verification.
    await tx.seoProperty.update({ where: { id: propertyId }, data: { gscSiteUrl: site.siteUrl, verifiedAt: new Date() } });
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "SeoProperty",
        entityId: propertyId,
        after: { searchConsole: "connected", siteUrl: site.siteUrl, permissionLevel: site.permissionLevel, method: connection.method },
      },
      tx,
    );
  });
}

/**
 * Disconnect: the credentials go, the history stays (it is the client's
 * record of what happened). An OAuth grant is also revoked at Google, best
 * effort — a failed revoke still disconnects here.
 */
export async function disconnectGsc(actor: Actor, propertyId: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.connect");
  staffOnly(actor);
  await propertyFor(propertyId);
  const connection = await db.seoConnection.findUnique({ where: { propertyId_source: { propertyId, source: "SEARCH_CONSOLE" } } });
  if (!connection) return;

  const token = decryptSecret(connection.refreshToken) ?? decryptSecret(connection.accessToken);
  if (connection.method === "OAUTH" && token) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  await db.$transaction(async (tx) => {
    await tx.seoConnection.delete({ where: { id: connection.id } });
    await tx.seoProperty.update({ where: { id: propertyId }, data: { gscSiteUrl: null, verifiedAt: null } });
    await record(
      { actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, before: { searchConsole: connection.externalId, method: connection.method }, after: { searchConsole: "disconnected" } },
      tx,
    );
  });
}
