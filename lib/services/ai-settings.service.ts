import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/secret";
import { aiConfig } from "@/lib/config/env";
import { AI_DEFAULTS, PROVIDER_CATALOG, isProviderId, type AIProviderId } from "@/lib/ai/catalog";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { Actor } from "@/lib/actor/types";
import type { AISettingsInput } from "@/lib/validation/ai-settings";

/**
 * Which AI provider answers, and with what credentials.
 *
 * Stored in `IntegrationSetting` — the existing provider / isEnabled / config
 * model that already holds the tracking settings — as a single `ai` row. One
 * global configuration, enforced by that table's unique key on `provider`, so
 * "which settings are live" is not a question anyone has to answer
 * (CLAUDE.md 2 rule 10: no second settings table).
 *
 * Three ways to read it, deliberately three functions rather than one with a
 * flag:
 *
 *   getAISettings     admin only, permission-checked, API key masked
 *   activeAIConfig    server-only, decrypted, for making a provider request
 *   aiStatus          cached, no secret at all, for "is the button offered"
 *
 * `getAISettings` never returns the key because it never decrypts it into the
 * value it returns; `aiStatus` never selects it. A mistake in a component
 * cannot leak what the query did not fetch (CLAUDE.md 2 rule 6).
 */

const PROVIDER_ROW = "ai";
export const AI_SETTINGS_TAG = "ai-settings";

type StoredConfig = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  apiKey?: string;
};

async function readRow(): Promise<{ isEnabled: boolean; config: StoredConfig } | null> {
  const row = await db.integrationSetting.findUnique({
    where: { provider: PROVIDER_ROW },
    select: { isEnabled: true, config: true },
  });
  if (!row) return null;
  return {
    isEnabled: row.isEnabled,
    config: (row.config ?? {}) as StoredConfig,
  };
}

/** The provider's own defaults, for a field the admin has never filled in. */
function withDefaults(provider: AIProviderId, config: StoredConfig): AISettingsInput {
  const definition = PROVIDER_CATALOG[provider];
  return {
    enabled: false,
    provider,
    model: config.model ?? definition.defaultModel,
    baseUrl: config.baseUrl ?? definition.defaultBaseUrl,
    temperature: config.temperature ?? AI_DEFAULTS.temperature,
    maxOutputTokens: config.maxOutputTokens ?? AI_DEFAULTS.maxOutputTokens,
  };
}

// ---------------------------------------------------------------------------
// Admin read
// ---------------------------------------------------------------------------

export type AdminAISettings = AISettingsInput & {
  /** Masked, never the key. Null when none is stored. */
  apiKeyMasked: string | null;
  /** True when a key exists but no longer decrypts — AUTH_SECRET was rotated. */
  apiKeyUnreadable: boolean;
  /**
   * True when nothing is stored and the deployment is still running on the
   * environment variables. The screen says so, so an admin can see why AI works
   * before they have configured anything here.
   */
  usingEnvFallback: boolean;
};

export async function getAISettings(actor: Actor): Promise<AdminAISettings> {
  requirePermission(actor, "settings.view");

  const row = await readRow();
  const fallback = aiConfig();

  if (!row) {
    // Nothing saved. Show the environment's provider if there is one, so the
    // form opens on what is actually running rather than on a blank default.
    const provider: AIProviderId =
      fallback && isProviderId(fallback.provider.trim().toLowerCase())
        ? (fallback.provider.trim().toLowerCase() as AIProviderId)
        : "gemini";

    return {
      ...withDefaults(provider, {}),
      enabled: Boolean(fallback),
      ...(fallback?.baseUrl ? { baseUrl: fallback.baseUrl } : {}),
      apiKeyMasked: fallback ? "•••••••••• (from environment)" : null,
      apiKeyUnreadable: false,
      usingEnvFallback: Boolean(fallback),
    };
  }

  const provider = isProviderId(row.config.provider ?? "")
    ? (row.config.provider as AIProviderId)
    : "gemini";
  const stored = row.config.apiKey ?? null;
  const plain = decryptSecret(stored);

  return {
    ...withDefaults(provider, row.config),
    enabled: row.isEnabled,
    apiKeyMasked: maskSecret(plain),
    apiKeyUnreadable: Boolean(stored) && plain === null,
    usingEnvFallback: false,
  };
}

// ---------------------------------------------------------------------------
// Admin write
// ---------------------------------------------------------------------------

export async function updateAISettings(actor: Actor, input: AISettingsInput) {
  requirePermission(actor, "settings.edit");

  const row = await readRow();
  const before = row?.config ?? {};
  const providerChanged = before.provider !== undefined && before.provider !== input.provider;

  await db.$transaction(async (tx) => {
    await tx.integrationSetting.upsert({
      where: { provider: PROVIDER_ROW },
      create: {
        provider: PROVIDER_ROW,
        isEnabled: input.enabled,
        // The key is not in this payload at all; it has its own action. A save
        // of the settings form can never clear or overwrite it.
        config: { ...before, ...settingsPayload(input) } as InputJsonValue,
      },
      update: {
        isEnabled: input.enabled,
        config: { ...before, ...settingsPayload(input) } as InputJsonValue,
      },
    });

    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "AISettings",
        entityId: PROVIDER_ROW,
        // Neither snapshot holds the key: `settingsPayload` does not carry one
        // and `before` is spread from a config whose key is ciphertext anyway.
        // Stripped explicitly rather than relying on that.
        before: strip(before),
        after: { ...settingsPayload(input), enabled: input.enabled },
      },
      tx,
    );

    if (providerChanged) {
      await record(
        {
          actor,
          action: "UPDATE",
          entityType: "AISettings",
          entityId: "provider",
          before: { provider: before.provider },
          after: { provider: input.provider },
        },
        tx,
      );
    }
  });

  revalidateTag(AI_SETTINGS_TAG);
  return getAISettings(actor);
}

