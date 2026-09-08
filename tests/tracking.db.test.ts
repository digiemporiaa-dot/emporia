import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  PROVIDERS,
  capiCredentials,
  clearCapiToken,
  getTrackingSettings,
  publicTrackingConfig,
  saveCapiToken,
  updateTrackingSettings,
} from "@/lib/services/tracking.service";
import { trackingSettingsSchema } from "@/lib/validation/tracking";
import type { Actor } from "@/lib/actor/types";

/**
 * Tracking settings service.
 *
 * The properties under test are the ones a mistake here would breach: the
 * token never reaches a public read, permissions are enforced in the service
 * rather than the page, an unrelated edit does not wipe the token, and the
 * audit trail records that a token changed without recording the token.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const TOKEN = `EAA${"z".repeat(40)}7Bq1`;

function actorWith(permissions: string[]): Actor {
  return {
    userId,
    name: "Marketing manager",
    email: null,
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

/** The audit row carries a real foreign key, so the actor needs a real user. */
let userId = "";
let admin: Actor;
let reader: Actor;
let outsider: Actor;

const BLANK = trackingSettingsSchema.parse({
  gtmId: "",
  ga4Id: "",
  googleAdsId: "",
  googleAdsLabel: "",
  googleSiteVerification: "",
  metaPixelId: "",
  clarityId: "",
  hotjarId: "",
  pinterestId: "",
  tiktokId: "",
  snapchatId: "",
  consentBannerText: "",
});

