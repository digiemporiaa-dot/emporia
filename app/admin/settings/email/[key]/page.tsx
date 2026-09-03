import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getTemplate } from "@/lib/services/email.service";
import { isAppError } from "@/lib/errors";
import { templateKeySchema } from "@/lib/validation/email";
import { TemplateEditor } from "../email-panels";

export const metadata: Metadata = { title: "Email template" };
export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const actor = await requireActorPage("/admin/settings/email");
  requirePermission(actor, "emails.view");

  const parsedKey = templateKeySchema.safeParse(key);
  if (!parsedKey.success) notFound();

  let template;
  try {
    template = await getTemplate(actor, parsedKey.data);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/settings/email" className="hover:text-navy-800">
            Email
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{template.name}</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">{template.name}</h1>
        <p className="mt-1.5 font-mono text-2xs text-ink-subtle">{template.key}</p>
      </header>

      <TemplateEditor
        template={{
          key: template.key,
          name: template.name,
          subject: template.subject,
          html: template.html,
          text: template.text,
          isActive: template.isActive,
        }}
        variables={template.variables}
        globals={template.globals}
      />
    </>
  );
}
