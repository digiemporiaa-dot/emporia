import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { clearServiceAccountTokens, parseServiceAccountJson } from "@/lib/seo-intel/google/service-account";
import { readGoogleConfig, SEO_GOOGLE_SETTING, seoGoogleCallbackUrl, type StoredGoogleConfig } from "@/lib/seo-intel/google/settings";
import type { Actor } from "@/lib/actor/types";
import type { SeoGoogleSettingsInput } from "@/lib/validation/seo-intel";

/**
 * Settings for the agency's Google credentials (decision D3). Secrets are
 * write-only: the view below says whether each is set and readable, never
 * what it is.
 */

export type SafeGoogleSettings = {
  oauthClientId: string | null;
  oauthSecretConfigured: boolean;
  /** A secret is stored but no longer decrypts — AUTH_SECRET changed. */
  oauthSecretUnreadable: boolean;
  serviceAccountEmail: string | null;
  serviceAccountKeyConfigured: boolean;
  serviceAccountKeyUnreadable: boolean;
  /** To register in the Google Cloud console as an authorised redirect URI. */
  callbackUrl: string;
};

function safe(config: StoredGoogleConfig): SafeGoogleSettings {
  return {
    oauthClientId: config.oauthClientId ?? null,
    oauthSecretConfigured: Boolean(config.oauthClientSecret),
    oauthSecretUnreadable: Boolean(config.oauthClientSecret) && decryptSecret(config.oauthClientSecret) === null,
    serviceAccountEmail: config.serviceAccountEmail ?? null,
    serviceAccountKeyConfigured: Boolean(config.serviceAccountKey),
    serviceAccountKeyUnreadable: Boolean(config.serviceAccountKey) && decryptSecret(config.serviceAccountKey) === null,
    callbackUrl: seoGoogleCallbackUrl(),
  };
}

export async function getGoogleSettings(actor: Actor): Promise<SafeGoogleSettings> {
  requirePermission(actor, "seo.intelligence.connect");
  return safe(await readGoogleConfig());
}

/** What the connect panel needs to offer: which methods are available. Visible to viewers too. */
export async function googleMethodsAvailable(actor: Actor): Promise<{ oauth: boolean; serviceAccount: string | null }> {
  requirePermission(actor, "seo.intelligence.view");
  const config = await readGoogleConfig();
  return {
    oauth: Boolean(config.oauthClientId && config.oauthClientSecret),
    serviceAccount: config.serviceAccountKey && config.serviceAccountEmail ? config.serviceAccountEmail : null,
  };
}

export async function saveGoogleSettings(actor: Actor, input: SeoGoogleSettingsInput): Promise<SafeGoogleSettings> {
  requirePermission(actor, "seo.intelligence.connect");
  const before = await readGoogleConfig();

  const next: StoredGoogleConfig = { ...before };

  if (input.removeOAuth) {
    delete next.oauthClientId;
    delete next.oauthClientSecret;
  } else {
    if (input.oauthClientId) next.oauthClientId = input.oauthClientId;
    else delete next.oauthClientId;
    if (input.oauthClientSecret) next.oauthClientSecret = encryptSecret(input.oauthClientSecret);
    if (next.oauthClientSecret && !next.oauthClientId) {
      throw new ValidationError("Enter the OAuth client ID that goes with the secret.", { oauthClientId: ["Enter the client ID."] });
    }
    if (next.oauthClientId && !next.oauthClientSecret) {
      throw new ValidationError("Enter the OAuth client secret.", { oauthClientSecret: ["Enter the client secret."] });
    }
  }

  if (input.removeServiceAccount) {
    delete next.serviceAccountEmail;
    delete next.serviceAccountKeyId;
    delete next.serviceAccountKey;
  } else if (input.serviceAccountJson) {
    let key;
    try {
      key = parseServiceAccountJson(input.serviceAccountJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That key file could not be read.";
      throw new ValidationError(message, { serviceAccountJson: [message] });
    }
    next.serviceAccountEmail = key.email;
    next.serviceAccountKeyId = key.keyId;
    next.serviceAccountKey = encryptSecret(key.privateKey);
  }

  const audit = (config: StoredGoogleConfig) => ({
    oauthClientId: config.oauthClientId ?? null,
    oauthSecretConfigured: Boolean(config.oauthClientSecret),
    serviceAccountEmail: config.serviceAccountEmail ?? null,
    serviceAccountKeyId: config.serviceAccountKeyId ?? null,
  });

  await db.$transaction(async (tx) => {
    await tx.integrationSetting.upsert({
      where: { provider: SEO_GOOGLE_SETTING },
      create: { provider: SEO_GOOGLE_SETTING, config: next, isEnabled: true },
      update: { config: next, isEnabled: true },
    });
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "IntegrationSetting",
        entityId: SEO_GOOGLE_SETTING,
        before: audit(before),
        after: {
          ...audit(next),
          oauthSecretChanged: next.oauthClientSecret !== before.oauthClientSecret,
          serviceAccountKeyChanged: next.serviceAccountKey !== before.serviceAccountKey,
        },
      },
      tx,
    );
  });

  // A replaced or removed key must not keep minting tokens from the cache.
  clearServiceAccountTokens();
  return safe(next);
}
