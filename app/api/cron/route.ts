import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";
import { runScheduledPublishing } from "@/lib/services/schedule.service";
import { publishDuePosts } from "@/lib/services/social-publish.service";
import { collectMetrics } from "@/lib/services/social-metrics.service";
import {
  renewIdleCredentials,
  syncDueAccounts,
  warnExpiringAccounts,
} from "@/lib/services/social-account.service";
import { socialProvider } from "@/lib/social";
import { syncDueGscProperties } from "@/lib/services/seo-intel/gsc-sync.service";
import { advanceCrawls, startDueCrawls } from "@/lib/services/seo-intel/crawl.service";
import { inspectDueUrls } from "@/lib/services/seo-intel/indexation.service";
import { detectDueOpportunities } from "@/lib/services/seo-intel/opportunity.service";
import { syncDueReviews } from "@/lib/services/seo-intel/reviews.service";
import { syncDueGa4Properties } from "@/lib/services/seo-intel/ga4-sync.service";
import { draftDueReports } from "@/lib/services/seo-intel/seo-report.service";
import { markOverdue } from "@/lib/services/invoice.service";
import { billDueRetainers, sendPaymentReminders } from "@/lib/services/retainer.service";
import { systemActor } from "@/lib/actor/types";
import { log } from "@/lib/logger";

/**
 * The scheduler's entry point.
 *
 * Nothing in this application runs on a clock, so scheduling is a pull: this
 * endpoint asks "what is due?" and acts, and something outside calls it on a
 * schedule (docs/DEPLOYMENT.md §4). It is deliberately the smallest thing that
 * works — a queue would be another piece of infrastructure to run and monitor
 * for a feature whose job is flipping a status twice a month.
 *
 * Authenticated by a shared secret, compared in constant time. With no secret
 * configured it refuses everything rather than running open: scheduling that
 * silently does not happen is a visible failure, and an unauthenticated
 * endpoint that publishes pages is not.
 *
 * Safe to call more often than needed and safe to call twice at once: every job
 * it runs selects only what is due and clears or leaves its own marker, so a
 * second concurrent run finds nothing to do.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cronLog = log("cron");

/**
 * Constant-time comparison that does not leak the secret's length.
 *
 * `timingSafeEqual` throws on a length mismatch, which is itself a signal, so
 * both sides are hashed to a fixed width first.
 */
