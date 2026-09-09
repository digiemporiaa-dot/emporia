import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";
import { persistTouches, type VisitorContext } from "@/lib/attribution/server";
import {
  assignOnCapture,
  pickAssignee,
  scoreOnCapture,
  scoringConfig,
} from "@/lib/services/crm.service";
import { alertNewLead } from "@/lib/services/alerts.service";
import { runAutomations } from "@/lib/automation/engine";
import type { DeviceType } from "@/generated/prisma/enums";
import { BLOCK_SCHEMAS } from "@/lib/content/blocks";
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
      ? db.service
          .findUnique({ where: { id: serviceId }, select: { slug: true } })
          .then((s) => s?.slug ?? null)
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

  // After the transaction, and deliberately not awaited into it: a lead is
  // captured whether or not the alert goes out, and the send is logged either
  // way (lib/services/email.service.ts).
  await alertNewLead(lead.id);

  // After the capture is committed, and never able to undo it.
  await runAutomations("LEAD_CREATED", { leadId: lead.id });

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
        ? db.service
            .findUnique({ where: { id: context.serviceId }, select: { slug: true } })
            .then((s) => s?.slug ?? null)
        : Promise.resolve(null),
      context.cityId
        ? db.city
            .findUnique({ where: { id: context.cityId }, select: { slug: true } })
            .then((c) => c?.slug ?? null)
        : Promise.resolve(null),
    ]),
  ]);
  const [serviceSlug, citySlug] = slugs;

  const result = await db.$transaction(async (tx) => {
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

  // Outside the transaction, for the same reason as the contact form.
  await alertNewLead(result.leadId);
  await runAutomations("LEAD_CREATED", { leadId: result.leadId });

  return result;
}

// ---------------------------------------------------------------------------
// Page form capture
// ---------------------------------------------------------------------------

export type PageFormCaptureInput = {
  sectionId: string;
  name?: string | null;
  email: string;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
};

export type PageFormCaptureContext = {
  visitor: VisitorContext;
  path: string;
};

export type PageFormCaptureResult = {
  leadId: string;
  utmId: string | null;
  campaignId: string | null;
  /** The block's own wording, so the client renders what the editor wrote. */
  successMessage: string;
};

/**
 * Create a lead from a `leadForm` block on a CMS page.
 *
 * The same attribution the popup path gets, for the same reason: a lead without
 * its campaign is worse than no lead, because it quietly skews the reporting.
 * So this uses `persistTouches` rather than the thinner contact-form context,
 * and the lead, its touches and its activity commit together.
 *
 * **Everything that decides the outcome is loaded, not sent.** The browser
 * names the section; this reads that section out of the database and takes the
 * variant, the service and the success wording from the stored block. A form
 * that let the request body name its own service would let anyone file a lead
 * against any service — and `serviceId` is a column the whole of marketing
 * analytics groups by.
 *
 * A form on an unpublished page is refused. Otherwise a draft page shared as a
 * preview link would be a live, unlisted lead capture endpoint.
 */
export async function capturePageFormLead(
  input: PageFormCaptureInput,
  context: PageFormCaptureContext,
): Promise<PageFormCaptureResult> {
  const source = await db.leadSource.findUnique({
    where: { slug: WEBSITE_FORM_SOURCE },
    select: { id: true },
  });
  if (!source) {
    throw new ValidationError("We could not record your enquiry. Please email us instead.");
  }

  const section = await db.pageSection.findFirst({
    where: {
      id: input.sectionId,
      type: "leadForm",
      isVisible: true,
      page: { status: "PUBLISHED", deletedAt: null },
    },
    select: { id: true, content: true, page: { select: { id: true, slug: true, title: true } } },
  });
  if (!section) {
    throw new ValidationError("That form is no longer available.");
  }

  const parsed = BLOCK_SCHEMAS.leadForm.safeParse(section.content);
  if (!parsed.success) {
    // The block is on a published page but its content no longer validates, so
    // the renderer is not showing it either. Refusing beats writing a lead
    // against a form nobody can see.
    throw new ValidationError("That form is no longer available.");
  }
  const block = parsed.data;

  // Per-variant requirements live here rather than in the request schema,
  // because the variant is on the stored block: a newsletter form asks for an
  // email and nothing else, and the other two need a name.
  const name = (input.name ?? "").trim();
  if (block.variant !== "newsletter" && name.length < 2) {
    throw new ValidationError("Please enter your name.", { name: ["Please enter your name."] });
  }

  // A configured service is honoured only if it still names a published one,
  // exactly as the contact form does with a client-supplied id.
  let serviceId: string | null = null;
  let serviceSlug: string | null = null;
  if (block.serviceSlug) {
    const service = await db.service.findFirst({
      where: { slug: block.serviceSlug, status: "PUBLISHED" },
      select: { id: true, slug: true },
    });
    serviceId = service?.id ?? null;
    serviceSlug = service?.slug ?? null;
  }

  const [config, assigneeId] = await Promise.all([scoringConfig(), pickAssignee()]);

  const result = await db.$transaction(async (tx) => {
    const touches = await persistTouches(tx, context.visitor, context.path);

    const lead = await tx.lead.create({
      data: {
        // A newsletter subscriber gives only an email; the CRM still needs a
        // name, and their email is the truest thing available.
        name: name || input.email,
        email: input.email,
        phone: input.phone || null,
        company: input.company || null,
        message: input.message || null,
        sourceId: source.id,
        serviceId,
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
        summary: `Submitted through the ${block.variant} form on “${section.page.title}”.`,
        meta: {
          pageId: section.page.id,
          pageSlug: section.page.slug,
          sectionId: section.id,
          variant: block.variant,
          path: context.path,
          device: context.visitor.device,
          source: context.visitor.lastTouch?.source ?? null,
          medium: context.visitor.lastTouch?.medium ?? null,
          campaign: context.visitor.lastTouch?.campaign ?? null,
        },
      },
    });

    await scoreOnCapture(
      tx,
      lead.id,
      {
        sourceSlug: WEBSITE_FORM_SOURCE,
        serviceSlug,
        phone: input.phone ?? undefined,
        company: input.company ?? undefined,
        message: input.message ?? undefined,
      },
      config,
    );

    if (assigneeId) await assignOnCapture(tx, lead.id, assigneeId);

    return {
      leadId: lead.id,
      utmId: touches.lastTouchId ?? touches.firstTouchId,
      campaignId: touches.campaignId,
    };
  });

  leadLog.info(
    { leadId: result.leadId, pageSlug: section.page.slug, variant: block.variant, serviceId },
    "lead captured from a page form",
  );

  // Outside the transaction, for the same reason as the other two paths: a lead
  // is captured whether or not the alert goes out.
  await alertNewLead(result.leadId);
  await runAutomations("LEAD_CREATED", { leadId: result.leadId });

  return { ...result, successMessage: block.successMessage };
}
