import "dotenv/config";

// Integration tests run against a separate database so a test run can never
// touch development data.
const testUrl = process.env["TEST_DATABASE_URL"];
if (testUrl) {
  process.env["DATABASE_URL"] = testUrl;
}
// NODE_ENV is typed read-only; assign through the index signature.
Object.assign(process.env, { NODE_ENV: "test" });
process.env["AUTH_SECRET"] ??= "test-secret-at-least-thirty-two-characters";
// Unit tests that import a server module still go through `env()`, which
// requires this key even when nothing connects. Integration tests overwrite it
// from TEST_DATABASE_URL above, so this placeholder is only ever the value when
// no database is involved.
process.env["DATABASE_URL"] ??= "postgresql://unused:unused@127.0.0.1:5432/unused";
