import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getReport } from "@/lib/services/social-report.service";
import { isAppError } from "@/lib/errors";
import { Badge, Card, CardBody } from "@/components/ui";
import { SocialReportDocument } from "@/components/reports/social-report-document";
import { ReportActions } from "../report-controls";

export const metadata: Metadata = { title: "Social report" };
export const dynamic = "force-dynamic";

export default async function SocialReportPage({ params }: { params: Promise<{ clientId: string; reportId: string }> }) {
  const { clientId, reportId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/reports/${reportId}`);

  let report;
  try {
    report = await getReport(actor, reportId);
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  // The URL's client must be the report's; otherwise it is a different page.
  if (report.clientId !== clientId) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/admin/clients/${clientId}/social/reports` as Route} className="text-xs text-ink-subtle hover:text-navy-800">
          ← All reports
        </Link>
        <Badge tone={report.status === "PUBLISHED" ? "success" : "neutral"}>
          {report.status === "PUBLISHED" ? "Published to the client" : "Draft — only the agency can see this"}
        </Badge>
      </div>
      <ReportActions
        clientId={clientId}
        reportId={report.id}
        status={report.status}
        notes={report.notes}
        canManage={can(actor, "social.reports.manage")}
      />
      <Card>
        <CardBody>
          <SocialReportDocument data={report.data} notes={report.notes} />
        </CardBody>
      </Card>
    </div>
  );
}
