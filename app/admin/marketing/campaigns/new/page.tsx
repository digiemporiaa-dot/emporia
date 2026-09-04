import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "New campaign" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const actor = await requireActorPage("/admin/marketing/campaigns/new");
  requirePermission(actor, "campaigns.create");

  const [clients, staff] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { type: "STAFF", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/marketing" className="hover:text-navy-800">
            Marketing
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/marketing/campaigns" className="hover:text-navy-800">
            Campaigns
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New campaign</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Leads carrying a matching <code className="font-mono">utm_campaign</code> attach to it
          automatically.
        </p>
      </header>

      <CampaignForm clients={clients} staff={staff} />
    </>
  );
}
