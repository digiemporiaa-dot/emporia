import type { Metadata } from "next";
import Link from "next/link";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listApprovals } from "@/lib/services/portal.service";
import { CONTENT_CHANNEL_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody } from "@/components/ui";
import type { ApprovalStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TONE: Record<ApprovalStatus, "neutral" | "warning" | "success" | "red"> = {
  PENDING: "warning",
  CHANGES_REQUESTED: "neutral",
  APPROVED: "success",
  REJECTED: "red",
};

const LABEL: Record<ApprovalStatus, string> = {
  PENDING: "Waiting on you",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export default async function PortalApprovalsPage() {
  const actor = await requirePortalActorPage();
  const approvals = await listApprovals(actor);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Approvals</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Every version is kept, so what you approved stays on the record.
        </p>
      </header>

      {approvals.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">Nothing is waiting for you.</p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-3">
          {approvals.map((approval) => (
            <li key={approval.id}>
              <Card className="transition-colors hover:border-navy-300">
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/portal/approvals/${approval.id}`}
                        className="text-sm font-medium text-navy-800 hover:text-brand-red"
                      >
                        {approval.title}
                      </Link>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        {[
                          approval.contentItem
                            ? `${CONTENT_CHANNEL_LABEL[approval.contentItem.channel]} · ${approval.contentItem.title}`
                            : approval.project?.name,
                          `version ${approval.currentVersion}`,
                          `opened ${DATE.format(approval.createdAt)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Badge tone={TONE[approval.status]}>{LABEL[approval.status]}</Badge>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
