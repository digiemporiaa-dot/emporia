import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  activeAIConfig,
  aiStatus,
  clearAIApiKey,
  getAISettings,
  saveAIApiKey,
  updateAISettings,
} from "@/lib/services/ai-settings.service";
import { ai } from "@/lib/ai";
import { resetEnvCache } from "@/lib/config/env";
import type { Actor } from "@/lib/actor/types";

/**
 * Admin-managed AI configuration.
 *
 * What is tested is what a mistake here would breach: the API key never leaves
 * the server readable, an unrelated save cannot clear it, the provider can be
 * switched without a deploy, and a deployment still running on environment
 * variables keeps working.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const KEY = `AIza${"x".repeat(30)}7Bq1`;
const OTHER_KEY = `sk-ant-${"y".repeat(40)}`;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Admin",
    email: null,
    type: "STAFF",
    roleName: "ADMIN",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const GEMINI = {
  enabled: true,
  provider: "gemini" as const,
  model: "gemini-flash-latest",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  temperature: 0.7,
  maxOutputTokens: 2048,
};

describeDb("AI settings", () => {
  let admin: Actor;
  let reader: Actor;
  let outsider: Actor;

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    admin = actorWith(user.id, ["settings.view", "settings.edit"]);
    reader = actorWith(user.id, ["settings.view"]);
    outsider = actorWith(user.id, ["leads.view"]);
  });

  afterEach(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "ai" } });
    await db.auditLog.deleteMany({ where: { entityType: "AISettings" } });
  });

  afterAll(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "ai" } });
    await db.auditLog.deleteMany({ where: { entityType: "AISettings" } });
  });

  describe("persistence", () => {
    it("saves and reads back a configuration", async () => {
      await updateAISettings(admin, GEMINI);
      const settings = await getAISettings(admin);

      expect(settings).toMatchObject({
        enabled: true,
        provider: "gemini",
        model: "gemini-flash-latest",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        temperature: 0.7,
        maxOutputTokens: 2048,
      });
    });

    it("keeps one global configuration rather than a row per save", async () => {
      await updateAISettings(admin, GEMINI);
      await updateAISettings(admin, { ...GEMINI, model: "gemini-1.5-pro" });

      const rows = await db.integrationSetting.findMany({ where: { provider: "ai" } });
      expect(rows).toHaveLength(1);
      expect((await getAISettings(admin)).model).toBe("gemini-1.5-pro");
    });

    it("switches provider without touching anything else", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);

      await updateAISettings(admin, {
        ...GEMINI,
        provider: "anthropic",
        model: "claude-opus-5",
        baseUrl: "https://api.anthropic.com",
      });

      const settings = await getAISettings(admin);
      expect(settings.provider).toBe("anthropic");
      // The key survives a provider change: an admin who switches back should
      // not have to paste it again.
      expect(settings.apiKeyMasked).not.toBeNull();
    });
  });

  describe("the API key", () => {
    it("is never stored in plain text", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);

      const row = await db.integrationSetting.findUnique({ where: { provider: "ai" } });
      expect(JSON.stringify(row?.config)).not.toContain(KEY);
    });

    it("comes back masked, never whole", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);

      const settings = await getAISettings(admin);
      expect(settings.apiKeyMasked).toBe(`••••••••••••${KEY.slice(-4)}`);
      // The whole object is checked, not just the field: a key leaking through
      // some other property is the failure worth catching.
      expect(JSON.stringify(settings)).not.toContain(KEY);
    });

    it("survives a settings save that leaves the key field empty", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);

      // The settings form carries no key at all — this is the save it performs.
      await updateAISettings(admin, { ...GEMINI, temperature: 0.2 });

      const config = await activeAIConfig();
      expect(config?.apiKey).toBe(KEY);
      expect(config?.temperature).toBe(0.2);
    });

    it("is replaced when a new one is entered", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);
      await saveAIApiKey(admin, OTHER_KEY);

      expect((await activeAIConfig())?.apiKey).toBe(OTHER_KEY);
    });

    it("switches AI off when removed", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);
      await clearAIApiKey(admin);

      const settings = await getAISettings(admin);
      expect(settings.apiKeyMasked).toBeNull();
      expect(settings.enabled).toBe(false);
      expect(await activeAIConfig()).toBeNull();
    });

    it("is recorded in the audit trail without being recorded", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);

      const entries = await db.auditLog.findMany({ where: { entityType: "AISettings" } });
      expect(entries.length).toBeGreaterThan(0);
      expect(JSON.stringify(entries)).not.toContain(KEY);
      // The trail says a key was set, without saying what it was — and the
      // audit layer redacts anything named `apiKey` on top of that.
      expect(JSON.stringify(entries)).toContain('"change":"set"');
    });
  });

  describe("what the runtime resolves", () => {
    it("hands the provider the saved configuration", async () => {
      await updateAISettings(admin, { ...GEMINI, model: "gemini-1.5-flash", temperature: 0.3 });
      await saveAIApiKey(admin, KEY);

      const config = await activeAIConfig();
      expect(config).toMatchObject({
        provider: "gemini",
        model: "gemini-1.5-flash",
        temperature: 0.3,
        source: "database",
      });
      expect((await ai()).describe).toContain("gemini-1.5-flash");
    });

    it("reports nothing when AI is switched off", async () => {
      await updateAISettings(admin, { ...GEMINI, enabled: false });
      await saveAIApiKey(admin, KEY);

      expect(await activeAIConfig()).toBeNull();
      expect((await ai()).configured).toBe(false);
    });

    it("reports nothing when enabled with no key", async () => {
      await updateAISettings(admin, GEMINI);
      expect(await activeAIConfig()).toBeNull();
    });

    it("does not fall back to the environment once a row exists", async () => {
      // Falling through would answer from a different account than the screen
      // shows, which is worse than reporting the configuration as unusable.
      process.env["AI_PROVIDER"] = "anthropic";
      process.env["AI_API_KEY"] = "env-key";
      resetEnvCache();

      await updateAISettings(admin, GEMINI); // enabled, but no key saved
      expect(await activeAIConfig()).toBeNull();

      delete process.env["AI_PROVIDER"];
      delete process.env["AI_API_KEY"];
      resetEnvCache();
    });

    it("uses the environment when nothing has been configured here", async () => {
      process.env["AI_PROVIDER"] = "anthropic";
      process.env["AI_API_KEY"] = "env-key";
      resetEnvCache();

      const config = await activeAIConfig();
      expect(config).toMatchObject({ provider: "anthropic", source: "environment" });

      delete process.env["AI_PROVIDER"];
      delete process.env["AI_API_KEY"];
      resetEnvCache();
    });

    it("says so on the admin screen when the environment is what is running", async () => {
      process.env["AI_PROVIDER"] = "anthropic";
      process.env["AI_API_KEY"] = "env-key";
      resetEnvCache();

      const settings = await getAISettings(admin);
      expect(settings.usingEnvFallback).toBe(true);
      expect(settings.apiKeyMasked).not.toContain("env-key");

      delete process.env["AI_PROVIDER"];
      delete process.env["AI_API_KEY"];
      resetEnvCache();
    });

    it("exposes no secret in the cached status", async () => {
      await updateAISettings(admin, GEMINI);
      await saveAIApiKey(admin, KEY);

      const status = await aiStatus();
      expect(status).toMatchObject({ enabled: true, provider: "gemini" });
      expect(JSON.stringify(status)).not.toContain(KEY);
      expect(JSON.stringify(status)).not.toContain("apiKey");
    });
  });

  describe("authorization", () => {
    it("refuses a read without settings.view", async () => {
      await expect(getAISettings(outsider)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses a write with only settings.view", async () => {
      await expect(updateAISettings(reader, GEMINI)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses to save or clear a key without settings.edit", async () => {
      await expect(saveAIApiKey(reader, KEY)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(clearAIApiKey(reader)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
