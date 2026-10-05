import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { decryptSecret } from "@/lib/security/secret";
import type { ServiceAccountKey } from "@/lib/seo-intel/google/service-account";

/**
 * The agency's Google credentials for SEO Intelligence, as stored.
 *
 * One `IntegrationSetting` row, `seo.google`:
 *
 * - an OAuth app (client id + encrypted secret), for "Sign in with Google";
 * - a service account (address + key id + encrypted private key), for
 *   clients who add the agency's service account to their property instead.
 *
 * - a Chrome UX Report API key (encrypted), for Core Web Vitals (Phase 11).
 *
 * Either, both or neither may be set (decision D3). This module decrypts, so
 * it is for building providers only — screens read the masked view in
 * `google-settings.service`.
 */

export const SEO_GOOGLE_SETTING = "seo.google";

export type StoredGoogleConfig = {
  oauthClientId?: string;
  oauthClientSecret?: string;
  serviceAccountEmail?: string;
  serviceAccountKeyId?: string | null;
  serviceAccountKey?: string;
  cruxApiKey?: string;
};

export async function readGoogleConfig(): Promise<StoredGoogleConfig> {
  const row = await db.integrationSetting.findUnique({ where: { provider: SEO_GOOGLE_SETTING }, select: { config: true } });
  const config = (row?.config ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof config[key] === "string" && (config[key] as string) ? (config[key] as string) : undefined);
  return {
    oauthClientId: str("oauthClientId"),
    oauthClientSecret: str("oauthClientSecret"),
    serviceAccountEmail: str("serviceAccountEmail"),
    serviceAccountKeyId: str("serviceAccountKeyId") ?? null,
    serviceAccountKey: str("serviceAccountKey"),
    cruxApiKey: str("cruxApiKey"),
  };
}

/** The OAuth app, decrypted, or null when it is not set up (or no longer decrypts). */
export async function googleOAuthApp(): Promise<{ clientId: string; clientSecret: string } | null> {
  const config = await readGoogleConfig();
  if (!config.oauthClientId || !config.oauthClientSecret) return null;
  const clientSecret = decryptSecret(config.oauthClientSecret);
  return clientSecret ? { clientId: config.oauthClientId, clientSecret } : null;
}

/** The service account, decrypted, or null when it is not set up (or no longer decrypts). */
export async function googleServiceAccount(): Promise<ServiceAccountKey | null> {
  const config = await readGoogleConfig();
  if (!config.serviceAccountEmail || !config.serviceAccountKey) return null;
  const privateKey = decryptSecret(config.serviceAccountKey);
  return privateKey ? { email: config.serviceAccountEmail, keyId: config.serviceAccountKeyId ?? null, privateKey } : null;
}

/** The Chrome UX Report API key, decrypted, or null when it is not set up (or no longer decrypts). */
export async function cruxApiKey(): Promise<string | null> {
  const { cruxApiKey: stored } = await readGoogleConfig();
  return stored ? decryptSecret(stored) : null;
}

/** Where Google sends the browser back. From SITE_URL, never from a request's Host header. */
export function seoGoogleCallbackUrl(): string {
  return `${env().SITE_URL.replace(/\/+$/, "")}/api/seo/google/callback`;
}
