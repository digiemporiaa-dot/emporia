import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalSeoReports } from "@/lib/services/seo-intel/seo-report.service";
import { reportMonthLabel } from "@/lib/seo-intel/report-doc";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "SEO reports" };
export const dynamic = "force-dynamic";

/** The client's published monthly SEO reports. Their own websites only — the session decides whose. */
export default async function PortalSeoReportsPage() {
  const actor = await requirePortalActorPage();
  const reports = await portalSeoReports(actor);

  return (
    <>
      <h1 className="mb-1 text-xl text-navy-800">SEO reports</h1>
      <p className="mb-4 text-xs text-ink-subtle">Your monthly reports: search traffic, keywords, site health and the work done on your website.</p>
      <Card>
        <CardBody>
          {reports.length === 0 ? (
            <p className="text-sm text-ink-subtle">No SEO reports have been shared with you yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <Link href={`/portal/seo/reports/${report.id}` as Route} className="text-sm text-navy-800 hover:text-brand-red-text">
                    {reportMonthLabel(report.month)} <span className="text-xs text-ink-subtle">· {report.property.displayName}</span>
                  </Link>
                  <a href={`/print/seo-reports/${report.id}`} target="_blank" rel="noopener" className="text-2xs text-ink-subtle hover:text-navy-800">
                    Print or PDF
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
