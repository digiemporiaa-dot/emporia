import "server-only";
import { db } from "@/lib/db";
import { IntegrationNotConfiguredError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { googleRefresh, type GoogleOAuthConfig } from "@/lib/social/google-oauth";
import { googleOAuthApp, googleServiceAccount } from "@/lib/seo-intel/google/settings";
import { serviceAccountToken } from "@/lib/seo-intel/google/service-account";
import { SeoCredentialsError } from "@/lib/seo-intel/providers/errors";
import type { SeoConnection } from "@/generated/prisma/client";

/**
 * Credentials shared by every Google data source a property connects to
 * (Search Console, Analytics): the OAuth app, renewing a stored grant, the
 * agency's service account, and revoking a grant on disconnect. One place,
 * so the sources cannot drift apart on how tokens are kept.
 */

const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export async function seoOAuthConfig(scope: string, label: string): Promise<GoogleOAuthConfig> {
  const app = await googleOAuthApp();
  if (!app) throw new IntegrationNotConfiguredError("Google sign-in is not set up. Add the OAuth client in SEO settings first.");
  return { ...app, scopes: [scope, "openid", "email"], requiredScopes: [scope], label };
}

const expiring = (expiresAt: Date | null) => !expiresAt || expiresAt.getTime() - Date.now() < 120_000;

/**
 * A fresh OAuth access token, renewed and stored if it is about to expire.
 * Serialised per connection: whoever renews second uses the first one's token
 * rather than spending the refresh token twice.
 */
export async function oauthAccessToken(connectionId: string, scope: string, label: string): Promise<string> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-credentials:${connectionId}`}))`;
      const current = await tx.seoConnection.findUnique({ where: { id: connectionId } });
      if (!current) throw new SeoCredentialsError(`This ${label} connection no longer exists.`);
      const access = decryptSecret(current.accessToken);
      const refresh = decryptSecret(current.refreshToken);
      if (access && !expiring(current.tokenExpiresAt)) return access;
      if (!refresh) throw new SeoCredentialsError(`This ${label} connection can no longer be read. Reconnect it.`);

      let fresh;
      try {
        fresh = await googleRefresh(await seoOAuthConfig(scope, label), (url, init) => fetch(url, init), {
          accessToken: access ?? "",
          refreshToken: refresh,
          expiresAt: current.tokenExpiresAt,
        });
      } catch (error) {
        if (error instanceof IntegrationNotConfiguredError) throw error;
        throw new SeoCredentialsError(`Google no longer accepts this ${label} connection. Reconnect it.`);
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

/** A token source for a stored connection, whichever way it authenticates. */
export function tokenSource(connection: Pick<SeoConnection, "id" | "method">, scope: string, label: string): () => Promise<string> {
  return connection.method === "OAUTH"
    ? () => oauthAccessToken(connection.id, scope, label)
    : async () => {
        const account = await googleServiceAccount();
        if (!account) throw new SeoCredentialsError("The service account key is no longer set up. Add it in SEO settings, then reconnect.");
        return serviceAccountToken(account, [scope]);
      };
}

/** Which Google account signed in. Optional: a failure costs a label, not the connection. */
export async function googleAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
    const body = (await response.json().catch(() => ({}))) as { email?: unknown };
    return response.ok && typeof body.email === "string" ? body.email : null;
  } catch {
    return null;
  }
}

/** Revoke an OAuth grant at Google, best effort: a failed revoke still disconnects. */
export async function revokeGrant(connection: Pick<SeoConnection, "method" | "accessToken" | "refreshToken">): Promise<void> {
  const token = decryptSecret(connection.refreshToken) ?? decryptSecret(connection.accessToken);
  if (connection.method !== "OAUTH" || !token) return;
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
