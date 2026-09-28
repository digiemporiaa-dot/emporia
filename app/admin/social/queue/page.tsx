import type { Metadata } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { queueCounts, socialQueue } from "@/lib/services/social-queue.service";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { CALENDAR_TIME_ZONE, zoneLabel } from "@/lib/social/calendar";
import { Card, CardBody } from "@/components/ui";
import { QueueBoard, type QueueBands, type QueueCard } from "./queue-board";
import type { QueueRow } from "@/lib/services/social-queue.service";

export const metadata: Metadata = { title: "Publishing queue" };
export const dynamic = "force-dynamic";

/**
 * What is going out, what broke, and what is waiting on somebody.
 *
 * Agency-wide by default. A social manager's first question in the morning is
 * "is anything broken", and answering it one client at a time is not answering
 * it — so the client is a filter here rather than the route, which is the one
 * place in this module that is true.
 */

const paramsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .max(40)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .catch(null),
  provider: z.enum(SOCIAL_PROVIDERS).nullable().catch(null),
});

function toCard(row: QueueRow): QueueCard {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    itemId: row.contentItem.id,
    title: row.contentItem.title,
    provider: row.provider,
    status: row.status,
    campaign: row.contentItem.campaign?.name ?? null,
    accountName: row.account?.name ?? null,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    attemptCount: row.attemptCount,
    externalUrl: row.externalUrl,
    lastError: row.lastError,
  };
}

export default async function SocialQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/social/queue");
  const raw = await searchParams;
  const params = paramsSchema.parse(raw);
  const filters = { clientId: params.clientId, provider: params.provider };

  const [queue, counts, clients] = await Promise.all([
    socialQueue(actor, filters),
    queueCounts(actor, filters),
    // Only clients that actually have social work, so the filter is not a list
    // of every client the agency has ever had.
    db.client.findMany({
      where: { deletedAt: null, socialPosts: { some: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const bands: QueueBands = {
    stranded: queue.stranded.map(toCard),
    needsRetry: queue.needsRetry.map(toCard),
    retrying: queue.retrying.map(toCard),
    inFlight: queue.inFlight.map(toCard),
    due: queue.due.map(toCard),
    upcoming: queue.upcoming.map(toCard),
    recent: queue.recent.map(toCard),
  };

  const healthy = counts.stranded === 0 && counts.failed === 0;

  return (
    <>
      <header className="mb-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">Social</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Publishing queue</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {healthy
            ? `Nothing needs attention. ${counts.due} due, ${counts.upcoming} scheduled.`
            : [
                counts.stranded > 0 ? `${counts.stranded} interrupted` : null,
                counts.failed > 0 ? `${counts.failed} failed` : null,
                `${counts.due} due`,
                `${counts.upcoming} scheduled`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </header>

      {clients.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">
              No social posts exist yet. They appear here once a version is scheduled.
            </p>
          </CardBody>
        </Card>
      ) : (
        <QueueBoard
          bands={bands}
          clients={clients}
          providers={[...SOCIAL_PROVIDERS]}
          activeClient={params.clientId}
          activeProvider={params.provider}
          canPublish={can(actor, "social.publish")}
          zone={zoneLabel(CALENDAR_TIME_ZONE)}
        />
      )}
    </>
  );
}
