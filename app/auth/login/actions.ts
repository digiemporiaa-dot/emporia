"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/lib/auth";

/**
 * Login server action.
 *
 * Input is validated with zod before use (CLAUDE.md 2 rule 4). Every failure —
 * malformed input, unknown user, wrong password, rate limit — returns the same
 * generic message, so the form cannot be used to discover which emails exist.
 */

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  redirectTo: z.string().startsWith("/").optional(),
});

export type LoginState = { error: string | null };

const GENERIC_FAILURE = "Those details did not match an account.";

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: parsed.data.redirectTo ?? "/admin",
    });
  } catch (error) {
    // signIn throws a redirect on success; that must propagate.
    if (error instanceof AuthError) {
      return { error: GENERIC_FAILURE };
    }
    throw error;
  }

  return { error: null };
}
