import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getApproval } from "@/lib/services/delivery-content.service";
import { isAppError } from "@/lib/errors";
import { CONTENT_CHANNEL_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { DecisionForm, NewVersionForm } from "../approval-panels";
import type { ApprovalStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Approval" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TONE: Record<ApprovalStatus, "neutral" | "warning" | "success" | "red"> = {
  PENDING: "neutral",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  REJECTED: "red",
};

const LABEL: Record<ApprovalStatus, string> = {
  PENDING: "Pending",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const { approvalId } = await params;
  const actor = await requireActorPage("/admin/approvals");

  let approval;
  try {
    approval = await getApproval(actor, approvalId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const undecided = approval.status === "PENDING";
  const openForNewVersion = approval.status !== "APPROVED";

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/approvals" className="hover:text-navy-800">
            Approvals
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{approval.title}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{approval.title}</h1>
          <Badge tone={TONE[approval.status]}>{LABEL[approval.status]}</Badge>
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {approval.client.name}
          {approval.contentItem ? (
            <>
              {" · "}
              <Link
                href={`/admin/content/${approval.contentItem.id}`}
                className="hover:text-brand-red"
              >
                {CONTENT_CHANNEL_LABEL[approval.contentItem.channel]} ·{" "}
                {approval.contentItem.title}
              </Link>
            </>
          ) : null}
          {approval.project ? (
            <>
              {" · "}
              <Link href={`/admin/projects/${approval.project.id}`} className="hover:text-brand-red">
                {approval.project.code}
              </Link>
            </>
          ) : null}
          {" · requested by "}
          {approval.requestedBy.name}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-4">
              {approval.versions.map((version) => (
                <li key={version.id} className="border-l-2 border-line pl-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-navy-800">
                      Version {version.version}
                      {version.version === approval.currentVersion ? (
                        <span className="ml-2 text-2xs uppercase tracking-widest text-brand-red">
                          Current
                        </span>
                      ) : null}
                    </p>
                    <span className="text-2xs text-ink-subtle">
                      {version.createdBy.name} · {DATE.format(version.createdAt)}
                    </span>
                  </div>

                  <Badge tone={TONE[version.status]} className="mt-1.5">
                    {LABEL[version.status]}
                  </Badge>

                  {version.notes ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink">{version.notes}</p>
                  ) : null}

                  {version.feedback ? (
                    <p className="mt-1.5 whitespace-pre-wrap rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-xs text-warning">
                      {version.feedback}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>

            <p className="mt-4 border-t border-line pt-3 text-2xs text-ink-subtle">
              Attaching creative files to a version needs the media library, which is built in phase
              11. Until then a version records the notes and the decision, not the artwork.
            </p>
          </CardBody>
        </Card>

        <div className="space-y-5">
          {undecided && can(actor, "approvals.decide") ? (
            <Card>
              <CardHeader>
                <CardTitle>Decide version {approval.currentVersion}</CardTitle>
              </CardHeader>
              <CardBody>
                <DecisionForm approvalId={approval.id} />
              </CardBody>
            </Card>
          ) : null}

          {openForNewVersion && can(actor, "approvals.request") ? (
            <Card>
              <CardHeader>
                <CardTitle>New version</CardTitle>
              </CardHeader>
              <CardBody>
                <NewVersionForm approvalId={approval.id} />
              </CardBody>
            </Card>
          ) : null}

          {approval.decidedBy ? (
            <Card>
              <CardBody>
                <p className="text-xs text-ink-subtle">
                  Decided by {approval.decidedBy.name}
                  {approval.decidedAt ? ` on ${DATE.format(approval.decidedAt)}` : ""}.
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
