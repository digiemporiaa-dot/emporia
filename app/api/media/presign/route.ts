import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentActor } from "@/lib/actor";
import { presign } from "@/lib/services/media.service";
import { presignSchema } from "@/lib/validation/media";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { clientIpFrom } from "@/lib/auth";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Issue a presigned upload URL.
 *
 * A route handler rather than a server action because the browser needs the URL
 * back to PUT the bytes directly at the bucket; the file never passes through
 * this server.
 *
 * Authentication, permission and validation all happen here, before anything is
 * signed: an unauthenticated caller cannot obtain a URL that writes to the
 * bucket (CLAUDE.md 11).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("media");

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const ip = clientIpFrom(await headers());
  const limit = checkRateLimit(`media:presign:${actor.userId}:${ip ?? "unknown"}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many uploads. Slow down." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }

  const parsed = presignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the file." },
      { status: 400 },
    );
  }

  try {
    const result = await presign(actor, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    routeLog.warn({ err: error, userId: actor.userId }, "presign refused");

    if (isAppError(error)) {
      const status =
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "INTEGRATION_NOT_CONFIGURED"
            ? 503
            : 400;
      return NextResponse.json({ error: error.publicMessage }, { status });
    }

    // Never surface a stack trace (CLAUDE.md 11).
    return NextResponse.json({ error: "That upload could not be started." }, { status: 500 });
  }
}
