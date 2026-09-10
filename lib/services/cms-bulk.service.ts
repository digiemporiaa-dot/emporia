import "server-only";
import { requireStaff } from "@/lib/auth/rbac";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  CONTENT_REGISTRY,
  isContentType,
  type ContentState,
  type ContentType,
} from "@/lib/cms/registry";
import { setPageStatus } from "@/lib/services/page.service";
import { setReusableStatus } from "@/lib/services/reusable-section.service";
import { setPostStatus } from "@/lib/services/blog.service";
import { setCaseStudyStatus } from "@/lib/services/case-study.service";
import { setTestimonialStatus } from "@/lib/services/testimonial.service";
import { setFaqActive } from "@/lib/services/faq.service";
import { setServiceStatus } from "@/lib/services/service.service";
import { setCityActive } from "@/lib/services/city.service";
import { setPackageStatus } from "@/lib/services/package.service";
import { publishPage, unpublishPage } from "@/lib/services/serviceCityPage.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Bulk publish, unpublish and archive.
 *
 * ## The one rule that matters
 *
 * Every record goes through **the same function a person clicking one button
 * would go through**. Nothing here writes a status column.
 *
 * That is not tidiness. `ServiceCityPage.publish` refuses a page without enough
 * genuine local content and refuses one whose city is switched off
 * (CLAUDE.md 9); every type's path checks its own permission, writes its own
 * audit row and busts its own cache. A bulk action that wrote
 * `status: "PUBLISHED"` directly would be a way around all of it — and the way
 * around would be the convenient one, so it would get used.
 *
 * ## Partial failure is the normal case, not an error
 *
 * Selecting forty pages and publishing them, three of which are too thin, is a
 * success with three refusals — not a failure, and not a silent success either.
 * Each record is attempted independently and its own error becomes that row's
 * reason, so the report says which three and why. One transaction around the
 * lot would roll back the thirty-seven that were fine.
 */

const bulkLog = log("cms-bulk");

export type BulkAction = "publish" | "unpublish" | "archive";

/** What a bulk action is asked to act on. */
export type BulkTarget = { type: ContentType; id: string };

export type BulkOutcome = {
  changed: BulkTarget[];
  failed: (BulkTarget & { reason: string })[];
};

/** The state each action puts a record into. */
const STATE_FOR: Record<BulkAction, ContentState> = {
  publish: "PUBLISHED",
  unpublish: "DRAFT",
  archive: "ARCHIVED",
};

/**
 * Apply one state change to one record, through that type's own path.
 *
 * The two boolean-backed types are mapped here rather than given fake enum
 * setters: a city is switched on or off, and pretending otherwise would put a
 * word in the audit log that does not describe what happened.
 */
async function applyOne(actor: Actor, target: BulkTarget, state: ContentState): Promise<void> {
  switch (target.type) {
    case "page":
      await setPageStatus(actor, target.id, state);
      return;
    case "reusableSection":
      await setReusableStatus(actor, target.id, state);
      return;
    case "blogPost":
      await setPostStatus(actor, target.id, state);
      return;
    case "caseStudy":
      await setCaseStudyStatus(actor, target.id, state);
      return;
    case "testimonial":
      await setTestimonialStatus(actor, target.id, state);
      return;
    case "service":
      await setServiceStatus(actor, target.id, state);
      return;
    case "servicePackage":
      await setPackageStatus(actor, target.id, state);
      return;
    case "faq":
      await setFaqActive(actor, target.id, state === "PUBLISHED");
      return;
    case "city":
      await setCityActive(actor, target.id, state === "PUBLISHED");
      return;
    case "serviceCityPage":
      // The only path to PUBLISHED, and it runs `canPublish` first. A thin
      // local page refuses here exactly as it would from its own screen.
      if (state === "PUBLISHED") await publishPage(actor, target.id);
      else await unpublishPage(actor, target.id);
      return;
  }
}

/** How many records one action may touch at once. */
export const BULK_LIMIT = 100;

export async function bulkSetState(
  actor: Actor,
  targets: readonly BulkTarget[],
  action: BulkAction,
): Promise<BulkOutcome> {
  requireStaff(actor);

  const outcome: BulkOutcome = { changed: [], failed: [] };
  const state = STATE_FOR[action];

  // Capped rather than unbounded: this issues a query per record, and a
  // selection of ten thousand would be a request that never returns.
  const capped = targets.slice(0, BULK_LIMIT);

  for (const target of capped) {
    if (!isContentType(target.type)) {
      outcome.failed.push({ ...target, reason: "Unknown content type." });
      continue;
    }

    const meta = CONTENT_REGISTRY[target.type];

    // Refused with a reason rather than silently skipped: asking to archive a
    // city is a mistake worth telling someone about.
    if (!meta.states.includes(state)) {
      outcome.failed.push({
        ...target,
        reason: `A ${meta.label.toLowerCase()} cannot be ${state.toLowerCase()}.`,
      });
      continue;
    }

    try {
      await applyOne(actor, target, state);
      outcome.changed.push(target);
    } catch (error) {
      // The record's own error is the row's reason, so a thin local page says
      // it is thin rather than "failed". An unexpected error is not shown
      // verbatim — CLAUDE.md 11 forbids surfacing internals — but is logged.
      if (error instanceof AppError) {
        outcome.failed.push({ ...target, reason: error.message });
      } else {
        bulkLog.error({ err: error, target }, "bulk action failed unexpectedly");
        outcome.failed.push({ ...target, reason: "That did not work." });
      }
    }
  }

  for (const target of targets.slice(BULK_LIMIT)) {
    outcome.failed.push({ ...target, reason: `Only ${BULK_LIMIT} at a time.` });
  }

  bulkLog.info(
    { action, changed: outcome.changed.length, failed: outcome.failed.length },
    "bulk action ran",
  );

  return outcome;
}
