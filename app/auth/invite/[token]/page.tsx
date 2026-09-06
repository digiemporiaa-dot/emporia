import type { Metadata } from "next";
import Link from "next/link";
import { inviteeFor } from "@/lib/services/portal-access.service";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = {
  title: "Set up your account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitee = await inviteeFor(token);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-(--container-narrow) flex-col justify-center px-6 py-12"
    >
      <div className="mx-auto w-full max-w-sm">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-semibold tracking-tighter text-navy-800">
            Emporia
          </span>
          <span className="text-2xs uppercase tracking-widest text-ink-subtle">Client portal</span>
        </div>

        {invitee ? (
          <>
            <h1 className="mt-6 text-2xl text-navy-800">Set up your account</h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {invitee.name}, you have been invited to the portal for{" "}
              {invitee.client?.name ?? "your account"}. Choose a password to finish.
            </p>
            <p className="mt-1 text-2xs text-ink-subtle">Signing in as {invitee.email}.</p>

            <div className="mt-6">
              <InviteForm token={token} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-2xl text-navy-800">This invitation is not valid</h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              It may have expired, or already been used. Ask your account manager for a new one.
            </p>
            <p className="mt-6">
              <Link href="/auth/login" className="text-sm text-brand-red-text underline underline-offset-4">
                Go to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
