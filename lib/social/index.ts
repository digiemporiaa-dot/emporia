import "server-only";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/security/secret";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { SocialProviderAdapter } from "@/lib/social/types";

/**
 * Which adapter serves which provider.
 *
 * App credentials — the client id and secret a platform issues to *us*, not
 * the per-account tokens — live in `IntegrationSetting` under the key below,
 * the same row shape the AI provider and the Meta Conversions API already use.
 * The secret half is encrypted at rest with `lib/security/secret`.
 *
 * No real adapter is registered yet. Each platform's API is a piece of work in
 * its own right and Phase 2 brings them in one at a time; until one lands, its
 * provider resolves to `UnconfiguredSocialProvider`, which reports its
 * capabilities and refuses every call with a typed error. That is deliberate:
 * a half-written adapter that silently no-ops is worse than an honest
 * "Not configured" on the screen.
 */

export const SOCIAL_PROVIDERS = [
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "X",
  "GOOGLE_BUSINESS_PROFILE",
] as const satisfies readonly SocialProvider[];

/** The `IntegrationSetting.provider` key for a platform's app credentials. */
export function settingKey(provider: SocialProvider): string {
  return `social.${provider.toLowerCase()}`;
}

export type SocialAppConfig = {
  clientId: string;
  clientSecret: string;
};

/**
 * The app credentials for a provider, or null when it is not set up.
 *
 * Server-only and never cached with the secret in it: the decrypted value is
 * read at the moment it is needed and not held anywhere a component could
 * reach.
 */
export async function appConfig(provider: SocialProvider): Promise<SocialAppConfig | null> {
  const row = await db.integrationSetting.findUnique({
    where: { provider: settingKey(provider) },
    select: { config: true, isEnabled: true },
  });
  if (!row || !row.isEnabled) return null;

  const config = (row.config ?? {}) as { clientId?: unknown; clientSecret?: unknown };
  const clientId = typeof config.clientId === "string" ? config.clientId : null;
  const stored = typeof config.clientSecret === "string" ? config.clientSecret : null;
  if (!clientId || !stored) return null;

  // Null when AUTH_SECRET has been rotated: the credential is unreadable, so
  // the provider is not configured, which is the truthful answer.
  const clientSecret = decryptSecret(stored);
  if (!clientSecret) return null;

  return { clientId, clientSecret };
}

/** The adapter for a provider. Never throws — an unusable one refuses on call. */
export async function socialProvider(
  provider: SocialProvider,
): Promise<SocialProviderAdapter> {
  // Phase 2 registers real adapters here, gated on `await appConfig(provider)`.
  return new UnconfiguredSocialProvider(provider);
}

/** What the admin needs to render the provider list, with no secret in it. */
export type ProviderStatus = {
  provider: SocialProvider;
  label: string;
  configured: boolean;
  /** True once a real adapter exists for this provider. */
  implemented: boolean;
  capabilities: (typeof CAPABILITIES)[SocialProvider];
};

export async function providerStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(
    SOCIAL_PROVIDERS.map(async (provider) => {
      const adapter = await socialProvider(provider);
      return {
        provider,
        label: PROVIDER_LABEL[provider],
        configured: adapter.configured,
        implemented: adapter.configured,
        capabilities: CAPABILITIES[provider],
      };
    }),
  );
}
