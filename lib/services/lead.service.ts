import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";
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

/** Slug of the seeded source used for site forms. */
const WEBSITE_FORM_SOURCE = "website-form";

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

    return created;
  });

  leadLog.info({ leadId: lead.id, serviceId }, "lead captured from contact form");

  return { leadId: lead.id };
}
