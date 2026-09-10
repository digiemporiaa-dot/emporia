import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listTemplates } from "@/lib/services/template.service";
import { allowedBlocksOf } from "@/lib/content/templates";
import { TemplateManager } from "./template-manager";

export const metadata: Metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const actor = await requireActorPage("/admin/website/templates");
  requirePermission(actor, "pages.view");

  // Inactive ones included: this is where they are switched back on.
  const templates = await listTemplates(actor, true);

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website" className="hover:text-brand-red">
            Website
          </Link>
          <span> / Templates</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Page templates</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
          The shape a new page starts in: its opening bands, the bands it may carry, and its SEO
          defaults. A template is applied when the page is created and then let go — editing one
          never reaches back into pages already made from it.
        </p>
      </header>

      <TemplateManager
        rows={templates.map((template) => ({
          id: template.id,
          key: template.key,
          name: template.name,
          description: template.description,
          sectionTypes: Array.isArray(template.sections)
            ? template.sections.flatMap((entry) =>
                entry && typeof entry === "object" && "type" in entry && typeof entry.type === "string"
                  ? [entry.type]
                  : [],
              )
            : [],
          allowedBlocks: allowedBlocksOf(template.allowedBlocks),
          defaultSchemaType: template.defaultSchemaType,
          defaultRobotsIndex: template.defaultRobotsIndex,
          isActive: template.isActive,
          order: template.order,
          pages: template._count.pages,
        }))}
        canEdit={can(actor, "pages.publish")}
      />
    </>
  );
}
