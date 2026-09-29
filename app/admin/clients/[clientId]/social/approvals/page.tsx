import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requireActorPage } from "@/lib/actor";
import { pendingInternalReviews } from "@/lib/services/social-review.service";
import { clientApprovalQueue } from "@/lib/services/social-approval.service";
import { APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE } from "@/lib/projects/lifecycle";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { SocialProvider } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Social approvals" };
export const dynamic = "force-dynamic";

/**
 * Everything waiting on a decision, in the order the workflow runs: the
 * agency's own review first, then the client. Decisions are made on each
 * idea's page, where the content is; this is the queue.
 */

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const platforms = (posts: { provider: SocialProvider }[]) => [...new Set(posts.map((p) => PROVIDER_LABEL[p.provider]))].join(", ");

export default async function SocialApprovalsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/approvals`);
  const [internal, client] = await Promise.all([pendingInternalReviews(actor, clientId), clientApprovalQueue(actor, clientId)]);
  const item = (id: string) => `/admin/clients/${clientId}/social/content/${id}` as Route;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Waiting for internal review · {internal.length}</CardTitle>
            <p className="text-2xs text-ink-subtle">Oldest first. Nothing goes to the client until a reviewer approves it.</p>
          </div>
        </CardHeader>
        <CardBody>
          {internal.length === 0 ? (
            <p className="text-sm text-ink-subtle">Nothing is waiting for internal review.</p>
          ) : (
            <ul className="divide-y divide-line">
              {internal.map((round) => (
                <li key={round.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={item(round.contentItem.id)} className="text-sm text-navy-800 hover:text-brand-red-text">
                      {round.contentItem.title}
                    </Link>
                    <p className="text-2xs text-ink-subtle">
                      Round {round.round} · submitted by {round.submittedBy.name} · {DATE.format(round.submittedAt)}
                    </p>
                    {round.note ? <p className="mt-0.5 line-clamp-2 text-2xs text-ink-muted">{round.note}</p> : null}
                  </div>
                  <Badge tone="warning">Waiting for review</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>With the client · {client.pending.length}</CardTitle>
        </CardHeader>
        <CardBody>
          {client.pending.length === 0 ? (
            <p className="text-sm text-ink-subtle">Nothing is with the client.</p>
          ) : (
            <ul className="divide-y divide-line">
              {client.pending.map((approval) => (
                <li key={approval.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    {approval.contentItem ? (
                      <Link href={item(approval.contentItem.id)} className="text-sm text-navy-800 hover:text-brand-red-text">
                        {approval.contentItem.title}
                      </Link>
                    ) : null}
                    <p className="text-2xs text-ink-subtle">
                      Version {approval.currentVersion} · {platforms(approval.contentItem?.socialPosts ?? [])} · sent{" "}
                      {DATE.format(approval.versions[0]?.createdAt ?? approval.createdAt)}
                    </p>
                  </div>
                  <Badge tone={APPROVAL_STATUS_TONE[approval.status]}>{APPROVAL_STATUS_LABEL[approval.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decided by the client in the last 30 days</CardTitle>
        </CardHeader>
        <CardBody>
          {client.decided.length === 0 ? (
            <p className="text-sm text-ink-subtle">No decisions in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-line">
              {client.decided.map((approval) => (
                <li key={approval.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    {approval.contentItem ? (
                      <Link href={item(approval.contentItem.id)} className="text-sm text-navy-800 hover:text-brand-red-text">
                        {approval.contentItem.title}
                      </Link>
                    ) : null}
                    <p className="text-2xs text-ink-subtle">
                      Version {approval.currentVersion}
                      {approval.decidedAt ? ` · ${DATE.format(approval.decidedAt)}` : ""}
                      {approval.decidedBy ? ` · ${approval.decidedBy.name}` : ""}
                    </p>
                    {approval.versions[0]?.feedback ? (
                      <p className="mt-0.5 line-clamp-2 text-2xs text-ink-muted">&ldquo;{approval.versions[0].feedback}&rdquo;</p>
                    ) : null}
                  </div>
                  <Badge tone={APPROVAL_STATUS_TONE[approval.status]}>{APPROVAL_STATUS_LABEL[approval.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
