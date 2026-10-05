import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { getSeoReport } from "@/lib/services/seo-intel/seo-report.service";
import { isAppError } from "@/lib/errors";
import { reportMonthLabel } from "@/lib/seo-intel/report-doc";
import { SeoReportDocument } from "@/components/reports/seo-report-document";
import { PrintButton } from "@/components/reports/print-button";

export const metadata: Metadata = { title: "SEO report" };
export const dynamic = "force-dynamic";

/**
 * An SEO report ready to print or save as PDF from the browser, for staff and
 * for the client it belongs to. `getSeoReport` decides who may read it — a
 * client only their own website's published report.
 */
export default async function PrintSeoReport({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const actor = await currentActor();
  if (!actor) redirect(`/auth/login?redirectTo=${encodeURIComponent(`/print/seo-reports/${reportId}`)}`);

  let report;
  try {
    report = await getSeoReport(actor, reportId);
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <p className="text-xs text-ink-subtle">
          {report.data.website.name} · {reportMonthLabel(report.month)}
          {report.status === "DRAFT" ? " · Draft — not yet shared with the client" : ""}
        </p>
        <PrintButton />
      </div>
      <SeoReportDocument data={report.data} notes={report.notes} />
    </>
  );
}
