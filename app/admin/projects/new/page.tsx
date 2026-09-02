import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Card, CardBody } from "@/components/ui";
import { ProjectForm } from "../project-form";

export const metadata: Metadata = { title: "New project" };
export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const actor = await requireActorPage("/admin/projects/new");
  requirePermission(actor, "projects.create");

  const [clients, services, staff, contracts] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({
      where: { type: "STAFF", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.contract.findMany({
      where: { status: { in: ["SIGNED", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, title: true },
    }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/projects" className="hover:text-navy-800">
            Projects
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New project</h1>
      </header>

      {clients.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">
              There are no clients yet. A project belongs to a client, and clients are created by
              accepting a proposal.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ProjectForm
          clients={clients}
          services={services}
          staff={staff}
          contracts={contracts.map((contract) => ({
            id: contract.id,
            label: `${contract.number} — ${contract.title}`,
          }))}
        />
      )}
    </>
  );
}
