import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { getSeoReport } from "@/lib/services/seo-intel/seo-report.service";
import { isAppError } from "@/lib/errors";
import { Card, CardBody } from "@/components/ui";
import { SeoReportDocument } from "@/components/reports/seo-report-document";

export const metadata: Metadata = { title: "SEO report" };
export const dynamic = "force-dynamic";

/** One published SEO report. Another client's, or a draft, is simply not found. */
export default async function PortalSeoReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const actor = await requirePortalActorPage();

  let report;
  try {
    report = await getSeoReport(actor, reportId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={"/portal/seo/reports" as Route} className="text-xs text-ink-subtle hover:text-navy-800">
          ← All SEO reports
        </Link>
        <a href={`/print/seo-reports/${report.id}`} target="_blank" rel="noopener" className="text-xs text-navy-800 underline underline-offset-4">
          Print or save as PDF
        </a>
      </div>
      <Card>
        <CardBody>
          <SeoReportDocument data={report.data} notes={report.notes} />
        </CardBody>
      </Card>
    </div>
  );
}
