import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { systemActor } from "@/lib/actor/types";
import { setPageStatus } from "@/lib/services/page.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Scheduled publishing.
 *
 * Nothing in this application ran on a clock before this: the automation engine
 * is post-commit and event-driven, and there is no queue. So scheduling is a
 * *pull*, not a push — one endpoint that asks "what is due?", called on a
 * schedule by whatever is already scheduling things in the deployment
 * (docs/DEPLOYMENT.md §4). That is deliberately the smallest thing that works:
 * a queue would be a second piece of infrastructure to run, monitor and get
 * wrong, for a feature whose whole job is flipping a boolean twice a month.
 *
 * The consequence to be honest about is granularity. A page goes live on the
 * first run *after* its time, so the schedule is as precise as the cron that
 * drives it — every five minutes means "within five minutes", not "at 09:00:00".
 * That is fine for a campaign page and would not be for a stock ticker.
 */

const scheduleLog = log("schedule");

/**
 * Who the scheduler acts as.
 *
 * A real actor with exactly the permissions the job needs, rather than a
 * bypass: the publish then goes through `setPageStatus` like any other, which
 * means it takes a version, writes an audit row and busts the cache in the same
 * transaction as every hand-made publish. A second publish path that skipped
 * any of those would drift from the first one the day someone changed it.
 */
export function schedulerActor(): Actor {
  return {
    ...systemActor(),
    name: "Scheduler",
    permissions: new Set(["pages.view", "pages.edit", "pages.publish"]),
  };
}

export type ScheduleRun = {
  published: { id: string; slug: string }[];
  unpublished: { id: string; slug: string }[];
  failed: { id: string; slug: string; reason: string }[];
};

/**
 * Publish and unpublish everything that is due.
 *
 * Publishes are processed before unpublishes, so a page whose whole run window
 * has already passed — scheduled up on Monday and down on Friday, and nobody
 * ran the job until Saturday — ends where it should: down. Doing it the other
 * way would leave it live.
 *
 * One page failing does not stop the others. A schedule is a batch of unrelated
 * decisions, and letting a single bad page hold back everyone else's launch is
 * the opposite of what it is for.
 */
export async function runScheduledPublishing(now = new Date()): Promise<ScheduleRun> {
  const actor = schedulerActor();
  const run: ScheduleRun = { published: [], unpublished: [], failed: [] };

  const toPublish = await db.page.findMany({
    where: {
      deletedAt: null,
      publishAt: { not: null, lte: now },
      // ARCHIVED is deliberately excluded: archiving is a decision, and a stale
      // schedule should not undo it.
      status: "DRAFT",
    },
    select: { id: true, slug: true },
  });

  for (const page of toPublish) {
    try {
      await setPageStatus(actor, page.id, "PUBLISHED");
      // Cleared so a scheduled publish happens once. Done after the publish, so
      // a failure leaves the page due rather than silently skipped forever.
      await db.page.update({ where: { id: page.id }, data: { publishAt: null } });
      run.published.push(page);
    } catch (error) {
      run.failed.push({ ...page, reason: error instanceof Error ? error.message : "unknown" });
      scheduleLog.error({ err: error, pageId: page.id }, "scheduled publish failed");
    }
  }

  const toUnpublish = await db.page.findMany({
    where: {
      deletedAt: null,
      unpublishAt: { not: null, lte: now },
      status: "PUBLISHED",
    },
    select: { id: true, slug: true },
  });

  for (const page of toUnpublish) {
    try {
      await setPageStatus(actor, page.id, "DRAFT");
      // `unpublishAt` is kept on purpose. A page taken down and manually put
      // back should come down again at its end date unless someone changes it.
      run.unpublished.push(page);
    } catch (error) {
      run.failed.push({ ...page, reason: error instanceof Error ? error.message : "unknown" });
      scheduleLog.error({ err: error, pageId: page.id }, "scheduled unpublish failed");
    }
  }

  if (run.published.length || run.unpublished.length || run.failed.length) {
    scheduleLog.info(
      {
        published: run.published.length,
        unpublished: run.unpublished.length,
        failed: run.failed.length,
      },
      "scheduled publishing ran",
    );
  }

  return run;
}
