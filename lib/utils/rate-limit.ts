import "server-only";

/**
 * Fixed-window rate limiter, in process memory.
 *
 * Honest about what it is: correct for a single container, and no more. A
 * horizontally scaled deployment needs a shared store (Redis) — that is
 * decision D9 in docs/ARCHITECTURE.md 19, deferred until scaling is actually
 * planned rather than guessed at.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitOptions = { limit: number; windowMs: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= options.limit;
  return {
    allowed,
    remaining: Math.max(0, options.limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Test seam. */
export function resetRateLimits(): void {
  windows.clear();
}
