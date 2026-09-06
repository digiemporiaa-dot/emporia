import "server-only";
import { db } from "@/lib/db";

/**
 * Fixed-window rate limiting, shared across application instances.
 *
 * The window lives in Postgres rather than in process memory. In-process
 * counters are correct for exactly one container: behind two, an attacker gets
 * the limit once per instance, which for the login endpoint means the limit is
 * whatever the deployment happens to be scaled to. Postgres is already a hard
 * dependency, so this needs no new infrastructure (docs/ARCHITECTURE.md 19 D9).
 *
 * The increment is a single `INSERT … ON CONFLICT DO UPDATE`, so concurrent
 * requests — on one instance or several — cannot both read the same count and
 * both decide they are under the limit.
 */

export type RateLimitOptions = { limit: number; windowMs: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/** Expired rows are cleared occasionally rather than on a schedule. */
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

async function sweep(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;

  try {
    await db.rateLimitWindow.deleteMany({ where: { resetAt: { lt: new Date() } } });
  } catch {
    // Housekeeping. A failure here must never fail the request it rode in on.
  }
}

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const resetAt = new Date(Date.now() + options.windowMs);

  // One statement: insert the window, or increment it — and reset it in the
  // same breath if it has already expired. Doing this as a read then a write
  // would let two requests race past the limit together.
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimitWindow" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitWindow"."resetAt" <= NOW() THEN 1
        ELSE "RateLimitWindow"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitWindow"."resetAt" <= NOW() THEN ${resetAt}
        ELSE "RateLimitWindow"."resetAt"
      END
    RETURNING "count", "resetAt"
  `;

  void sweep();

  const row = rows[0];
  if (!row) {
    // The statement always returns a row; if it somehow did not, refusing the
    // request is the safe direction for a limiter.
    return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
  }

  const count = Number(row.count);
  const allowed = count <= options.limit;

  return {
    allowed,
    remaining: Math.max(0, options.limit - count),
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000)),
  };
}

/** Test seam. */
export async function resetRateLimits(): Promise<void> {
  lastSweep = 0;
  await db.rateLimitWindow.deleteMany({});
}
