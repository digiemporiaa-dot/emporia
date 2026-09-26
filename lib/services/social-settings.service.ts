import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { encryptSecret, maskSecret, decryptSecret } from "@/lib/security/secret";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { SOCIAL_PROVIDERS, settingKey } from "@/lib/social";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * A platform's app credentials — the client id and secret the platform issues
 * to *this agency*, not the per-account tokens a client's connection holds.
 *
 * Stored in `IntegrationSetting`, the row shape the AI provider and the Meta
 * Conversions API already use, with the secret half encrypted. The read used by
 * the settings screen never decrypts: it returns a mask, so a screen cannot
 * leak a credential even by accident (the same split `ai-settings.service`
 * makes between `getAISettings` and `activeAIConfig`).
 */

export type ProviderSettingsRow = {
  provider: SocialProvider;
  label: string;
  isEnabled: boolean;
  clientId: string | null;
  clientSecretMasked: string | null;
  /** True when a secret exists but no longer decrypts — AUTH_SECRET rotated. */
  clientSecretUnreadable: boolean;
  updatedAt: Date | null;
};

export async function listProviderSettings(actor: Actor): Promise<ProviderSettingsRow[]> {
  requirePermission(actor, "settings.view");

  const rows = await db.integrationSetting.findMany({
    where: { provider: { in: SOCIAL_PROVIDERS.map(settingKey) } },
    select: { provider: true, config: true, isEnabled: true, updatedAt: true },
  });
  const byKey = new Map(rows.map((row) => [row.provider, row]));

  return SOCIAL_PROVIDERS.map((provider) => {
    const row = byKey.get(settingKey(provider));
    const config = (row?.config ?? {}) as { clientId?: unknown; clientSecret?: unknown };
    const stored = typeof config.clientSecret === "string" ? config.clientSecret : null;
    const plain = stored ? decryptSecret(stored) : null;

    return {
      provider,
      label: PROVIDER_LABEL[provider],
      isEnabled: row?.isEnabled ?? false,
      clientId: typeof config.clientId === "string" ? config.clientId : null,
      clientSecretMasked: maskSecret(plain),
      clientSecretUnreadable: stored !== null && plain === null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/**
 * Save one provider's app credentials.
 *
 * A blank secret means "leave the stored one alone" — the form shows a mask,
 * not the value, so submitting the form unchanged must not wipe the
 * credential. Clearing it is a separate, explicit action.
 */
export async function saveProviderSettings(
  actor: Actor,
  input: { provider: SocialProvider; clientId: string; clientSecret: string | null; isEnabled: boolean },
): Promise<void> {
  requirePermission(actor, "settings.edit");

  const key = settingKey(input.provider);
  const existing = await db.integrationSetting.findUnique({
    where: { provider: key },
    select: { config: true, isEnabled: true },
  });
  const current = (existing?.config ?? {}) as { clientSecret?: unknown };

  const clientSecret = input.clientSecret
    ? encryptSecret(input.clientSecret)
    : typeof current.clientSecret === "string"
      ? current.clientSecret
      : null;

  const config = { clientId: input.clientId, clientSecret };

  await db.integrationSetting.upsert({
    where: { provider: key },
    update: { config, isEnabled: input.isEnabled },
    create: { provider: key, config, isEnabled: input.isEnabled },
  });

  // The audit records that credentials changed and who changed them. It
  // records neither half of the credential (CLAUDE.md 11).
  await record({
    actor,
    action: "UPDATE",
    entityType: "Social integration",
    entityId: input.provider,
    before: { isEnabled: existing?.isEnabled ?? false },
    after: {
      isEnabled: input.isEnabled,
      clientIdSet: Boolean(input.clientId),
      secretChanged: Boolean(input.clientSecret),
    },
  });
}

/** Remove a provider's credentials entirely. */
export async function clearProviderSettings(actor: Actor, provider: SocialProvider): Promise<void> {
  requirePermission(actor, "settings.edit");

  await db.integrationSetting.deleteMany({ where: { provider: settingKey(provider) } });

  await record({
    actor,
    action: "DELETE",
    entityType: "Social integration",
    entityId: provider,
    after: { cleared: true },
  });
}
