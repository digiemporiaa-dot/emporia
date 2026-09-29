import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalSocialApprovals } from "@/lib/services/portal-social.service";
import { APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE } from "@/lib/projects/lifecycle";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { SocialProvider } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Social approvals" };
export const dynamic = "force-dynamic";

/** Social posts waiting for the client's decision, and what they decided lately. Decisions happen on each approval's page. */

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const platforms = (posts: { provider: SocialProvider }[]) => [...new Set(posts.map((p) => PROVIDER_LABEL[p.provider]))].join(", ");

export default async function PortalSocialApprovalsPage() {
  const actor = await requirePortalActorPage();
  const { pending, decided } = await portalSocialApprovals(actor);

  const row = (approval: (typeof pending)[number]) => (
    <li key={approval.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <Link href={`/portal/approvals/${approval.id}` as Route} className="text-sm text-navy-800 hover:text-brand-red-text">
          {approval.contentItem?.title ?? "Social post"}
        </Link>
        <p className="text-2xs text-ink-subtle">
          {platforms(approval.contentItem?.socialPosts ?? [])} · version {approval.currentVersion}
          {approval.decidedAt ? ` · ${DATE.format(approval.decidedAt)}` : ""}
        </p>
      </div>
      <Badge tone={APPROVAL_STATUS_TONE[approval.status]}>{APPROVAL_STATUS_LABEL[approval.status]}</Badge>
    </li>
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Waiting for you · {pending.length}</CardTitle>
        </CardHeader>
        <CardBody>
          {pending.length === 0 ? <p className="text-sm text-ink-subtle">Nothing is waiting for you.</p> : <ul className="divide-y divide-line">{pending.map(row)}</ul>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Decided in the last 60 days</CardTitle>
        </CardHeader>
        <CardBody>
          {decided.length === 0 ? <p className="text-sm text-ink-subtle">No decisions yet.</p> : <ul className="divide-y divide-line">{decided.map(row)}</ul>}
        </CardBody>
      </Card>
    </div>
  );
}
