import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";
import { persistTouches, type VisitorContext } from "@/lib/attribution/server";
import { assignOnCapture, pickAssignee, scoreOnCapture, scoringConfig } from "@/lib/services/crm.service";
import type { DeviceType } from "@/generated/prisma/enums";
import type { ContactFormInput } from "@/lib/validation/lead";

const leadLog = log("lead");

/**
 * Lead capture.
 *
 * This is the minimum real path: a website form produces a real Lead row with
 * the attribution that is available server-side, and a CREATED activity so the
 * timeline is not retrofitted later.
 *
 * Scoring, assignment, automation and full UTM first/last-touch resolution are
 * Phases 6 and 7. They are not stubbed here — the fields simply stay at their
 * defaults until those phases fill them, which is honest rather than fake
 * (CLAUDE.md 15 rule 5).
 */

export type CaptureContext = {
  landingPath: string | null;
  referrer: string | null;
  device: DeviceType | null;
  ip: string | null;
  userAgent: string | null;
};

export type CaptureResult = { leadId: string };

/** Slugs of the seeded sources used for site capture. */
const WEBSITE_FORM_SOURCE = "website-form";
const POPUP_SOURCE = "popup";

export async function captureContactLead(
  input: ContactFormInput,
  context: CaptureContext,
): Promise<CaptureResult> {
  const source = await db.leadSource.findUnique({
    where: { slug: WEBSITE_FORM_SOURCE },
    select: { id: true },
  });

  if (!source) {
    // Configuration error, not user error: the seed did not run.
    throw new ValidationError("We could not record your enquiry. Please email us instead.");
  }

  // A supplied serviceId is only honoured if it names a published service.
  // Trusting the client's id here would let a caller attach a lead to a draft.
  let serviceId: string | null = null;
  if (input.serviceId) {
    const service = await db.service.findFirst({
      where: { id: input.serviceId, status: "PUBLISHED" },
      select: { id: true },
    });
    serviceId = service?.id ?? null;
  }

  // Resolved before the transaction so the scoring config and the assignee
  // lookup do not hold the write open.
  const [config, assigneeId, serviceSlug] = await Promise.all([
    scoringConfig(),
    pickAssignee(),
    serviceId
      ? db.service.findUnique({ where: { id: serviceId }, select: { slug: true } }).then((s) => s?.slug ?? null)
      : Promise.resolve(null),
  ]);

  const lead = await db.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        company: input.company || null,
        message: input.message,
        sourceId: source.id,
        serviceId,
        landingPath: context.landingPath,
        referrer: context.referrer,
        device: context.device,
        status: "NEW",
        priority: "MEDIUM",
      },
      select: { id: true },
    });

    await tx.leadActivity.create({
      data: {
        leadId: created.id,
        type: "CREATED",
        summary: "Enquiry submitted through the website contact form.",
        meta: {
          landingPath: context.landingPath,
          referrer: context.referrer,
          device: context.device,
        },
      },
    });

    await scoreOnCapture(
      tx,
      created.id,
      {
        sourceSlug: WEBSITE_FORM_SOURCE,
        serviceSlug,
        phone: input.phone,
        company: input.company,
        message: input.message,
      },
      config,
    );

    if (assigneeId) await assignOnCapture(tx, created.id, assigneeId);

    return created;
  });

  leadLog.info({ leadId: lead.id, serviceId, assigneeId }, "lead captured from contact form");

  return { leadId: lead.id };
}


// ---------------------------------------------------------------------------
// Popup capture
// ---------------------------------------------------------------------------

export type PopupCaptureInput = {
  popupId: string;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
};

export type PopupCaptureContext = {
  visitor: VisitorContext;
  path: string;
  serviceId: string | null;
  cityId: string | null;
  packageId: string | null;
};

export type PopupCaptureResult = {
  leadId: string;
  utmId: string | null;
  campaignId: string | null;
};

