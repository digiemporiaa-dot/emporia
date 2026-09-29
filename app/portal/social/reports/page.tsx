import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalReports } from "@/lib/services/social-report.service";
import { monthLabel } from "@/lib/social/report-doc";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "Social reports" };
export const dynamic = "force-dynamic";

/** The client's published monthly reports (brief §33). Their own only — the session decides whose. */
export default async function PortalSocialReportsPage() {
  const actor = await requirePortalActorPage();
  const reports = await portalReports(actor);

  return (
    <>
      <p className="mb-4 text-xs text-ink-subtle">Your monthly reports, from the figures the platforms reported.</p>
      <Card>
        <CardBody>
          {reports.length === 0 ? (
            <p className="text-sm text-ink-subtle">No reports have been shared with you yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <Link href={`/portal/social/reports/${report.id}` as Route} className="text-sm text-navy-800 hover:text-brand-red-text">
                    {monthLabel(report.month)}
                  </Link>
                  <span className="flex gap-3 text-2xs">
                    <a href={`/print/social-reports/${report.id}`} target="_blank" rel="noopener" className="text-ink-subtle hover:text-navy-800">
                      Print or PDF
                    </a>
                    <a href={`/api/social/reports/${report.id}/csv`} className="text-ink-subtle hover:text-navy-800">
                      CSV
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
