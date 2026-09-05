import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { assignableUsers, getLead } from "@/lib/services/crm.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { PriorityBadge, ScoreBadge, StatusBadge } from "@/components/admin/lead-badges";
import { AIUnavailable } from "@/components/admin/ai-draft";
import { isAIConfigured } from "@/lib/ai";
import { LeadAssist } from "./lead-assist";
import {
  AssignPanel,
  NotesPanel,
  RescoreButton,
  StatusPanel,
  TasksPanel,
} from "./lead-panels";

export const metadata: Metadata = { title: "Lead" };
export const dynamic = "force-dynamic";

const DATETIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Attribution rows, omitted entirely when there is nothing real to show. */
function TouchRows({
  label,
  touch,
}: {
  label: string;
  touch: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    term: string | null;
    content: string | null;
    occurredAt: Date;
  } | null;
}) {
  if (!touch) return null;
  const parts = [
    ["Source", touch.source],
    ["Medium", touch.medium],
    ["Campaign", touch.campaign],
    ["Term", touch.term],
    ["Content", touch.content],
  ].filter(([, value]) => Boolean(value));

  if (parts.length === 0) return null;

  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">{label}</p>
      <dl className="mt-1.5 space-y-1">
        {parts.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3 text-xs">
            <dt className="text-ink-subtle">{key}</dt>
            <dd className="truncate text-navy-800">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 text-xs">
          <dt className="text-ink-subtle">When</dt>
          <dd className="text-navy-800">{touch.occurredAt.toISOString().slice(0, 10)}</dd>
        </div>
      </dl>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const actor = await requireActorPage("/admin/leads");

  let lead;
  try {
    lead = await getLead(actor, leadId);
  } catch (error) {
    // A lead belonging to another rep raises NotFound, identically to one that
    // does not exist — so this page cannot be used to probe for their pipeline.
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const staff = await assignableUsers(actor);
  const canEdit = can(actor, "leads.edit");

  const facts: [string, string | null][] = [
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Company", lead.company],
    ["Budget", lead.budget ? formatMoney(lead.budget, lead.currency) : null],
    ["Source", lead.source.name],
    ["Service", lead.service?.name ?? null],
    ["City", lead.city?.name ?? null],
    ["Package", lead.package?.name ?? null],
    ["Popup", lead.popup?.name ?? null],
    ["Campaign", lead.campaign?.name ?? null],
    ["Landing page", lead.landingPath],
    ["Referrer", lead.referrer],
    ["Device", lead.device],
  ];

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/leads" className="hover:text-navy-800">
            Leads
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{lead.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{lead.name}</h1>
          <StatusBadge status={lead.status} />
          <PriorityBadge priority={lead.priority} />
          <span className="flex items-center gap-2">
            <ScoreBadge score={lead.score} />
            {canEdit ? <RescoreButton leadId={lead.id} /> : null}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Captured {DATETIME.format(lead.createdAt)}
          {lead.assignedTo ? ` · owned by ${lead.assignedTo.name}` : " · unassigned"}
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          {can(actor, "ai.use") ? (
            <Card>
              <CardHeader>
                <CardTitle>Assistant</CardTitle>
                <p className="text-xs text-ink-subtle">
                  Reads this lead and drafts. It changes nothing.
                </p>
              </CardHeader>
              <CardBody>
                {isAIConfigured() ? (
                  <LeadAssist leadId={lead.id} computedScore={lead.score} />
                ) : (
                  <AIUnavailable />
                )}
              </CardBody>
            </Card>
          ) : null}

          {lead.message ? (
            <Card>
              <CardHeader>
                <CardTitle>What they said</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="whitespace-pre-wrap text-sm text-ink">{lead.message}</p>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {facts
                  .filter(([, value]) => Boolean(value))
                  .map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3 border-b border-line py-1.5 text-sm">
                      <dt className="shrink-0 text-ink-subtle">{key}</dt>
                      <dd className="truncate text-navy-800">{value}</dd>
                    </div>
                  ))}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardBody>
              {lead.activities.length === 0 ? (
                <p className="text-xs text-ink-subtle">Nothing recorded yet.</p>
              ) : (
                <ol className="relative space-y-3 border-l border-line pl-4">
                  {lead.activities.map((activity) => (
                    <li key={activity.id} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[21px] top-1.5 size-1.5 rounded-full bg-brand-red"
                      />
                      <p className="text-sm text-navy-800">{activity.summary}</p>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        {activity.type.toLowerCase().replace(/_/g, " ")} ·{" "}
                        {DATETIME.format(activity.createdAt)}
                        {activity.actor ? ` · ${activity.actor.name}` : " · system"}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardBody>
              <NotesPanel leadId={lead.id} notes={lead.notes} canEdit={canEdit} />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Stage</CardTitle>
            </CardHeader>
            <CardBody>
              <StatusPanel leadId={lead.id} status={lead.status} canEdit={canEdit} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ownership</CardTitle>
            </CardHeader>
            <CardBody>
              <AssignPanel
                leadId={lead.id}
                currentId={lead.assignedTo?.id ?? null}
                staff={staff}
                canAssign={can(actor, "leads.assign")}
              />
              {lead.assignments.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-line pt-2.5 text-2xs text-ink-subtle">
                  {lead.assignments.map((entry) => (
                    <li key={entry.id}>
                      {entry.fromUser?.name ?? "Unassigned"} → {entry.toUser.name}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Follow-ups</CardTitle>
            </CardHeader>
            <CardBody>
              <TasksPanel leadId={lead.id} tasks={lead.tasks} staff={staff} canEdit={canEdit} />
            </CardBody>
          </Card>

          {lead.firstTouch || lead.lastTouch ? (
            <Card>
              <CardHeader>
                <CardTitle>Attribution</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <TouchRows label="First touch" touch={lead.firstTouch} />
                <TouchRows label="Last touch" touch={lead.lastTouch} />
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
