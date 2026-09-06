import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { listApprovals } from "@/lib/services/delivery-content.service";
import { CONTENT_CHANNEL_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { ApprovalStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

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

export default async function ApprovalsPage() {
  const actor = await requireActorPage("/admin/approvals");
  const approvals = await listApprovals(actor);

  return (
    <>
      <header className="mb-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">Delivery</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Approvals</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Every version is kept, so an approval records what was approved rather than what the work
          looks like now.
        </p>
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Approval</TH>
              <TH>For</TH>
              <TH>Client</TH>
              <TH className="text-right">Version</TH>
              <TH>Status</TH>
              <TH>Requested by</TH>
              <TH>Opened</TH>
            </TR>
          </THead>
          <TBody>
            {approvals.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="Nothing awaiting approval"
                description="Approvals are opened from a content item or a project."
              />
            ) : (
              approvals.map((approval) => (
                <TR key={approval.id}>
                  <TD>
                    <Link
                      href={`/admin/approvals/${approval.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {approval.title}
                    </Link>
                  </TD>
                  <TD className="text-xs text-ink-muted">
                    {approval.contentItem
                      ? `${CONTENT_CHANNEL_LABEL[approval.contentItem.channel]} · ${approval.contentItem.title}`
                      : (approval.project?.name ?? "—")}
                  </TD>
                  <TD className="text-ink-muted">{approval.client.name}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">
                    v{approval.currentVersion}
                  </TD>
                  <TD>
                    <Badge tone={TONE[approval.status]}>{LABEL[approval.status]}</Badge>
                  </TD>
                  <TD className="text-xs text-ink-muted">{approval.requestedBy.name}</TD>
                  <TD className="text-xs text-ink-subtle">{DATE.format(approval.createdAt)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
