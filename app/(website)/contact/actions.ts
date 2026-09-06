"use server";

import { headers } from "next/headers";
import { contactFormSchema } from "@/lib/validation/lead";
import { captureContactLead } from "@/lib/services/lead.service";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { clientIpFrom } from "@/lib/auth";
import { log } from "@/lib/logger";
import type { DeviceType } from "@/generated/prisma/enums";

/**
 * Contact form submission.
 *
 * Public and unauthenticated, so it is rate limited and every field is
 * validated with zod before use (CLAUDE.md 2 rule 4, 11).
 */

/**
 * Only async functions may be exported from a "use server" module — a plain
 * constant here becomes a server reference on the client, not the value. The
 * initial state therefore lives in the form component.
 */
export type ContactState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string>;
};

/** Coarse device class from the User-Agent, read server-side. */
function deviceFrom(userAgent: string | null): DeviceType | null {
  if (!userAgent) return null;
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return "TABLET";
  if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) return "MOBILE";
  return "DESKTOP";
}

export async function submitContactAction(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const parsed = contactFormSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    company: formData.get("company") ?? "",
    serviceId: formData.get("serviceId") ?? "",
    message: formData.get("message"),
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors,
    };
  }

  // Honeypot: a filled hidden field means a bot. Report success without
  // writing anything, so the bot learns nothing from the difference.
  if (parsed.data.website) {
    log("contact").info("honeypot triggered on contact form");
    return { status: "success", message: "Thanks — we will be in touch shortly.", fieldErrors: {} };
  }

  const h = await headers();
  const ip = clientIpFrom(h);
  const userAgent = h.get("user-agent");

  const limit = await checkRateLimit(`contact:${ip ?? "unknown"}`, { limit: 5, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return {
      status: "error",
      message: "Too many submissions. Please try again in a few minutes.",
      fieldErrors: {},
    };
  }

  try {
    await captureContactLead(parsed.data, {
      landingPath: h.get("referer"),
      referrer: h.get("referer"),
      device: deviceFrom(userAgent),
      ip,
      userAgent,
    });
  } catch (error) {
    log("contact").error({ err: error }, "contact form submission failed");
    return {
      status: "error",
      message: "Something went wrong sending that. Please try again, or email us directly.",
      fieldErrors: {},
    };
  }

  return {
    status: "success",
    message: "Thanks — we have your enquiry and will reply within one working day.",
    fieldErrors: {},
  };
}
