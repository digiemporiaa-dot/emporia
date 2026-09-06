import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { listMedia } from "@/lib/services/media.service";
import { mediaListParamsSchema } from "@/lib/validation/media";
import { isAppError } from "@/lib/errors";

/**
 * Media search, for the picker used across the CMS.
 *
 * A route handler because the picker is a client component that searches as
 * you type. Permission is checked here like anywhere else — this is not a
 * public index of the bucket.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const url = new URL(request.url);
  const parsed = mediaListParamsSchema.safeParse(Object.fromEntries(url.searchParams));
  const params = parsed.success ? parsed.data : mediaListParamsSchema.parse({});

  try {
    const result = await listMedia(actor, params);

    return NextResponse.json({
      total: result.total,
      page: result.page,
      pages: result.pages,
      rows: result.rows.map((row) => ({
        id: row.id,
        url: row.url,
        filename: row.filename,
        type: row.type,
        mimeType: row.mimeType,
        size: row.size,
        alt: row.alt,
      })),
    });
  } catch (error) {
    if (isAppError(error) && error.code === "FORBIDDEN") {
      return NextResponse.json({ error: error.publicMessage }, { status: 403 });
    }
    return NextResponse.json({ error: "That search failed." }, { status: 500 });
  }
}