function settingsPayload(input: AISettingsInput) {
  return {
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
  };
}

/** A config with the ciphertext removed, for an audit snapshot. */
function strip(config: StoredConfig): Record<string, unknown> {
  const { apiKey: _apiKey, ...rest } = config;
  return rest;
}

/** Save the provider API key. Encrypted before it touches the database. */
export async function saveAIApiKey(actor: Actor, apiKey: string) {
  requirePermission(actor, "settings.edit");

  const row = await readRow();
  const config = row?.config ?? {};

  await db.$transaction(async (tx) => {
    await tx.integrationSetting.upsert({
      where: { provider: PROVIDER_ROW },
      create: {
        provider: PROVIDER_ROW,
        isEnabled: row?.isEnabled ?? false,
        config: { ...config, apiKey: encryptSecret(apiKey) } as InputJsonValue,
      },
      update: {
        isEnabled: row?.isEnabled ?? false,
        config: { ...config, apiKey: encryptSecret(apiKey) } as InputJsonValue,
      },
    });
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "AISettings",
        entityId: "apiKey",
        // A field name the audit layer does not scrub, so the trail says which
        // way the key changed. The key itself is never in this payload — and
        // `apiKey` would be redacted anyway, which is belt and braces.
        after: { change: "set" },
      },
      tx,
    );
  });

  revalidateTag(AI_SETTINGS_TAG);
}

export async function clearAIApiKey(actor: Actor) {
  requirePermission(actor, "settings.edit");

  const row = await readRow();
  const config = { ...(row?.config ?? {}) };
  delete config.apiKey;

  await db.$transaction(async (tx) => {
    // Removing the key also switches AI off: leaving it on would mean every
    // assist button offering a feature that cannot run.
    await tx.integrationSetting.upsert({
      where: { provider: PROVIDER_ROW },
      create: { provider: PROVIDER_ROW, isEnabled: false, config: config as InputJsonValue },
      update: { isEnabled: false, config: config as InputJsonValue },
    });
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "AISettings",
        entityId: "apiKey",
        after: { change: "removed" },
      },
      tx,
    );
  });

  revalidateTag(AI_SETTINGS_TAG);
}

/** Record that someone tested the connection. Never the key, never the reply. */
export async function recordAITest(
  actor: Actor,
  outcome: { provider: string; model: string; ok: boolean; reason?: string },
) {
  await record({
    actor,
    action: "UPDATE",
    entityType: "AISettings",
    entityId: "connection-test",
    after: outcome,
  });
}

// ---------------------------------------------------------------------------
// Runtime read
// ---------------------------------------------------------------------------

export type ActiveAIConfig = {
  provider: AIProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxOutputTokens: number;
  /** Where the configuration came from, for the admin screen and the logs. */
  source: "database" | "environment";
};

/**
 * The configuration a provider request should use.
 *
 * Priority, in order:
 *
 *   1. the saved settings, when they are enabled and have a usable key
 *   2. the environment variables, for a deployment that has not been
 *      reconfigured yet
 *   3. nothing, and the caller reports AI as unconfigured
 *
 * Deliberately not cached. It holds a decrypted credential, and a cache entry
 * is a place a secret lives longer than the request that needed it. The read is
 * one indexed row.
 */
export async function activeAIConfig(): Promise<ActiveAIConfig | null> {
  const row = await readRow();

  if (row?.isEnabled) {
    const provider = row.config.provider ?? "";
    const apiKey = decryptSecret(row.config.apiKey ?? null);
    if (isProviderId(provider) && apiKey) {
      const resolved = withDefaults(provider, row.config);
      return {
        provider,
        apiKey,
        model: resolved.model,
        baseUrl: resolved.baseUrl,
        temperature: resolved.temperature,
        maxOutputTokens: resolved.maxOutputTokens,
        source: "database",
      };
    }
    // Enabled but unusable — a key that will not decrypt, or a provider name
    // nothing implements. Falling through to the environment would silently
    // answer with a different account than the one the screen shows, so it
    // does not: the caller reports this as not configured.
    return null;
  }

  // A row that exists and is switched off means someone switched it off. The
  // environment fallback is for deployments that have never opened the screen.
  if (row) return null;

  const fallback = aiConfig();
  if (!fallback) return null;
  const provider = fallback.provider.trim().toLowerCase();
  if (!isProviderId(provider)) return null;

  const definition = PROVIDER_CATALOG[provider];
  return {
    provider,
    apiKey: fallback.apiKey,
    model: definition.defaultModel,
    baseUrl: fallback.baseUrl ?? definition.defaultBaseUrl,
    temperature: AI_DEFAULTS.temperature,
    maxOutputTokens: AI_DEFAULTS.maxOutputTokens,
    source: "environment",
  };
}

export type AIStatus = {
  enabled: boolean;
  provider: AIProviderId | null;
  model: string | null;
  source: "database" | "environment" | null;
};

/**
 * Whether the assist features should be offered, and by whom.
 *
 * Cached and tagged, because it is read on several admin screens per request
 * and holds nothing secret — the key is not selected here at any point.
 */
export const aiStatus = unstable_cache(
  async (): Promise<AIStatus> => {
    const config = await activeAIConfig();
    if (!config) return { enabled: false, provider: null, model: null, source: null };
    return {
      enabled: true,
      provider: config.provider,
      model: config.model,
      source: config.source,
    };
  },
  ["ai-status"],
  { revalidate: 300, tags: [AI_SETTINGS_TAG] },
);
