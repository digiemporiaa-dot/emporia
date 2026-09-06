import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { withAudit } from "@/lib/services/audit.service";
import { selectPopup, type PageContext, type VisitorState } from "@/lib/popups/targeting";
import type { Actor } from "@/lib/actor/types";
import type { PopupEventType } from "@/generated/prisma/enums";
import type { PopupInput } from "@/lib/validation/popup";

/**
 * Popup engine.
 *
 * Targeting is resolved here, on the server, and the caller receives at most
 * one popup (CLAUDE.md 10).
 */

export const POPUP_TAG = "popups";

export type ResolvedPopup = {
  id: string;
  title: string;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  formFields: unknown;
  trigger: string;
  triggerValue: number | null;
  frequency: string;
};

/**
 * Find the popup to show for this page and visitor.
 *
 * Only the fields needed to render are returned — targeting rules, schedule and
 * priority stay on the server.
 */
export async function resolveForPage(
  page: PageContext,
  visitor: VisitorState,
): Promise<ResolvedPopup | null> {
  const candidates = await db.popup.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: visitor.now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: visitor.now } }] },
      ],
    },
    orderBy: { priority: "desc" },
    select: {
      id: true,
      title: true,
      body: true,
      ctaLabel: true,
      ctaHref: true,
      formFields: true,
      trigger: true,
      triggerValue: true,
      frequency: true,
      priority: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      updatedAt: true,
      targets: {
        select: {
          type: true,
          path: true,
          serviceId: true,
          cityId: true,
          serviceCityPageId: true,
          packageId: true,
          visitorType: true,
          device: true,
        },
      },
    },
  });

  const chosen = selectPopup(candidates, page, visitor);
  if (!chosen) return null;

  const full = candidates.find((c) => c.id === chosen.id);
  if (!full) return null;

  return {
    id: full.id,
    title: full.title,
    body: full.body,
    ctaLabel: full.ctaLabel,
    ctaHref: full.ctaHref,
    formFields: full.formFields,
    trigger: full.trigger,
    triggerValue: full.triggerValue,
    frequency: full.frequency,
  };
}

export type PopupEventInput = {
  popupId: string;
  event: PopupEventType;
  visitorId: string;
  path: string;
  serviceId?: string | null;
  cityId?: string | null;
  campaignId?: string | null;
  utmId?: string | null;
  leadId?: string | null;
};

/**
 * Record an analytics event.
 *
 * Deliberately tolerant: a failure to record an impression must never break the
 * page the visitor is on.
 */
export async function recordEvent(input: PopupEventInput): Promise<void> {
  try {
    await db.popupAnalytics.create({
      data: {
        popupId: input.popupId,
        event: input.event,
        visitorId: input.visitorId,
        path: input.path,
        serviceId: input.serviceId ?? null,
        cityId: input.cityId ?? null,
        campaignId: input.campaignId ?? null,
        utmId: input.utmId ?? null,
        leadId: input.leadId ?? null,
      },
    });
  } catch {
    // Swallowed on purpose. Analytics is not worth a 500 to the visitor.
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listPopups(actor: Actor, params: Partial<PageParams> = {}) {
  requirePermission(actor, "popups.view");

  const { page, perPage, skip, take } = toSkipTake(params);

  const rows = await db.popup.findMany({
    skip,
    take,
    orderBy: [{ isActive: "desc" }, { priority: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      title: true,
      trigger: true,
      frequency: true,
      priority: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      _count: { select: { targets: true, leads: true } },
    },
  });

  const total = await db.popup.count();

  return paged(rows, total, page, perPage);
}

export async function getPopup(actor: Actor, id: string) {
  requirePermission(actor, "popups.view");

  const popup = await db.popup.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      title: true,
      body: true,
      ctaLabel: true,
      ctaHref: true,
      trigger: true,
      triggerValue: true,
      frequency: true,
      priority: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      targets: {
        select: {
          id: true,
          type: true,
          path: true,
          serviceId: true,
          cityId: true,
          serviceCityPageId: true,
          packageId: true,
          visitorType: true,
          device: true,
        },
      },
    },
  });

  if (!popup) throw new NotFoundError("That popup does not exist.");
  return popup;
}

/** Funnel counts for one popup, from real recorded events. */
export async function popupStats(actor: Actor, id: string) {
  requirePermission(actor, "popups.view");

  const rows = await db.popupAnalytics.groupBy({
    by: ["event"],
    where: { popupId: id },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.event] = row._count._all;

  return {
    impressions: counts["IMPRESSION"] ?? 0,
    views: counts["VIEW"] ?? 0,
    formStarts: counts["FORM_START"] ?? 0,
    submissions: counts["SUBMISSION"] ?? 0,
    conversions: counts["CONVERSION"] ?? 0,
  };
}


export async function createPopup(actor: Actor, input: PopupInput) {
  requirePermission(actor, "popups.create");
  if (input.isActive) requirePermission(actor, "popups.publish");

  const popup = await withAudit(
    { actor, action: "CREATE", entityType: "Popup", entityId: input.name },
    async (tx) => {
      const created = await tx.popup.create({
        data: {
          name: input.name,
          title: input.title,
          body: input.body ?? null,
          ctaLabel: input.ctaLabel ?? null,
          ctaHref: input.ctaHref ?? null,
          trigger: input.trigger,
          triggerValue: input.triggerValue ?? null,
          frequency: input.frequency,
          priority: input.priority,
          isActive: input.isActive,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
        },
      });

      if (input.targets.length > 0) {
        await tx.popupTarget.createMany({
          data: input.targets.map((target) => ({
            popupId: created.id,
            type: target.type,
            path: target.path || null,
            serviceId: target.serviceId || null,
            cityId: target.cityId || null,
            serviceCityPageId: target.serviceCityPageId || null,
            packageId: target.packageId || null,
            visitorType: target.visitorType,
            device: target.device,
          })),
        });
      }

      return created;
    },
  );

  revalidateTag(POPUP_TAG);
  return popup;
}

export async function updatePopup(actor: Actor, id: string, input: PopupInput) {
  requirePermission(actor, "popups.edit");

  const before = await getPopup(actor, id);
  if (input.isActive && !before.isActive) requirePermission(actor, "popups.publish");

  const popup = await withAudit(
    { actor, action: "UPDATE", entityType: "Popup", entityId: id, before },
    async (tx) => {
      const updated = await tx.popup.update({
        where: { id },
        data: {
          name: input.name,
          title: input.title,
          body: input.body ?? null,
          ctaLabel: input.ctaLabel ?? null,
          ctaHref: input.ctaHref ?? null,
          trigger: input.trigger,
          triggerValue: input.triggerValue ?? null,
          frequency: input.frequency,
          priority: input.priority,
          isActive: input.isActive,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
        },
      });

      // Targeting rules are replaced wholesale — a partial diff here is how a
      // popup ends up firing somewhere nobody intended.
      await tx.popupTarget.deleteMany({ where: { popupId: id } });
      if (input.targets.length > 0) {
        await tx.popupTarget.createMany({
          data: input.targets.map((target) => ({
            popupId: id,
            type: target.type,
            path: target.path || null,
            serviceId: target.serviceId || null,
            cityId: target.cityId || null,
            serviceCityPageId: target.serviceCityPageId || null,
            packageId: target.packageId || null,
            visitorType: target.visitorType,
            device: target.device,
          })),
        });
      }

      return updated;
    },
  );

  revalidateTag(POPUP_TAG);
  return popup;
}
