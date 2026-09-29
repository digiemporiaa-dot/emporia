import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { getReport } from "@/lib/services/social-report.service";
import { reportCsv } from "@/lib/social/report-doc";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * A report's figures as CSV, for staff or for the client it belongs to.
 *
 * `getReport` is the authority: staff need `social.reports.view` within their
 * scope; a client may only download their own *published* report. Anything
 * else is a 404, the same as an id that does not exist.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("social");

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { reportId } = await params;
  if (!/^[a-z0-9]{1,40}$/i.test(reportId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const report = await getReport(actor, reportId);
    const slug = report.data.clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "client";
    return new NextResponse(reportCsv(report.data), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="social-report-${slug}-${report.month}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    routeLog.error({ err: error, reportId }, "report download failed");
    return NextResponse.json({ error: "That report could not be produced." }, { status: 500 });
  }
}
