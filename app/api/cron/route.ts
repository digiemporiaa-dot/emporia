import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";
import { runScheduledPublishing } from "@/lib/services/schedule.service";
import { log } from "@/lib/logger";

/**
 * The scheduler's entry point.
 *
 * Nothing in this application runs on a clock, so scheduling is a pull: this
 * endpoint asks "what is due?" and acts, and something outside calls it on a
 * schedule (docs/DEPLOYMENT.md §4). It is deliberately the smallest thing that
 * works — a queue would be another piece of infrastructure to run and monitor
 * for a feature whose job is flipping a status twice a month.
 *
 * Authenticated by a shared secret, compared in constant time. With no secret
 * configured it refuses everything rather than running open: scheduling that
 * silently does not happen is a visible failure, and an unauthenticated
 * endpoint that publishes pages is not.
 *
 * Safe to call more often than needed and safe to call twice at once: every job
 * it runs selects only what is due and clears or leaves its own marker, so a
 * second concurrent run finds nothing to do.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cronLog = log("cron");

/**
 * Constant-time comparison that does not leak the secret's length.
 *
 * `timingSafeEqual` throws on a length mismatch, which is itself a signal, so
 * both sides are hashed to a fixed width first.
 */
function secretMatches(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  if (a.length !== b.length) {
    // Still do the work, so a wrong length is not measurably faster than a
    // wrong value.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** `Authorization: Bearer <secret>`, or `?secret=` for schedulers that cannot set headers. */
function providedSecret(request: Request, head: Headers): string | null {
  const authorization = head.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  const url = new URL(request.url);
  return url.searchParams.get("secret");
}

async function handle(request: Request): Promise<NextResponse> {
  const head = await headers();
  const expected = env().CRON_SECRET;

  if (!expected) {
    cronLog.warn("cron endpoint called with no CRON_SECRET configured");
    return NextResponse.json(
      { ok: false, message: "Scheduling is not configured." },
      { status: 503 },
    );
  }

  const provided = providedSecret(request, head);
  if (!provided || !secretMatches(provided, expected)) {
    // No detail: a caller without the secret learns nothing about it.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const run = await runScheduledPublishing();
    return NextResponse.json({
      ok: true,
      published: run.published.map((page) => page.slug),
      unpublished: run.unpublished.map((page) => page.slug),
      failed: run.failed.map((page) => ({ slug: page.slug, reason: page.reason })),
    });
  } catch (error) {
    cronLog.error({ err: error }, "scheduled run failed");
    return NextResponse.json({ ok: false, message: "The scheduled run failed." }, { status: 500 });
  }
}

/** Both verbs, because schedulers differ on which they use for a plain trigger. */
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
