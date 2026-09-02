import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getContentItem } from "@/lib/services/delivery-content.service";
import { listProjects } from "@/lib/services/project.service";
import { isAppError } from "@/lib/errors";
import { CONTENT_CHANNEL_LABEL, CONTENT_STAGE_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { ContentItemForm, RequestApprovalForm, StageControl } from "../content-panels";
import type { ApprovalStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Content item" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const APPROVAL_TONE: Record<ApprovalStatus, "neutral" | "warning" | "success" | "red"> = {
  PENDING: "neutral",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  REJECTED: "red",
};

const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  PENDING: "Pending",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export default async function ContentItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const actor = await requireActorPage("/admin/content");

  let item;
  try {
    item = await getContentItem(actor, itemId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canEdit = can(actor, "content.edit");

  const [projectList, staff] = await Promise.all([
    canEdit && can(actor, "projects.view")
      ? listProjects(actor, { perPage: 100 })
      : Promise.resolve({ rows: [] as { id: string; code: string; name: string }[] }),
    canEdit
      ? db.user.findMany({
          where: { type: "STAFF", status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/content" className="hover:text-navy-800">
            Content
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{item.title}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{item.title}</h1>
          <Badge tone="navy">{CONTENT_CHANNEL_LABEL[item.channel]}</Badge>
          <Badge tone="neutral">{CONTENT_STAGE_LABEL[item.stage]}</Badge>
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          <Link href={`/admin/projects/${item.project.id}`} className="hover:text-brand-red">
            {item.project.code} — {item.project.name}
          </Link>{" "}
          · {item.client.name}
          {item.scheduledFor ? ` · scheduled ${DATE.format(item.scheduledFor)}` : " · unscheduled"}
          {item.publishedAt ? ` · published ${DATE.format(item.publishedAt)}` : ""}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Brief</CardTitle>
            </CardHeader>
            <CardBody>
              {item.brief ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{item.brief}</p>
              ) : (
                <p className="text-xs text-ink-subtle">No brief written.</p>
              )}

              {item.media ? (
                <figure className="mt-4 border-t border-line pt-4">
                  {item.media.type === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploads on a third-party origin
                    <img
                      src={item.media.url}
                      alt={item.media.alt ?? item.media.filename}
                      className="max-h-96 rounded-md border border-line bg-surface-muted object-contain"
                    />
                  ) : null}
                  <figcaption className="mt-1.5">
                    <a
                      href={item.media.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-2xs text-navy-800 underline underline-offset-2 hover:text-brand-red"
                    >
                      {item.media.filename}
                    </a>
                  </figcaption>
                </figure>
              ) : null}
            </CardBody>
          </Card>

          {canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Edit</CardTitle>
              </CardHeader>
              <CardBody>
                <ContentItemForm
                  projects={projectList.rows.map((project) => ({
                    id: project.id,
                    label: `${project.code} — ${project.name}`,
                  }))}
                  staff={staff}
                  item={{
                    id: item.id,
                    projectId: item.projectId,
                    channel: item.channel,
                    title: item.title,
                    brief: item.brief,
                    ownerId: item.ownerId,
                    scheduledFor: item.scheduledFor,
                    media: item.media,
                  }}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Workflow</CardTitle>
              </CardHeader>
              <CardBody>
                <StageControl
                  itemId={item.id}
                  stage={item.stage}
                  canPublish={can(actor, "content.publish")}
                />
                <p className="mt-2 text-2xs text-ink-subtle">
                  Owner: {item.owner?.name ?? "unassigned"}
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Approvals</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {item.approvals.length === 0 ? (
                <p className="text-xs text-ink-subtle">Nothing sent for approval yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {item.approvals.map((approval) => (
                    <li key={approval.id} className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/admin/approvals/${approval.id}`}
                        className="text-sm text-navy-800 hover:text-brand-red"
                      >
                        {approval.title}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-2xs text-ink-subtle">v{approval.currentVersion}</span>
                        <Badge tone={APPROVAL_TONE[approval.status]}>
                          {APPROVAL_LABEL[approval.status]}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {can(actor, "approvals.request") ? (
                <div className="border-t border-line pt-3">
                  <RequestApprovalForm contentItemId={item.id} />
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
