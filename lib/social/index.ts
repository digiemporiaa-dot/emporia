import "server-only";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/security/secret";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { FacebookProvider } from "@/lib/social/facebook";
import { GoogleBusinessProvider } from "@/lib/social/google-business";
import { InstagramProvider } from "@/lib/social/instagram";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { XProvider } from "@/lib/social/x";
import { YouTubeProvider } from "@/lib/social/youtube";
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
 * Adapters arrive one platform at a time, because each platform's API is a
 * piece of work in its own right. All six are now implemented; an
 * unconfigured one resolves to
 * `UnconfiguredSocialProvider`, which reports its capabilities and refuses
 * every call with a typed error. That is deliberate — a half-written adapter
 * that silently no-ops is worse than an honest "Not configured" on the screen.
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

/** Which providers have a real adapter written, configured or not. */
const IMPLEMENTED: ReadonlySet<SocialProvider> = new Set<SocialProvider>([
  "LINKEDIN",
  "INSTAGRAM",
  "FACEBOOK",
  "YOUTUBE",
  "GOOGLE_BUSINESS_PROFILE",
  "X",
]);

/**
 * The adapter for a provider.
 *
 * Never throws: an unusable provider returns the unconfigured adapter, which
 * refuses on call. That keeps "is this offered" a property a screen can read
 * without a try/catch.
 */
export async function socialProvider(
  provider: SocialProvider,
): Promise<SocialProviderAdapter> {
  if (!IMPLEMENTED.has(provider)) return new UnconfiguredSocialProvider(provider);

  const config = await appConfig(provider);
  if (!config) return new UnconfiguredSocialProvider(provider);

  switch (provider) {
    case "LINKEDIN":
      return new LinkedInProvider(config);
    case "INSTAGRAM":
      return new InstagramProvider(config);
    case "FACEBOOK":
      return new FacebookProvider(config);
    case "YOUTUBE":
      return new YouTubeProvider(config);
    case "GOOGLE_BUSINESS_PROFILE":
      return new GoogleBusinessProvider(config);
    case "X":
      return new XProvider(config);
    default:
      return new UnconfiguredSocialProvider(provider);
  }
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
        // Distinct from `configured`: "we have not written this adapter yet"
        // and "you have not entered the credentials" are different problems
        // with different fixes, and the screen should not conflate them.
        implemented: IMPLEMENTED.has(provider),
        capabilities: CAPABILITIES[provider],
      };
    }),
  );
}
