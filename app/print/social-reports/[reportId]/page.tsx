import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { getReport } from "@/lib/services/social-report.service";
import { isAppError } from "@/lib/errors";
import { monthLabel } from "@/lib/social/report-doc";
import { SocialReportDocument } from "@/components/reports/social-report-document";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Social report" };
export const dynamic = "force-dynamic";

/**
 * A report ready to print or save as PDF from the browser, for staff and for
 * the client it belongs to. `getReport` decides who may read it — a client
 * only their own published report.
 */
export default async function PrintSocialReport({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const actor = await currentActor();
  if (!actor) redirect(`/auth/login?redirectTo=${encodeURIComponent(`/print/social-reports/${reportId}`)}`);

  let report;
  try {
    report = await getReport(actor, reportId);
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <p className="text-xs text-ink-subtle">
          {report.data.clientName} · {monthLabel(report.month)}
          {report.status === "DRAFT" ? " · Draft — not yet shared with the client" : ""}
        </p>
        <PrintButton />
      </div>
      <SocialReportDocument data={report.data} notes={report.notes} />
    </>
  );
}