function secretMatches(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  if (a.length !== b.length) {
    // Still do the work, so a wrong length is not measurably faster than a
    // wrong value.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** `Authorization: Bearer <secret>`, or `?secret=` for schedulers that cannot set headers. */
function providedSecret(request: Request, head: Headers): string | null {
  const authorization = head.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  const url = new URL(request.url);
  return url.searchParams.get("secret");
}

async function handle(request: Request): Promise<NextResponse> {
  const head = await headers();
  const expected = env().CRON_SECRET;

  if (!expected) {
    cronLog.warn("cron endpoint called with no CRON_SECRET configured");
    return NextResponse.json(
      { ok: false, message: "Scheduling is not configured." },
      { status: 503 },
    );
  }

  const provided = providedSecret(request, head);
  if (!provided || !secretMatches(provided, expected)) {
    // No detail: a caller without the secret learns nothing about it.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    // Pages and social posts are unrelated batches, so one failing wholesale
    // must not cost the other its run. Settled rather than awaited together.
    // Publishing first, then metrics: a post that goes out in this run is
    // worth asking about on the next one, not this one, and reading metrics is
    // never a reason to delay something going live.
    const [pages, social] = await Promise.allSettled([
      runScheduledPublishing(),
      publishDuePosts(),
    ]);
    const metrics = await Promise.allSettled([collectMetrics()]).then(([result]) => result);
    // Last, and never allowed to fail the run: keeping idle accounts alive is
    // housekeeping, not publishing.
    const renewal = await Promise.allSettled([renewIdleCredentials(socialProvider)]).then(
      ([result]) => result,
    );
    if (renewal.status === "rejected") {
      cronLog.error({ err: renewal.reason }, "renewing idle social credentials failed");
    }
    // The daily check of each account: the scheduled "Sync now".
    const accountSync = await Promise.allSettled([syncDueAccounts(socialProvider)]).then(([result]) => result);
    if (accountSync.status === "rejected") {
      cronLog.error({ err: accountSync.reason }, "scheduled social account checks failed");
    }
    // After renewal, so only what renewal could not extend is warned about.
    const expiring = await Promise.allSettled([warnExpiringAccounts()]).then(([result]) => result);
    if (expiring.status === "rejected") {
      cronLog.error({ err: expiring.reason }, "warning about expiring social accounts failed");
    }

    // Search Console: a couple of websites per run, history filled a month at
    // a time. Last, and never able to fail the run — it is a read.
    const seo = await Promise.allSettled([syncDueGscProperties({ limit: 2 })]).then(([result]) => result);
    // GA4, the same way: recent days every six hours, history a month per run.
    const analytics = await Promise.allSettled([syncDueGa4Properties({ limit: 2 })]).then(([result]) => result);
    if (analytics.status === "rejected") {
      cronLog.error({ err: analytics.reason }, "analytics sync failed");
    }
    if (seo.status === "rejected") {
      cronLog.error({ err: seo.reason }, "search console sync failed");
    }

    // Site crawls: start the weekly ones that are due, then work on running
    // crawls for a bounded time. Never able to fail the run.
    const crawlStart = await Promise.allSettled([startDueCrawls({ limit: 2 })]).then(([result]) => result);
    if (crawlStart.status === "rejected") {
      cronLog.error({ err: crawlStart.reason }, "starting scheduled crawls failed");
    }
    const crawl = await Promise.allSettled([advanceCrawls()]).then(([result]) => result);
    if (crawl.status === "rejected") {
      cronLog.error({ err: crawl.reason }, "advancing crawls failed");
    }
    // Google's own index status for a rotating sample of crawled URLs.
    const inspection = await Promise.allSettled([inspectDueUrls()]).then(([result]) => result);
    if (inspection.status === "rejected") {
      cronLog.error({ err: inspection.reason }, "URL inspection failed");
    }
    // Google reviews and listing details, once a day per location.
    const reviews = await Promise.allSettled([syncDueReviews({ limit: 5 })]).then(([result]) => result);
    if (reviews.status === "rejected") {
      cronLog.error({ err: reviews.reason }, "review sync failed");
    }
    // The daily opportunity detection, after the data it reads is fresh.
    const detection = await Promise.allSettled([detectDueOpportunities({ limit: 2 })]).then(([result]) => result);
    if (detection.status === "rejected") {
      cronLog.error({ err: detection.reason }, "opportunity detection failed");
    }
    // From the 3rd, draft last month's SEO report for each website. Staff publish.
    const seoReports = await Promise.allSettled([draftDueReports({ limit: 3 })]).then(([result]) => result);
    if (seoReports.status === "rejected") {
      cronLog.error({ err: seoReports.reason }, "drafting SEO reports failed");
    }

    // Finance: mark unpaid invoices overdue, bill retainers that are due,
    // and remind clients about invoices coming due soon.
    const financeActor = systemActor({
      permissions: ["invoices.create", "invoices.send"],
    });
    const [overdue, retainers, reminders] = await Promise.allSettled([
      markOverdue(),
      billDueRetainers(financeActor),
      sendPaymentReminders(financeActor),
    ]);
    if (overdue.status === "rejected") {
      cronLog.error({ err: overdue.reason }, "marking overdue invoices failed");
    }
    if (retainers.status === "rejected") {
      cronLog.error({ err: retainers.reason }, "retainer billing failed");
    }
    if (reminders.status === "rejected") {
      cronLog.error({ err: reminders.reason }, "payment reminders failed");
    }

    if (pages.status === "rejected") {
      cronLog.error({ err: pages.reason }, "scheduled page run failed");
    }
    if (social.status === "rejected") {
      cronLog.error({ err: social.reason }, "scheduled social run failed");
    }
    if (metrics.status === "rejected") {
      // Not fatal to the run: metrics are a read, and failing to read them
      // must never make the endpoint look like publishing broke.
      cronLog.error({ err: metrics.reason }, "metric collection failed");
    }
    if (pages.status === "rejected" && social.status === "rejected") {
      return NextResponse.json(
        { ok: false, message: "The scheduled run failed." },
        { status: 500 },
      );
    }

    const run = pages.status === "fulfilled" ? pages.value : null;

    return NextResponse.json({
      ok: true,
      published: run ? run.published.map((page) => page.slug) : [],
      unpublished: run ? run.unpublished.map((page) => page.slug) : [],
      failed: run ? run.failed.map((page) => ({ slug: page.slug, reason: page.reason })) : [],
      social:
        social.status === "fulfilled"
          ? {
              attempted: social.value.attempted,
              published: social.value.published,
              // Post ids and reasons only. A caller holding the cron secret is
              // an operator, not a client, but there is still no reason to
              // echo captions into a scheduler's response.
              failed: social.value.failed.map((entry) => ({
                postId: entry.postId,
                reason: entry.reason,
              })),
            }
          : { attempted: 0, published: 0, failed: [] },
      metrics:
        metrics.status === "fulfilled"
          ? {
              attempted: metrics.value.attempted,
              captured: metrics.value.captured,
              skipped: metrics.value.skipped.length,
              failed: metrics.value.failed.length,
            }
          : { attempted: 0, captured: 0, skipped: 0, failed: 0 },
      credentials:
        renewal.status === "fulfilled" ? renewal.value : { renewed: 0, failed: 0 },
      accountsChecked: accountSync.status === "fulfilled" ? accountSync.value : { checked: 0, failed: 0 },
      expiringWarned: expiring.status === "fulfilled" ? expiring.value.warned : 0,
      searchConsole: seo.status === "fulfilled" ? seo.value : { synced: 0, failed: 0 },
      analytics: analytics.status === "fulfilled" ? analytics.value : { synced: 0, failed: 0 },
      crawls: {
        started: crawlStart.status === "fulfilled" ? crawlStart.value : 0,
        ...(crawl.status === "fulfilled" ? crawl.value : { pages: 0, finished: 0, failed: 0 }),
      },
      urlInspections: inspection.status === "fulfilled" ? inspection.value.inspected : 0,
      reviewLocationsSynced: reviews.status === "fulfilled" ? reviews.value : 0,
      opportunitiesDetected: detection.status === "fulfilled" ? detection.value.detected : 0,
      seoReportsDrafted: seoReports.status === "fulfilled" ? seoReports.value : 0,
      finance: {
        overdue: overdue.status === "fulfilled" ? overdue.value : 0,
        retainersRaised: retainers.status === "fulfilled" ? retainers.value.length : 0,
        remindersSent: reminders.status === "fulfilled" ? reminders.value.length : 0,
      },
      pagesFailed: pages.status === "rejected",
      socialFailed: social.status === "rejected",
      metricsFailed: metrics.status === "rejected",
    });
  } catch (error) {
    cronLog.error({ err: error }, "scheduled run failed");
    return NextResponse.json({ ok: false, message: "The scheduled run failed." }, { status: 500 });
  }
}

/** Both verbs, because schedulers differ on which they use for a plain trigger. */
export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