describeDb("tracking settings", () => {
  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    admin = actorWith(["settings.view", "settings.edit"]);
    reader = actorWith(["settings.view"]);
    outsider = actorWith(["leads.view"]);
  });

  beforeEach(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: { in: [...PROVIDERS] } } });
    await db.auditLog.deleteMany({ where: { entityType: "TrackingSettings" } });
  });

  afterEach(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: { in: [...PROVIDERS] } } });
    await db.auditLog.deleteMany({ where: { entityType: "TrackingSettings" } });
  });

  it("returns empty settings before anything is configured", async () => {
    const settings = await getTrackingSettings(admin);
    expect(settings.ga4Id).toBeNull();
    expect(settings.consentMode).toBe("IMPLIED");
    expect(settings.capiTokenMasked).toBeNull();
    expect(settings.capiTokenUnreadable).toBe(false);
  });

  it("saves and reads back a configuration", async () => {
    await updateTrackingSettings(admin, {
      ...BLANK,
      ga4Enabled: true,
      ga4Id: "G-AB12CD34EF",
      metaPixelEnabled: true,
      metaPixelId: "123456789012345",
      consentMode: "OPT_IN",
      consentBannerText: "We use cookies.",
    });

    const settings = await getTrackingSettings(admin);
    expect(settings.ga4Id).toBe("G-AB12CD34EF");
    expect(settings.ga4Enabled).toBe(true);
    expect(settings.metaPixelId).toBe("123456789012345");
    expect(settings.consentMode).toBe("OPT_IN");
  });

  it("stores one row per provider rather than a second settings table", async () => {
    await updateTrackingSettings(admin, { ...BLANK, ga4Id: "G-AB12CD34EF" });
    const rows = await db.integrationSetting.findMany({ where: { provider: "ga4" } });
    expect(rows).toHaveLength(1);

    await updateTrackingSettings(admin, { ...BLANK, ga4Id: "G-ZZ99YY88XX" });
    const after = await db.integrationSetting.findMany({ where: { provider: "ga4" } });
    expect(after).toHaveLength(1);
    expect((after[0]!.config as { id: string }).id).toBe("G-ZZ99YY88XX");
  });

  describe("authorization", () => {
    it("refuses a read without settings.view", async () => {
      await expect(getTrackingSettings(outsider)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses a write with only settings.view", async () => {
      await expect(updateTrackingSettings(reader, BLANK)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses to save or clear a token without settings.edit", async () => {
      await expect(saveCapiToken(reader, TOKEN)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(clearCapiToken(reader)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("the conversions api token", () => {
    it("is never stored in plain text", async () => {
      await saveCapiToken(admin, TOKEN);
      const row = await db.integrationSetting.findUnique({ where: { provider: "metaCapi" } });
      expect(JSON.stringify(row?.config)).not.toContain(TOKEN);
    });

    it("is masked for the admin, never returned", async () => {
      await saveCapiToken(admin, TOKEN);
      const settings = await getTrackingSettings(admin);
      expect(settings.capiTokenMasked).toBe(`••••••••••••${TOKEN.slice(-4)}`);
      expect(JSON.stringify(settings)).not.toContain(TOKEN);
    });

    it("is absent from the public configuration entirely", async () => {
      await saveCapiToken(admin, TOKEN);
      await updateTrackingSettings(admin, {
        ...BLANK,
        metaPixelEnabled: true,
        metaPixelId: "123456789012345",
        capiPurchasesEnabled: true,
      });

      const config = await publicTrackingConfig();
      const serialised = JSON.stringify(config);
      expect(serialised).not.toContain(TOKEN);
      expect(serialised).not.toContain("token");
      expect(config.metaPixelId).toBe("123456789012345");
    });

    it("survives an unrelated settings edit", async () => {
      await saveCapiToken(admin, TOKEN);
      await updateTrackingSettings(admin, { ...BLANK, ga4Id: "G-AB12CD34EF" });

      const settings = await getTrackingSettings(admin);
      expect(settings.capiTokenMasked).not.toBeNull();
    });

    it("is available to the server-side sender once enabled", async () => {
      await updateTrackingSettings(admin, {
        ...BLANK,
        metaPixelEnabled: true,
        metaPixelId: "123456789012345",
        capiPurchasesEnabled: true,
      });
      await saveCapiToken(admin, TOKEN);

      await expect(capiCredentials()).resolves.toEqual({
        pixelId: "123456789012345",
        token: TOKEN,
      });
    });

    it("is withheld from the sender while server-side purchases are off", async () => {
      await updateTrackingSettings(admin, {
        ...BLANK,
        metaPixelEnabled: true,
        metaPixelId: "123456789012345",
        capiPurchasesEnabled: false,
      });
      await saveCapiToken(admin, TOKEN);

      await expect(capiCredentials()).resolves.toBeNull();
    });

    it("switches server-side purchases off when removed", async () => {
      await updateTrackingSettings(admin, {
        ...BLANK,
        metaPixelEnabled: true,
        metaPixelId: "123456789012345",
        capiPurchasesEnabled: true,
      });
      await saveCapiToken(admin, TOKEN);
      await clearCapiToken(admin);

      const settings = await getTrackingSettings(admin);
      expect(settings.capiTokenMasked).toBeNull();
      expect(settings.capiPurchasesEnabled).toBe(false);
      await expect(capiCredentials()).resolves.toBeNull();
    });

    it("records that a token changed without recording the token", async () => {
      await saveCapiToken(admin, TOKEN);
      const entries = await db.auditLog.findMany({ where: { entityType: "TrackingSettings" } });
      expect(entries.length).toBeGreaterThan(0);
      expect(JSON.stringify(entries)).not.toContain(TOKEN);
      expect(JSON.stringify(entries)).toContain("set");
    });
  });

  describe("the public configuration", () => {
    it("omits a provider that is configured but switched off", async () => {
      await updateTrackingSettings(admin, {
        ...BLANK,
        ga4Id: "G-AB12CD34EF",
        ga4Enabled: false,
        hotjarEnabled: true,
        hotjarId: "1234567",
      });

      const config = await publicTrackingConfig();
      expect(config.ga4Id).toBeNull();
      expect(config.hotjarId).toBe("1234567");
    });

    it("withholds a conversion label whose own toggle is off", async () => {
      await updateTrackingSettings(admin, {
        ...BLANK,
        googleAdsEnabled: true,
        googleAdsId: "AW-123456789",
        googleAdsLabel: "AbCdEfGh",
        googleAdsLabelEnabled: false,
      });

      const config = await publicTrackingConfig();
      expect(config.googleAdsId).toBe("AW-123456789");
      expect(config.googleAdsLabel).toBeNull();
    });
  });

  describe("the consent version", () => {
    it("moves when the mode changes, so a visitor is asked again", async () => {
      await updateTrackingSettings(admin, { ...BLANK, consentMode: "IMPLIED" });
      const first = (await publicTrackingConfig()).consent.version;

      await updateTrackingSettings(admin, { ...BLANK, consentMode: "OPT_IN" });
      const second = (await publicTrackingConfig()).consent.version;

      expect(second).toBeGreaterThan(first);
    });

    it("moves when the wording changes", async () => {
      await updateTrackingSettings(admin, { ...BLANK, consentBannerText: "One wording." });
      const first = (await publicTrackingConfig()).consent.version;

      await updateTrackingSettings(admin, { ...BLANK, consentBannerText: "Another wording." });
      expect((await publicTrackingConfig()).consent.version).toBeGreaterThan(first);
    });

    it("stays put when something unrelated is edited", async () => {
      await updateTrackingSettings(admin, { ...BLANK, consentMode: "OPT_IN" });
      const first = (await publicTrackingConfig()).consent.version;

      await updateTrackingSettings(admin, {
        ...BLANK,
        consentMode: "OPT_IN",
        clarityId: "abcd1234xy",
      });
      expect((await publicTrackingConfig()).consent.version).toBe(first);
    });
  });
});
