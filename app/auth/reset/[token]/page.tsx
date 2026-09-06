import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { privateMetadata } from "@/lib/seo/metadata";
import { resetTokenIsValid } from "@/lib/services/password-reset.service";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = privateMetadata("Choose a new password");
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const actor = await currentActor();
  if (actor) redirect("/admin");

  const { token } = await params;
  const valid = await resetTokenIsValid(token);

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-6 py-14">
      <div className="w-full max-w-sm">
        <p className="font-display text-lg font-semibold tracking-tighter text-navy-800">Emporia</p>

        {valid ? (
          <>
            <h1 className="mt-6 text-2xl text-navy-800">Choose a new password</h1>
            <p className="mt-2 text-sm text-ink-muted">
              This link works once, and only for the next hour.
            </p>
            <div className="mt-7">
              <ResetForm token={token} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-2xl text-navy-800">That link has expired</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Reset links last an hour and work once. Ask for a fresh one.
            </p>
            <div className="mt-7">
              <Link
                href="/auth/forgot"
                className="text-sm font-medium text-brand-red-text underline underline-offset-2"
              >
                Send me a new link
              </Link>
            </div>
          </>
        )}

        <p className="mt-6 text-xs text-ink-subtle">
          <Link href="/auth/login" className="underline underline-offset-2 hover:text-navy-800">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
