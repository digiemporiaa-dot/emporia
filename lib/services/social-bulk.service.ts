import "server-only";
import { db } from "@/lib/db";
import { isAppError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import { addDays, CALENDAR_TIME_ZONE, startOfZonedDay, zonedDay } from "@/lib/social/calendar";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { log } from "@/lib/logger";
import { decideInternalReview } from "@/lib/services/social-review.service";
import { requestSocialApproval } from "@/lib/services/social-approval.service";
import { reschedulePost, setPostStatus } from "@/lib/services/social-post.service";
import { deleteDraftContent, setContentOwner } from "@/lib/services/social-content.service";
import type { Actor } from "@/lib/actor/types";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Bulk actions on a client's social content (brief §39).
 *
 * Each action is the single-item service run once per item — the same
 * permission, ownership, readiness and workflow checks, and one audit entry
 * per item — never a shortcut `updateMany` around them. Items are handled one
 * by one and reported one by one: one idea that is not ready does not stop the
 * other nine, and the person sees exactly which one and why.
 *
 * Deliberately absent: bulk *publish now*. Publishing is the one irreversible
 * step, so it stays a single, confirmed action on a version. Scheduling in
 * bulk is safe because the scheduler still checks every version at its time.
 */

const bulkLog = log("social");

export const BULK_MAX = 100;

export type BulkResult = { id: string; label: string; ok: boolean; message: string | null };

export type BulkAction =
  | { kind: "approve"; feedback: string | null }
  | { kind: "requestClientReview"; note: string | null }
  | { kind: "schedule" }
  | { kind: "reschedule"; shiftDays: number }
  | { kind: "reschedule"; toDay: string }
  | { kind: "assign"; ownerId: string | null }
  | { kind: "deleteDrafts" };

/** The permission a whole bulk call needs, checked before any item is touched. */
const PERMISSION: Record<BulkAction["kind"], Permission> = {
  approve: "social.review",
  requestClientReview: "social.approve",
  schedule: "social.edit",
  reschedule: "social.edit",
  assign: "social.edit",
  deleteDrafts: "social.delete",
};

function failure(error: unknown): string {
  if (isAppError(error)) return error.message;
  bulkLog.error({ err: error }, "a bulk action item failed");
  return "Something went wrong with this one.";
}

async function each<T extends { id: string }>(
  rows: readonly T[],
  label: (row: T) => string,
  work: (row: T) => Promise<string | null | void>,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  // In order, not in parallel: every item takes its own transaction and audit
  // entry, and a hundred at once would contend for the same rows and locks.
  for (const row of rows) {
    try {
      const skipped = await work(row);
      results.push({ id: row.id, label: label(row), ok: !skipped, message: skipped ?? null });
    } catch (error) {
      results.push({ id: row.id, label: label(row), ok: false, message: failure(error) });
    }
  }
  return results;
}

/** Where a time lands when its day moves: the same time of day, on the new day, in the calendar's zone. */
function moveToDay(instant: Date, day: { year: number; month: number; day: number }): Date {
  const offset = instant.getTime() - startOfZonedDay(zonedDay(instant, CALENDAR_TIME_ZONE), CALENDAR_TIME_ZONE).getTime();
  return new Date(startOfZonedDay(day, CALENDAR_TIME_ZONE).getTime() + offset);
}

export async function runBulkAction(
  actor: Actor,
  input: { clientId: string; itemIds: string[]; action: BulkAction },
): Promise<BulkResult[]> {
  requirePermission(actor, "social.view");
  requirePermission(actor, PERMISSION[input.action.kind]);
  const scope = await resolveClientScope(actor, input.clientId);

  const ids = [...new Set(input.itemIds)];
  if (ids.length === 0) throw new ValidationError("Select at least one idea.");
  if (ids.length > BULK_MAX) throw new ValidationError(`Select at most ${BULK_MAX} at a time.`);

  // Only this client's ideas. An id from anywhere else is reported as not
  // found — the same answer as an id that does not exist.
  const items = await db.contentCalendarItem.findMany({
    where: { id: { in: ids }, clientId: scope },
    select: {
      id: true,
      title: true,
      scheduledFor: true,
      socialPosts: {
        orderBy: { order: "asc" },
        select: { id: true, provider: true, status: true, scheduledFor: true },
      },
    },
  });
  const found = new Map(items.map((item) => [item.id, item]));
  const missing: BulkResult[] = ids
    .filter((id) => !found.has(id))
    .map((id) => ({ id, label: "Unknown item", ok: false, message: "Not found." }));
  const ordered = ids.map((id) => found.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const title = (item: { title: string }) => item.title;

  const action = input.action;
  let results: BulkResult[];

  switch (action.kind) {
    case "approve":
      results = await each(ordered, title, async (item) => {
        await decideInternalReview(actor, { contentItemId: item.id, decision: "APPROVED", feedback: action.feedback });
      });
      break;

    case "requestClientReview":
      results = await each(ordered, title, async (item) => {
        await requestSocialApproval(actor, { contentItemId: item.id, note: action.note });
      });
      break;

    case "assign":
      results = await each(ordered, title, async (item) => {
        await setContentOwner(actor, item.id, action.ownerId);
      });
      break;

    case "deleteDrafts":
      results = await each(ordered, title, async (item) => {
        await deleteDraftContent(actor, item.id);
      });
      break;

    case "schedule": {
      // Per version: that is what goes out. Drafts only — a failed version
      // is retried from the queue, where its last attempt can be seen.
      const versions = ordered.flatMap((item) => item.socialPosts.map((post) => ({ ...post, item })));
      results = await each(
        versions,
        (v) => `${v.item.title} — ${PROVIDER_LABEL[v.provider]}`,
        async (v) => {
          if (v.status === "SCHEDULED") return "Already scheduled.";
          if (v.status !== "DRAFT") return `It is ${v.status.toLowerCase()}; schedule it from its own page.`;
          // A slot already gone would be sent the moment the scheduler runs:
          // that is publishing, not scheduling.
          if (v.scheduledFor && v.scheduledFor.getTime() < Date.now()) return "Its time has passed. Reschedule it first.";
          await setPostStatus(actor, v.id, "SCHEDULED");
        },
      );
      break;
    }

    case "reschedule": {
      const target =
        "toDay" in action
          ? (() => {
              const [y, m, d] = action.toDay.split("-").map(Number) as [number, number, number];
              return { year: y, month: m, day: d };
            })()
          : null;
      const shift = "shiftDays" in action ? action.shiftDays : 0;
      const newTime = (at: Date) =>
        target ? moveToDay(at, target) : moveToDay(at, addDays(zonedDay(at, CALENDAR_TIME_ZONE), shift));

      const versions = ordered.flatMap((item) => item.socialPosts.map((post) => ({ ...post, item })));
      results = await each(
        versions,
        (v) => `${v.item.title} — ${PROVIDER_LABEL[v.provider]}`,
        async (v) => {
          if (v.status === "PUBLISHED" || v.status === "PUBLISHING") return "Already gone out.";
          if (v.status === "CANCELLED") return "Cancelled.";
          if (!v.scheduledFor) return "It has no time to move. Give it one first.";
          const at = newTime(v.scheduledFor);
          if (at.getTime() < Date.now()) return "That would put it in the past.";
          await reschedulePost(actor, v.id, at);
        },
      );

      // The idea's own date moves with its versions, so the calendar and the
      // content list keep agreeing.
      for (const item of ordered) {
        if (!item.scheduledFor || !results.some((r) => r.ok && item.socialPosts.some((p) => p.id === r.id))) continue;
        const at = newTime(item.scheduledFor);
        await withAudit(
          {
            actor,
            action: "UPDATE",
            entityType: "ContentCalendarItem",
            entityId: item.id,
            before: { scheduledFor: item.scheduledFor.toISOString() },
            after: { scheduledFor: at.toISOString(), rescheduled: true },
          },
          (tx) => tx.contentCalendarItem.update({ where: { id: item.id }, data: { scheduledFor: at }, select: { id: true } }),
        );
      }
      break;
    }
  }

  return [...results, ...missing];
}
