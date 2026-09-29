import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { getReport } from "@/lib/services/social-report.service";
import { isAppError } from "@/lib/errors";
import { Card, CardBody } from "@/components/ui";
import { SocialReportDocument } from "@/components/reports/social-report-document";

export const metadata: Metadata = { title: "Social report" };
export const dynamic = "force-dynamic";

/** One published report. Another client's, or a draft, is simply not found. */
export default async function PortalSocialReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const actor = await requirePortalActorPage();

  let report;
  try {
    report = await getReport(actor, reportId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={"/portal/social/reports" as Route} className="text-xs text-ink-subtle hover:text-navy-800">
          ← All reports
        </Link>
        <span className="flex gap-3 text-xs">
          <a href={`/print/social-reports/${report.id}`} target="_blank" rel="noopener" className="text-navy-800 underline underline-offset-4">
            Print or save as PDF
          </a>
          <a href={`/api/social/reports/${report.id}/csv`} className="text-navy-800 underline underline-offset-4">
            Download CSV
          </a>
        </span>
      </div>
      <Card>
        <CardBody>
          <SocialReportDocument data={report.data} notes={report.notes} />
        </CardBody>
      </Card>
    </div>
  );
}
