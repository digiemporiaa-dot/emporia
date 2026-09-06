import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { confirm } from "@/lib/services/media.service";
import { confirmSchema } from "@/lib/validation/media";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Confirm an upload that has landed in the bucket.
 *
 * This is where the file is actually verified: the object's size is checked
 * against the size that was signed, and its leading bytes against the type it
 * claimed to be. A mismatch deletes the object and refuses — a spoofed
 * extension gets no Media row (the phase 11 exit criterion).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("media");

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "That upload is not valid." }, { status: 400 });
  }

  try {
    const media = await confirm(actor, parsed.data.uploadId);
    return NextResponse.json({ media });
  } catch (error) {
    routeLog.warn({ err: error, userId: actor.userId }, "upload refused at confirm");

    if (isAppError(error)) {
      const status =
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "INTEGRATION_NOT_CONFIGURED"
            ? 503
            : 400;
      return NextResponse.json({ error: error.publicMessage }, { status });
    }

    return NextResponse.json({ error: "That upload could not be saved." }, { status: 500 });
  }
}
