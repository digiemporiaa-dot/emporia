import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listContent } from "@/lib/services/delivery-content.service";
import { listProjects } from "@/lib/services/project.service";
import { contentListParamsSchema } from "@/lib/validation/project";
import {
  CONTENT_CHANNEL_LABEL,
  CONTENT_STAGES,
  CONTENT_STAGE_LABEL,
} from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody } from "@/components/ui";
import { ContentFilters, ContentItemForm } from "./content-panels";
import type { ContentStage } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Content calendar" };
export const dynamic = "force-dynamic";

const STAGE_TONE: Record<ContentStage, "neutral" | "navy" | "warning" | "success"> = {
  IDEA: "neutral",
  DRAFT: "neutral",
  INTERNAL_REVIEW: "warning",
  CLIENT_REVIEW: "warning",
  APPROVED: "navy",
  SCHEDULED: "navy",
  PUBLISHED: "success",
};

const TIME = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

/** The calendar grid runs Monday to Sunday. */
function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - offset);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    days.push(day);
  }
  return days;
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/content");
  requirePermission(actor, "content.view");

  const raw = await searchParams;
  const parsed = contentListParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : contentListParamsSchema.parse({});

  const now = new Date();
  const monthKey =
    params.month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [yearPart, monthPart] = monthKey.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart) - 1;

  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

  const [items, projectList, staff] = await Promise.all([
    listContent(actor, {
      // The board view is about workflow state, not dates, so it is not
      // restricted to the month.
      from: params.view === "calendar" ? from : null,
      to: params.view === "calendar" ? to : null,
      channel: params.channel ?? null,
      stage: params.stage ?? null,
      projectId: params.projectId ?? null,
    }),
    // The project picker is only for someone who can see projects at all;
    // content itself is already scoped by project visibility, so a role with
    // content.view alone gets an empty calendar rather than an error.
    can(actor, "projects.view")
      ? listProjects(actor, { perPage: 100, status: null })
      : Promise.resolve({ rows: [] as { id: string; code: string; name: string }[] }),
    can(actor, "content.create")
      ? db.user.findMany({
          where: { type: "STAFF", status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const projects = projectList.rows.map((project) => ({
    id: project.id,
    label: `${project.code} — ${project.name}`,
  }));

  const monthLabel = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(from);

  const unscheduled = items.filter((item) => !item.scheduledFor);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Delivery</p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Content calendar</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {params.view === "calendar" ? monthLabel : "Every item by workflow stage"} ·{" "}
            {items.length} item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        {can(actor, "content.create") && projects.length > 0 ? (
          <ContentItemForm projects={projects} staff={staff} />
        ) : null}
      </header>

      <ContentFilters projects={projects} month={monthKey} />

      {projects.length === 0 ? (
        <Card className="mt-4">
          <CardBody>
            <p className="text-sm text-ink-subtle">
              {can(actor, "projects.view")
                ? "Content items belong to a project. Start a project first."
                : "Content is scoped to the projects you work on, and you are not on any."}
            </p>
          </CardBody>
        </Card>
      ) : params.view === "board" ? (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-3">
          {CONTENT_STAGES.map((stage) => {
            const column = items.filter((item) => item.stage === stage);
            return (
              <section
                key={stage}
                aria-label={CONTENT_STAGE_LABEL[stage]}
                className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-surface-muted"
              >
                <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2.5">
                  <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                    {CONTENT_STAGE_LABEL[stage]}
                  </h2>
                  <span className="text-xs tabular-nums text-ink-subtle">{column.length}</span>
                </header>
                <ul className="flex-1 space-y-2 p-2">
                  {column.length === 0 ? (
                    <li className="px-1 py-6 text-center text-xs text-ink-subtle">Nothing here</li>
                  ) : (
                    column.map((item) => (
                      <li key={item.id} className="rounded-md border border-line bg-white p-2.5">
                        <Link
                          href={`/admin/content/${item.id}`}
                          className="text-sm text-navy-800 hover:text-brand-red"
                        >
                          {item.title}
                        </Link>
                        <p className="mt-1 text-2xs text-ink-subtle">
                          {CONTENT_CHANNEL_LABEL[item.channel]} · {item.client.name}
                        </p>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <div className="grid min-w-3xl grid-cols-7 gap-px rounded-lg border border-line bg-line">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div
                  key={day}
                  className="bg-surface-muted px-2 py-1.5 text-2xs font-semibold uppercase tracking-widest text-ink-subtle"
                >
                  {day}
                </div>
              ))}

              {monthGrid(year, month).map((day) => {
                const key = day.toISOString().slice(0, 10);
                const inMonth = day.getUTCMonth() === month;
                const scheduled = items.filter(
                  (item) => item.scheduledFor && item.scheduledFor.toISOString().slice(0, 10) === key,
                );

                return (
                  <div
                    key={key}
                    className={`min-h-24 bg-white p-1.5 ${inMonth ? "" : "bg-surface-muted/60"}`}
                  >
                    <p
                      className={`text-2xs tabular-nums ${inMonth ? "text-ink-muted" : "text-ink-subtle/60"}`}
                    >
                      {day.getUTCDate()}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {scheduled.map((item) => (
                        <li key={item.id}>
                          <Link
                            href={`/admin/content/${item.id}`}
                            className="block rounded-sm border border-line bg-surface-muted px-1.5 py-1 text-2xs text-navy-800 hover:border-brand-red hover:text-brand-red"
                          >
                            <span className="block truncate font-medium">{item.title}</span>
                            <span className="block truncate text-ink-subtle">
                              {CONTENT_CHANNEL_LABEL[item.channel]}
                              {item.scheduledFor ? ` · ${TIME.format(item.scheduledFor)}` : ""}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          {unscheduled.length > 0 ? (
            <section className="mt-5">
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Not yet scheduled
              </h2>
              <ul className="mt-2 space-y-2">
                {unscheduled.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2"
                  >
                    <Link
                      href={`/admin/content/${item.id}`}
                      className="text-sm text-navy-800 hover:text-brand-red"
                    >
                      {item.title}
                    </Link>
                    <span className="flex items-center gap-2 text-2xs text-ink-subtle">
                      {CONTENT_CHANNEL_LABEL[item.channel]} · {item.client.name}
                      <Badge tone={STAGE_TONE[item.stage]}>{CONTENT_STAGE_LABEL[item.stage]}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
