import "server-only";
import { revalidateTag } from "next/cache";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { record } from "@/lib/services/audit.service";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/tracking/secret";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { Actor } from "@/lib/actor/types";
import type { ConsentMode, TrackingSettingsInput } from "@/lib/validation/tracking";

/**
 * Tracking and pixel settings.
 *
 * Stored in `IntegrationSetting`, the existing provider/config/isEnabled model,
 * one row per provider. It was already the right shape and had no rows, so this
 * extends it rather than adding a second settings table (CLAUDE.md 2 rule 10).
 *
 * There are two ways to read these settings and they are deliberately different
 * functions, not one with a flag:
 *
 *   getTrackingSettings   admin only, permission-checked, token masked
 *   publicTrackingConfig  unauthenticated, cached, public IDs only
 *
 * `publicTrackingConfig` cannot return the Conversions API token because it
 * never selects it. That is the whole defence: a mistake in a component cannot
 * leak what the query did not fetch (CLAUDE.md 2 rule 6).
 */

export const TRACKING_TAG = "tracking-settings";

/** One row per provider. Adding a provider means adding a key here. */
export const PROVIDERS = [
  "gtm",
  "ga4",
  "googleAds",
  "googleSiteVerification",
  "metaPixel",
  "metaCapi",
  "clarity",
  "hotjar",
  "pinterest",
  "tiktok",
  "snapchat",
  "consent",
] as const;
export type Provider = (typeof PROVIDERS)[number];

type Row = { provider: string; isEnabled: boolean; config: unknown };

function configOf(rows: readonly Row[], provider: Provider): Record<string, unknown> {
  const row = rows.find((r) => r.provider === provider);
  return row && row.config && typeof row.config === "object"
    ? (row.config as Record<string, unknown>)
    : {};
}

