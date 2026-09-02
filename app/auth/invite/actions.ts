"use server";

import { headers } from "next/headers";
import { acceptInvite } from "@/lib/services/portal-access.service";
import { acceptInviteSchema } from "@/lib/validation/portal";
import { clientIpFrom } from "@/lib/auth";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const inviteLog = log("invite");

export type InviteState = ActionResult<{ email: string }> | null;

/**
 * Activate an invited portal account.
 *
 * Rate limited by IP, because the token is the only thing standing between an
 * attacker and an account: without a limit this endpoint is a token oracle.
 */
export async function acceptInviteAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const ip = clientIpFrom(await headers());

  const limit = checkRateLimit(`invite:${ip ?? "unknown"}`, { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." };
  }

  const parsed = acceptInviteSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const user = await acceptInvite(parsed.data.token, parsed.data.password, ip);
    return { ok: true, data: { email: user.email } };
  } catch (error) {
    inviteLog.warn({ err: error }, "invite acceptance refused");
    return toActionFailure(error);
  }
}
