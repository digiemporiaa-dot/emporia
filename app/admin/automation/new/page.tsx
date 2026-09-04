import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { AutomationEditor } from "../automation-editor";
import { ROLE_NAMES } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "New rule" };
export const dynamic = "force-dynamic";

export default async function NewAutomationPage() {
  const actor = await requireActorPage("/admin/automation/new");
  requirePermission(actor, "automation.edit");

  const staff = await db.user.findMany({
    where: { type: "STAFF", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/automation" className="hover:text-navy-800">
            Automation
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New rule</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Rules are saved switched off. Try one against a real record before you turn it on.
        </p>
      </header>

      <AutomationEditor staff={staff} roles={ROLE_NAMES} />
    </>
  );
}
