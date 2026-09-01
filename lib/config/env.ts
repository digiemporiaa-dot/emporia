import "server-only";
import { z } from "zod";

/**
 * The single place environment variables are read and validated.
 *
 * Nothing else in the codebase touches `process.env` (CLAUDE.md 2 rule 6), so a
 * `NEXT_PUBLIC_` leak of a credential becomes a visible change to this one file.
 *
 * Validation is lazy rather than at module load: `next build` runs without a
 * database or secrets, and crashing the build on missing runtime config would
 * be wrong. The server instead fails fast at boot via `instrumentation.ts`,
 * which calls `assertEnv()`.
 */

const booleanish = z
  .string()
  .transform((v) => v === "1" || v.toLowerCase() === "true")
  .pipe(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Required for the app to function at all.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_URL: z.string().url().optional(),
  NEXTAUTH_URL: z.string().url().optional(),

  // Public site origin, used to derive canonical URLs (CLAUDE.md 9).
  SITE_URL: z.string().url().default("http://localhost:3000"),

  // Optional integrations. Absent means "not configured", which surfaces as a
  // typed IntegrationNotConfiguredError — never a silent fake success
  // (CLAUDE.md 2 rule 5).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: booleanish.optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  SHIPROCKET_EMAIL: z.string().optional(),
  SHIPROCKET_PASSWORD: z.string().optional(),

  AI_PROVIDER: z.string().optional(),
  AI_API_KEY: z.string().optional(),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Seed credentials. Never hardcoded (docs/BUILD-PLAN.md, Seed data).
  SEED_SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
  SEED_SUPER_ADMIN_NAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parsed env. Throws a readable aggregate error if required keys are missing. */
export function env(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n` +
        `See .env.example for the full list of keys.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Called from instrumentation.ts so a misconfigured container dies at boot. */
export function assertEnv(): void {
  env();
}

/** Test seam: clears the memoised parse. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => env().NODE_ENV === "production";
export const isTest = (): boolean => env().NODE_ENV === "test";

/**
 * Integration readiness. Each returns null when the provider is unconfigured,
 * so callers raise IntegrationNotConfiguredError rather than inventing success.
 */
export function smtpConfig() {
  const e = env();
  if (!e.SMTP_HOST || !e.SMTP_PORT || !e.SMTP_FROM) return null;
  return {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    user: e.SMTP_USER,
    password: e.SMTP_PASSWORD,
    from: e.SMTP_FROM,
    secure: e.SMTP_SECURE ?? false,
  };
}

export function r2Config() {
  const e = env();
  if (
    !e.R2_ACCOUNT_ID ||
    !e.R2_ACCESS_KEY_ID ||
    !e.R2_SECRET_ACCESS_KEY ||
    !e.R2_BUCKET_NAME ||
    !e.R2_PUBLIC_URL
  ) {
    return null;
  }
  return {
    accountId: e.R2_ACCOUNT_ID,
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    bucket: e.R2_BUCKET_NAME,
    publicUrl: e.R2_PUBLIC_URL,
  };
}

export function razorpayConfig() {
  const e = env();
  if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET || !e.RAZORPAY_WEBHOOK_SECRET) {
    return null;
  }
  return {
    keyId: e.RAZORPAY_KEY_ID,
    keySecret: e.RAZORPAY_KEY_SECRET,
    webhookSecret: e.RAZORPAY_WEBHOOK_SECRET,
  };
}

export function aiConfig() {
  const e = env();
  if (!e.AI_PROVIDER || !e.AI_API_KEY) return null;
  return { provider: e.AI_PROVIDER, apiKey: e.AI_API_KEY };
}
