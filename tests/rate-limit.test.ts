import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/utils/rate-limit";

afterEach(() => resetRateLimits());

describe("rate limiting", () => {
  it("allows up to the limit then blocks", () => {
    const key = "test:allow";
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimit(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(true);
    }
    expect(checkRateLimit(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(false);
  });

  it("reports remaining attempts", () => {
    const key = "test:remaining";
    expect(checkRateLimit(key, { limit: 3, windowMs: 60_000 }).remaining).toBe(2);
    expect(checkRateLimit(key, { limit: 3, windowMs: 60_000 }).remaining).toBe(1);
    expect(checkRateLimit(key, { limit: 3, windowMs: 60_000 }).remaining).toBe(0);
  });

  it("gives a retry-after only once blocked", () => {
    const key = "test:retry";
    expect(checkRateLimit(key, { limit: 1, windowMs: 60_000 }).retryAfterSeconds).toBe(0);
    const blocked = checkRateLimit(key, { limit: 1, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate keys independent, so one user cannot lock out another", () => {
    checkRateLimit("ip:1.1.1.1", { limit: 1, windowMs: 60_000 });
    expect(checkRateLimit("ip:1.1.1.1", { limit: 1, windowMs: 60_000 }).allowed).toBe(false);
    expect(checkRateLimit("ip:2.2.2.2", { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("opens a fresh window after the previous one expires", async () => {
    const key = "test:window";
    expect(checkRateLimit(key, { limit: 1, windowMs: 20 }).allowed).toBe(true);
    expect(checkRateLimit(key, { limit: 1, windowMs: 20 }).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(checkRateLimit(key, { limit: 1, windowMs: 20 }).allowed).toBe(true);
  });
});
