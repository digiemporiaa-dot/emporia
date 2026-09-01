import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/actor";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const actor = await currentActor();
  if (actor) redirect("/admin");

  const { redirectTo } = await searchParams;
  // Only accept same-origin paths, so the parameter cannot be used as an open
  // redirect to an attacker's site.
  const safeRedirect =
    redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : undefined;

  return (
    <main id="main" className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Navy panel: brand presence without red as a background. */}
      <section className="relative hidden flex-col justify-between bg-navy-800 px-12 py-14 text-white lg:flex">
        <p className="font-display text-lg font-semibold tracking-tighter">Emporia</p>
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">
            Agency operating system
          </p>
          <h1 className="mt-4 max-w-lg text-4xl">
            One platform from first click to final invoice.
          </h1>
          <p className="mt-5 max-w-md text-navy-100">
            Website, CRM, pipeline, delivery and reporting on a single connected database.
          </p>
        </div>
        <p className="text-xs text-navy-300">Staff access only.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl text-navy-800">Sign in</h2>
          <p className="mt-1.5 mb-7 text-sm text-ink-subtle">
            Use the email and password issued to you.
          </p>
          <LoginForm {...(safeRedirect ? { redirectTo: safeRedirect } : {})} />
        </div>
      </section>
    </main>
  );
}
