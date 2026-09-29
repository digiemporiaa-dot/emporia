import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listReports, reportableMonths } from "@/lib/services/social-report.service";
import { monthLabel } from "@/lib/social/report-doc";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { GenerateReport } from "./report-controls";

export const metadata: Metadata = { title: "Social reports" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** A client's monthly reports: generated from stored figures, published to the portal when ready. */
export default async function SocialReportsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/reports`);

  if (!can(actor, "social.reports.view")) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-ink-subtle">You do not have permission to see social reports.</p>
        </CardBody>
      </Card>
    );
  }

  const reports = await listReports(actor, clientId);
  const existing = Object.fromEntries(reports.map((r) => [r.month, r.status]));

  return (
    <div className="space-y-5">
      {can(actor, "social.reports.manage") ? (
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>New report</CardTitle>
              <p className="text-2xs text-ink-subtle">
                Built from the figures the platforms reported and the content planned — nothing estimated, nothing written
                by AI. It stays a draft, visible only to the agency, until you publish it to the client&rsquo;s portal.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <GenerateReport
              clientId={clientId}
              months={reportableMonths().map((value) => ({ value, label: monthLabel(value) }))}
              existing={existing}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
        </CardHeader>
        <CardBody>
          {reports.length === 0 ? (
            <p className="text-sm text-ink-subtle">No reports yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div>
                    <Link href={`/admin/clients/${clientId}/social/reports/${report.id}` as Route} className="text-sm text-navy-800 hover:text-brand-red-text">
                      {monthLabel(report.month)}
                    </Link>
                    <p className="text-2xs text-ink-subtle">
                      Generated {DATE.format(report.generatedAt)} by {report.generatedBy.name}
                      {report.publishedAt ? ` · published ${DATE.format(report.publishedAt)}` : ""}
                    </p>
                  </div>
                  <Badge tone={report.status === "PUBLISHED" ? "success" : "neutral"}>
                    {report.status === "PUBLISHED" ? "Published" : "Draft"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
