"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requestReset } from "@/lib/services/password-reset.service";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { log } from "@/lib/logger";

const actionLog = log("auth");

const schema = z.object({ email: z.string().trim().email().max(200) });

export type ForgotState = { done: boolean; error?: string } | null;

/**
 * Ask for a reset link.
 *
 * Answers identically whether or not the address exists — this endpoint is
 * unauthenticated, and a different answer for a real address turns it into an
 * account enumeration oracle.
 */
export async function requestResetAction(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { done: false, error: "Enter the email address you sign in with." };
  }

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Both dimensions, like the login itself: the address, so one account cannot
  // be spammed with links, and the origin, so one client cannot enumerate.
  const byEmail = checkRateLimit(`reset:email:${parsed.data.email}`, {
    limit: 3,
    windowMs: 15 * 60_000,
  });
  const byIp = checkRateLimit(`reset:ip:${ip ?? "unknown"}`, { limit: 10, windowMs: 15 * 60_000 });

  if (!byEmail.allowed || !byIp.allowed) {
    // Still the same answer: a rate-limit message that only appears for real
    // addresses would leak the very thing the uniform response protects.
    actionLog.warn({ ip }, "password reset rate limited");
    return { done: true };
  }

  try {
    await requestReset(parsed.data.email, ip);
  } catch (error) {
    // A mail failure is logged, not shown: telling the requester that sending
    // failed also tells them the address exists.
    actionLog.error({ err: error }, "password reset request failed");
  }

  return { done: true };
}
