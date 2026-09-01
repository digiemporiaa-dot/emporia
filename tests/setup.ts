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
