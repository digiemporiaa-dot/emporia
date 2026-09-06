import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { privateMetadata } from "@/lib/seo/metadata";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = privateMetadata("Reset your password");
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const actor = await currentActor();
  if (actor) redirect("/admin");

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-6 py-14">
      <div className="w-full max-w-sm">
        <p className="font-display text-lg font-semibold tracking-tighter text-navy-800">Emporia</p>
        <h1 className="mt-6 text-2xl text-navy-800">Reset your password</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Enter the address you sign in with and we will send you a link.
        </p>

        <div className="mt-7">
          <ForgotForm />
        </div>

        <p className="mt-6 text-xs text-ink-subtle">
          <Link href="/auth/login" className="underline underline-offset-2 hover:text-navy-800">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
