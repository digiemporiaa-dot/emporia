import "dotenv/config";
import { execFileSync } from "node:child_process";

/**
 * Prepares the test database once per run: applies committed migrations and
 * seeds roles, permissions and the super admin.
 *
 * Uses a *separate* database (TEST_DATABASE_URL) so a test run can never touch
 * development data. Integration tests here run against real Postgres rather
 * than a mock — Docker/testcontainers is unavailable in this environment
 * (docs/ARCHITECTURE.md 18).
 */
export default async function setup(): Promise<void> {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) {
    console.warn("TEST_DATABASE_URL not set — database integration tests will be skipped.");
    return;
  }

  const env = {
    ...process.env,
    DATABASE_URL: url,
    // The seed reads these; keep them distinct from any real credentials.
    SEED_SUPER_ADMIN_EMAIL: "test-admin@emporia.test",
    SEED_SUPER_ADMIN_PASSWORD: "test-password-1234",
    SEED_SUPER_ADMIN_NAME: "Test Admin",
  };

  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { env, stdio: "inherit" });
}
