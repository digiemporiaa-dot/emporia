import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { exportContent } from "@/lib/services/transfer.service";
import { isTransferType } from "@/lib/transfer/columns";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Download a content type as CSV.
 *
 * A route handler rather than a server action because the browser has to
 * receive a file: the response carries a content type and a filename, and the
 * link is an ordinary one an operator can bookmark. A server action can only
 * return data for script to turn into a download, which the viewer's sandbox
 * and every corporate browser policy treat with more suspicion than a plain
 * GET.
 *
 * Authentication and the per-type view permission are both checked here,
 * before a single row is read — the whole of a content table leaves through
 * this route, so an unauthenticated GET must get nothing (CLAUDE.md 2 rule 2).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("transfer");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { type } = await params;
  if (!isTransferType(type)) {
    return NextResponse.json({ error: "There is nothing of that kind to export." }, { status: 404 });
  }

  try {
    const { filename, csv } = await exportContent(actor, type);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        // The charset matters: without it Excel reads a UTF-8 file as Latin-1
        // and turns every ₹ and every accented name into mojibake.
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        // A content export is never a thing to keep in a shared cache.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (isAppError(error) && error.code === "FORBIDDEN") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    routeLog.error({ err: error, type }, "export failed");
    return NextResponse.json({ error: "That export could not be produced." }, { status: 500 });
  }
}