function enabledOf(rows: readonly Row[], provider: Provider): boolean {
  return rows.find((r) => r.provider === provider)?.isEnabled ?? false;
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

// ---------------------------------------------------------------------------
// Admin read
// ---------------------------------------------------------------------------

export type AdminTrackingSettings = TrackingSettingsInput & {
  /** Masked, never the token. Null when none is stored. */
  capiTokenMasked: string | null;
  /** True when a token exists but no longer decrypts — AUTH_SECRET rotated. */
  capiTokenUnreadable: boolean;
};

export async function getTrackingSettings(actor: Actor): Promise<AdminTrackingSettings> {
  requirePermission(actor, "settings.view");

  const rows = await db.integrationSetting.findMany({
    where: { provider: { in: [...PROVIDERS] } },
    select: { provider: true, isEnabled: true, config: true },
  });

  const capi = configOf(rows, "metaCapi");
  const storedToken = str(capi["token"]);
  const plainToken = decryptSecret(storedToken);

  const consent = configOf(rows, "consent");

  return {
    gtmEnabled: enabledOf(rows, "gtm"),
    gtmId: str(configOf(rows, "gtm")["id"]),

    ga4Enabled: enabledOf(rows, "ga4"),
    ga4Id: str(configOf(rows, "ga4")["id"]),

    googleAdsEnabled: enabledOf(rows, "googleAds"),
    googleAdsId: str(configOf(rows, "googleAds")["id"]),
    googleAdsLabelEnabled: Boolean(configOf(rows, "googleAds")["labelEnabled"]),
    googleAdsLabel: str(configOf(rows, "googleAds")["label"]),

    googleSiteVerificationEnabled: enabledOf(rows, "googleSiteVerification"),
    googleSiteVerification: str(configOf(rows, "googleSiteVerification")["content"]),

    metaPixelEnabled: enabledOf(rows, "metaPixel"),
    metaPixelId: str(configOf(rows, "metaPixel")["id"]),

    clarityEnabled: enabledOf(rows, "clarity"),
    clarityId: str(configOf(rows, "clarity")["id"]),

    hotjarEnabled: enabledOf(rows, "hotjar"),
    hotjarId: str(configOf(rows, "hotjar")["id"]),

    pinterestEnabled: enabledOf(rows, "pinterest"),
    pinterestId: str(configOf(rows, "pinterest")["id"]),

    tiktokEnabled: enabledOf(rows, "tiktok"),
    tiktokId: str(configOf(rows, "tiktok")["id"]),

    snapchatEnabled: enabledOf(rows, "snapchat"),
    snapchatId: str(configOf(rows, "snapchat")["id"]),

    consentMode: (str(consent["mode"]) as ConsentMode | null) ?? "IMPLIED",
    consentBannerText: str(consent["bannerText"]),

    capiPurchasesEnabled: enabledOf(rows, "metaCapi"),
    capiTokenMasked: maskSecret(plainToken),
    // A stored value that will not decrypt is a real state an admin has to be
    // told about, not silently treated as "no token".
    capiTokenUnreadable: Boolean(storedToken) && plainToken === null,
  };
}

// ---------------------------------------------------------------------------
// Admin write
// ---------------------------------------------------------------------------

async function upsert(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  provider: Provider,
  isEnabled: boolean,
  config: Record<string, unknown>,
) {
  await tx.integrationSetting.upsert({
    where: { provider },
    create: { provider, isEnabled, config: config as InputJsonValue },
    update: { isEnabled, config: config as InputJsonValue },
  });
}

export async function updateTrackingSettings(actor: Actor, input: TrackingSettingsInput) {
  requirePermission(actor, "settings.edit");

  const before = await getTrackingSettings(actor);

  await db.$transaction(async (tx) => {
    await upsert(tx, "gtm", input.gtmEnabled, { id: input.gtmId });
    await upsert(tx, "ga4", input.ga4Enabled, { id: input.ga4Id });
    await upsert(tx, "googleAds", input.googleAdsEnabled, {
      id: input.googleAdsId,
      label: input.googleAdsLabel,
      labelEnabled: input.googleAdsLabelEnabled,
    });
    await upsert(tx, "googleSiteVerification", input.googleSiteVerificationEnabled, {
      content: input.googleSiteVerification,
    });
    await upsert(tx, "metaPixel", input.metaPixelEnabled, { id: input.metaPixelId });
    await upsert(tx, "clarity", input.clarityEnabled, { id: input.clarityId });
    await upsert(tx, "hotjar", input.hotjarEnabled, { id: input.hotjarId });
    await upsert(tx, "pinterest", input.pinterestEnabled, { id: input.pinterestId });
    await upsert(tx, "tiktok", input.tiktokEnabled, { id: input.tiktokId });
    await upsert(tx, "snapchat", input.snapchatEnabled, { id: input.snapchatId });

    // The consent version changes whenever the mode or the wording changes, so
    // a visitor who agreed to the old terms is asked again
    // (docs/ARCHITECTURE.md 14A.4).
    const existing = await tx.integrationSetting.findUnique({
      where: { provider: "consent" },
      select: { config: true },
    });
    const previous = (existing?.config ?? {}) as Record<string, unknown>;
    const changed =
      previous["mode"] !== input.consentMode ||
      (previous["bannerText"] ?? null) !== input.consentBannerText;
    const version =
      typeof previous["version"] === "number"
        ? previous["version"] + (changed ? 1 : 0)
        : 1;

    await upsert(tx, "consent", true, {
      mode: input.consentMode,
      bannerText: input.consentBannerText,
      version,
    });

    // The CAPI row carries the token; this must never overwrite it.
    const capi = await tx.integrationSetting.findUnique({
      where: { provider: "metaCapi" },
      select: { config: true },
    });
    const capiConfig = (capi?.config ?? {}) as Record<string, unknown>;
    await upsert(tx, "metaCapi", input.capiPurchasesEnabled, {
      ...capiConfig,
    });

    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "TrackingSettings",
        entityId: "tracking",
        // The token is not in either snapshot: `getTrackingSettings` masks it
        // and the write path never reads it. Nothing here can log a secret.
        before,
        after: { ...input },
      },
      tx,
    );
  });

  revalidateTag(TRACKING_TAG);
  return getTrackingSettings(actor);
}

