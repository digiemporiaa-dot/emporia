import { afterAll, afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/utils/rate-limit";
import { db } from "@/lib/db";

/**
 * Rate limiting, against the real shared store.
 *
 * The window lives in Postgres so the limit is the limit however many instances
 * are running. These run against the database for that reason: an in-memory
 * double would test the thing that was replaced.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("rate limiting", () => {
  afterEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("allows up to the limit then blocks", async () => {
    const key = "test:allow";
    for (let i = 0; i < 5; i += 1) {
      expect((await checkRateLimit(key, { limit: 5, windowMs: 60_000 })).allowed).toBe(true);
    }
    expect((await checkRateLimit(key, { limit: 5, windowMs: 60_000 })).allowed).toBe(false);
  });

  it("reports remaining attempts", async () => {
    const key = "test:remaining";
    expect((await checkRateLimit(key, { limit: 3, windowMs: 60_000 })).remaining).toBe(2);
    expect((await checkRateLimit(key, { limit: 3, windowMs: 60_000 })).remaining).toBe(1);
    expect((await checkRateLimit(key, { limit: 3, windowMs: 60_000 })).remaining).toBe(0);
  });

  it("gives a retry-after only once blocked", async () => {
    const key = "test:retry";
    expect((await checkRateLimit(key, { limit: 1, windowMs: 60_000 })).retryAfterSeconds).toBe(0);
    const blocked = await checkRateLimit(key, { limit: 1, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate keys independent, so one user cannot lock out another", async () => {
    await checkRateLimit("ip:1.1.1.1", { limit: 1, windowMs: 60_000 });
    expect((await checkRateLimit("ip:1.1.1.1", { limit: 1, windowMs: 60_000 })).allowed).toBe(false);
    expect((await checkRateLimit("ip:2.2.2.2", { limit: 1, windowMs: 60_000 })).allowed).toBe(true);
  });

  it("opens a fresh window after the previous one expires", async () => {
    const key = "test:window";
    expect((await checkRateLimit(key, { limit: 1, windowMs: 300 })).allowed).toBe(true);
    expect((await checkRateLimit(key, { limit: 1, windowMs: 300 })).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await checkRateLimit(key, { limit: 1, windowMs: 300 })).allowed).toBe(true);
  });

  it("counts concurrent requests exactly once each", async () => {
    const key = "test:concurrent";

    // Twenty at once against a limit of five. A read-then-write limiter lets
    // several through together; the single upsert statement cannot.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => checkRateLimit(key, { limit: 5, windowMs: 60_000 })),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(15);
  });

  it("shares one window across callers, as separate instances would", async () => {
    const key = "test:shared";
    await checkRateLimit(key, { limit: 2, windowMs: 60_000 });

    // The count is a row, not process state — so it is visible to anything
    // else talking to the same database.
    const row = await db.rateLimitWindow.findUnique({ where: { key } });
    expect(row?.count).toBe(1);

    await checkRateLimit(key, { limit: 2, windowMs: 60_000 });
    expect((await checkRateLimit(key, { limit: 2, windowMs: 60_000 })).allowed).toBe(false);
  });
});
