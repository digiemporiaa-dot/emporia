import type { Metadata } from "next";
import Link from "next/link";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listContent } from "@/lib/services/portal.service";
import { CONTENT_CHANNEL_LABEL, CONTENT_STAGE_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody } from "@/components/ui";
import type { ContentStage } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Content" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const TONE: Partial<Record<ContentStage, "neutral" | "navy" | "warning" | "success">> = {
  CLIENT_REVIEW: "warning",
  APPROVED: "navy",
  SCHEDULED: "navy",
  PUBLISHED: "success",
};

export default async function PortalContentPage() {
  const actor = await requirePortalActorPage();
  const items = await listContent(actor);

  const awaiting = items.filter((item) => item.stage === "CLIENT_REVIEW");
  const rest = items.filter((item) => item.stage !== "CLIENT_REVIEW");

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Content</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          What is with you for review, scheduled, and already live. Ideas and internal drafts stay on
          our side until they are ready to show you.
        </p>
      </header>

      {items.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">Nothing to show yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {awaiting.length > 0 ? (
            <section>
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-brand-red">
                With you for review
              </h2>
              <ul className="mt-2 space-y-2">
                {awaiting.map((item) => (
                  <li key={item.id}>
                    <Card>
                      <CardBody>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-navy-800">{item.title}</p>
                            <p className="mt-0.5 text-2xs text-ink-subtle">
                              {CONTENT_CHANNEL_LABEL[item.channel]}
                              {item.project ? ` · ${item.project.name}` : ""}
                            </p>
                            {item.brief ? (
                              <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink">
                                {item.brief}
                              </p>
                            ) : null}
                          </div>
                          <Badge tone="warning">{CONTENT_STAGE_LABEL[item.stage]}</Badge>
                        </div>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-ink-subtle">
                Approving happens under{" "}
                <Link href="/portal/approvals" className="underline underline-offset-2">
                  Approvals
                </Link>
                , where each version and its feedback are kept together.
              </p>
            </section>
          ) : null}

          {rest.length > 0 ? (
            <section>
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Scheduled and published
              </h2>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
                {rest.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-navy-800">{item.title}</p>
                      <p className="text-2xs text-ink-subtle">
                        {CONTENT_CHANNEL_LABEL[item.channel]}
                        {item.scheduledFor ? ` · ${DATE.format(item.scheduledFor)}` : ""}
                      </p>
                    </div>
                    <Badge tone={TONE[item.stage] ?? "neutral"}>
                      {CONTENT_STAGE_LABEL[item.stage]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