/** Save the Conversions API token. Encrypted before it touches the database. */
export async function saveCapiToken(actor: Actor, token: string) {
  requirePermission(actor, "settings.edit");

  const existing = await db.integrationSetting.findUnique({
    where: { provider: "metaCapi" },
    select: { isEnabled: true, config: true },
  });
  const config = (existing?.config ?? {}) as Record<string, unknown>;

  await db.$transaction(async (tx) => {
    await upsert(tx, "metaCapi", existing?.isEnabled ?? false, {
      ...config,
      token: encryptSecret(token),
    });
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "TrackingSettings",
        entityId: "metaCapi",
        // Deliberately records that a token was set, never the token.
        after: { capiToken: "set" },
      },
      tx,
    );
  });

  revalidateTag(TRACKING_TAG);
}

export async function clearCapiToken(actor: Actor) {
  requirePermission(actor, "settings.edit");

  const existing = await db.integrationSetting.findUnique({
    where: { provider: "metaCapi" },
    select: { config: true },
  });
  const config = (existing?.config ?? {}) as Record<string, unknown>;
  delete config["token"];

  await db.$transaction(async (tx) => {
    // Removing the token also switches server-side purchases off: leaving them
    // on would mean every purchase attempting a send that cannot succeed.
    await upsert(tx, "metaCapi", false, config);
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "TrackingSettings",
        entityId: "metaCapi",
        after: { capiToken: "removed" },
      },
      tx,
    );
  });

  revalidateTag(TRACKING_TAG);
}

// ---------------------------------------------------------------------------
// Public read
// ---------------------------------------------------------------------------

export type PublicTrackingConfig = {
  gtmId: string | null;
  ga4Id: string | null;
  googleAdsId: string | null;
  googleAdsLabel: string | null;
  metaPixelId: string | null;
  clarityId: string | null;
  hotjarId: string | null;
  pinterestId: string | null;
  tiktokId: string | null;
  snapchatId: string | null;
  siteVerification: string | null;
  consent: { mode: ConsentMode; bannerText: string | null; version: number };
};

/**
 * What the public site is allowed to know.
 *
 * Only IDs that are meant to appear in page source, and only for providers that
 * are both configured and enabled — so a disabled provider is absent from the
 * payload rather than present and skipped in the browser.
 *
 * The Conversions API token is not selected here at any point.
 */
export const publicTrackingConfig = unstable_cache(
  async (): Promise<PublicTrackingConfig> => {
    const rows = await db.integrationSetting.findMany({
      where: { provider: { in: [...PROVIDERS] } },
      select: { provider: true, isEnabled: true, config: true },
    });

    const on = (provider: Provider, valueKey = "id"): string | null =>
      enabledOf(rows, provider) ? str(configOf(rows, provider)[valueKey]) : null;

    const consent = configOf(rows, "consent");
    const googleAds = configOf(rows, "googleAds");

    return {
      gtmId: on("gtm"),
      ga4Id: on("ga4"),
      googleAdsId: on("googleAds"),
      googleAdsLabel:
        enabledOf(rows, "googleAds") && googleAds["labelEnabled"]
          ? str(googleAds["label"])
          : null,
      metaPixelId: on("metaPixel"),
      clarityId: on("clarity"),
      hotjarId: on("hotjar"),
      pinterestId: on("pinterest"),
      tiktokId: on("tiktok"),
      snapchatId: on("snapchat"),
      siteVerification: on("googleSiteVerification", "content"),
      consent: {
        mode: (str(consent["mode"]) as ConsentMode | null) ?? "IMPLIED",
        bannerText: str(consent["bannerText"]),
        version: typeof consent["version"] === "number" ? consent["version"] : 1,
      },
    };
  },
  ["public-tracking-config"],
  { revalidate: 3600, tags: [TRACKING_TAG] },
);

/**
 * The Conversions API credential, for server-side sending only.
 *
 * Not cached and not exported through any public path. Callers are server
 * modules that post to Meta; nothing renders this.
 */
export async function capiCredentials(): Promise<{ pixelId: string; token: string } | null> {
  const rows = await db.integrationSetting.findMany({
    where: { provider: { in: ["metaCapi", "metaPixel"] } },
    select: { provider: true, isEnabled: true, config: true },
  });

  if (!enabledOf(rows, "metaCapi")) return null;

  const pixelId = str(configOf(rows, "metaPixel")["id"]);
  const token = decryptSecret(str(configOf(rows, "metaCapi")["token"]));
  if (!pixelId || !token) return null;

  return { pixelId, token };
}
