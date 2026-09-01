import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "Marketing" };

export default async function MarketingPage() {
  const actor = await requireActorPage("/admin/marketing");
  requirePermission(actor, "popups.view");

  const [popups, active, submissions] = await Promise.all([
    db.popup.count(),
    db.popup.count({ where: { isActive: true } }),
    db.popupAnalytics.count({ where: { event: "SUBMISSION" } }),
  ]);

  return (
    <>
      <header className="mb-7">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Marketing</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Campaigns and capture</h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/admin/marketing/popups" className="group">
          <Card className="h-full transition-colors group-hover:border-navy-300">
            <CardBody>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                  Popups
                </h2>
                <span className="text-xs tabular-nums text-ink-subtle">
                  {active} active of {popups}
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-subtle">
                Targeting is resolved on the server; a visitor only ever receives the one popup they
                should see. {submissions} submission{submissions === 1 ? "" : "s"} recorded.
              </p>
            </CardBody>
          </Card>
        </Link>
      </div>
    </>
  );
}
