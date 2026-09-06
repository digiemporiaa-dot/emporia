"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { completeReset } from "@/lib/services/password-reset.service";
import { passwordSchema } from "@/lib/validation/portal";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("auth");

const schema = z
  .object({
    token: z.string().trim().min(20).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Those passwords do not match.",
    path: ["confirmPassword"],
  });

export type ResetState = ActionResult<{ done: true }> | null;

export async function completeResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Bounded per token as well as per origin, so a leaked link cannot be
  // hammered and an origin cannot sweep for live ones.
  const limit = await checkRateLimit(`reset:complete:${ip ?? "unknown"}`, {
    limit: 10,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." };
  }

  try {
    await completeReset(parsed.data.token, parsed.data.password, ip);
    return { ok: true, data: { done: true } };
  } catch (error) {
    actionLog.warn({ err: error }, "password reset refused");
    return toActionFailure(error);
  }
}