/**
 * Create a lead from a popup submission, with full attribution.
 *
 * Everything attributive — visitor, UTM first and last touch, campaign, device,
 * referrer, landing path, service and city — is derived server-side from
 * cookies, headers and the path. The submitter supplies only their own details
 * (docs/ARCHITECTURE.md 14.2), so attribution cannot be forged.
 *
 * The lead, its touches, its activity and the popup's SUBMISSION and CONVERSION
 * events all commit in one transaction: a lead without its attribution would be
 * worse than no lead at all, because it would quietly skew the reporting this
 * platform exists to produce.
 */
export async function capturePopupLead(
  input: PopupCaptureInput,
  context: PopupCaptureContext,
): Promise<PopupCaptureResult> {
  const source = await db.leadSource.findUnique({
    where: { slug: POPUP_SOURCE },
    select: { id: true },
  });

  if (!source) {
    throw new ValidationError("We could not record your enquiry. Please use the contact form.");
  }

  // A popup id from the client is only honoured if it names a real popup.
  const popup = await db.popup.findUnique({
    where: { id: input.popupId },
    select: { id: true },
  });
  if (!popup) {
    throw new ValidationError("That form is no longer available.");
  }

  const [config, assigneeId, slugs] = await Promise.all([
    scoringConfig(),
    pickAssignee(),
    Promise.all([
      context.serviceId
        ? db.service.findUnique({ where: { id: context.serviceId }, select: { slug: true } }).then((s) => s?.slug ?? null)
        : Promise.resolve(null),
      context.cityId
        ? db.city.findUnique({ where: { id: context.cityId }, select: { slug: true } }).then((c) => c?.slug ?? null)
        : Promise.resolve(null),
    ]),
  ]);
  const [serviceSlug, citySlug] = slugs;

  return db.$transaction(async (tx) => {
    const touches = await persistTouches(tx, context.visitor, context.path);

    const lead = await tx.lead.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        company: input.company || null,
        message: input.message || null,
        sourceId: source.id,
        popupId: popup.id,
        serviceId: context.serviceId,
        cityId: context.cityId,
        packageId: context.packageId,
        campaignId: touches.campaignId,
        firstTouchId: touches.firstTouchId,
        lastTouchId: touches.lastTouchId,
        landingPath: context.visitor.firstTouch?.landingPath ?? context.path,
        referrer: context.visitor.referrer,
        device: context.visitor.device,
        status: "NEW",
        priority: "MEDIUM",
      },
      select: { id: true },
    });

    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "CREATED",
        summary: "Enquiry submitted through a popup.",
        meta: {
          popupId: popup.id,
          path: context.path,
          device: context.visitor.device,
          source: context.visitor.lastTouch?.source ?? null,
          medium: context.visitor.lastTouch?.medium ?? null,
          campaign: context.visitor.lastTouch?.campaign ?? null,
        },
      },
    });

    // SUBMISSION and CONVERSION are written here rather than trusted from the
    // client: a browser claiming a conversion is not evidence of one.
    for (const event of ["SUBMISSION", "CONVERSION"] as const) {
      await tx.popupAnalytics.create({
        data: {
          popupId: popup.id,
          event,
          visitorId: context.visitor.visitorId,
          path: context.path,
          serviceId: context.serviceId,
          cityId: context.cityId,
          campaignId: touches.campaignId,
          utmId: touches.lastTouchId ?? touches.firstTouchId,
          leadId: lead.id,
        },
      });
    }

    await scoreOnCapture(
      tx,
      lead.id,
      {
        sourceSlug: POPUP_SOURCE,
        serviceSlug,
        citySlug,
        phone: input.phone,
        company: input.company,
        message: input.message,
        packageId: context.packageId,
      },
      config,
    );

    if (assigneeId) await assignOnCapture(tx, lead.id, assigneeId);

    leadLog.info(
      {
        leadId: lead.id,
        popupId: popup.id,
        serviceId: context.serviceId,
        cityId: context.cityId,
        assigneeId,
      },
      "lead captured from popup",
    );

    return {
      leadId: lead.id,
      utmId: touches.lastTouchId ?? touches.firstTouchId,
      campaignId: touches.campaignId,
    };
  });
}
