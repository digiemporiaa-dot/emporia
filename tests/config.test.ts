import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache, r2Config, razorpayConfig, smtpConfig } from "@/lib/config/env";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

describe("environment validation", () => {
  it("rejects a missing DATABASE_URL rather than starting half-configured", () => {
    delete process.env["DATABASE_URL"];
    resetEnvCache();
    expect(() => env()).toThrow(/DATABASE_URL/);
  });

  it("rejects a short AUTH_SECRET", () => {
    process.env["AUTH_SECRET"] = "too-short";
    resetEnvCache();
    expect(() => env()).toThrow(/AUTH_SECRET/);
  });

  it("lists every problem at once, not just the first", () => {
    delete process.env["DATABASE_URL"];
    process.env["AUTH_SECRET"] = "short";
    resetEnvCache();
    expect(() => env()).toThrow(/DATABASE_URL[\s\S]*AUTH_SECRET/);
  });
});

describe("integration readiness", () => {
  it("reports SMTP as unconfigured when keys are absent", () => {
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM"]) delete process.env[key];
    resetEnvCache();
    expect(smtpConfig()).toBeNull();
  });

  it("reports R2 as unconfigured when partially set", () => {
    process.env["R2_ACCOUNT_ID"] = "acct";
    delete process.env["R2_BUCKET_NAME"];
    resetEnvCache();
    expect(r2Config()).toBeNull();
  });

  it("reports Razorpay as unconfigured without a webhook secret", () => {
    process.env["RAZORPAY_KEY_ID"] = "key";
    process.env["RAZORPAY_KEY_SECRET"] = "secret";
    delete process.env["RAZORPAY_WEBHOOK_SECRET"];
    resetEnvCache();
    expect(razorpayConfig()).toBeNull();
  });

  it("returns config once every key is present", () => {
    process.env["SMTP_HOST"] = "smtp.example.com";
    process.env["SMTP_PORT"] = "587";
    process.env["SMTP_FROM"] = "hello@example.com";
    resetEnvCache();
    expect(smtpConfig()).toMatchObject({ host: "smtp.example.com", port: 587 });
  });
});
