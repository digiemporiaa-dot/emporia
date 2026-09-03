import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listEmailLog, listTemplates } from "@/lib/services/email.service";
import { isEmailConfigured } from "@/lib/email";
import { emailLogParamsSchema } from "@/lib/validation/email";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { EmailLogTable, MailerCheck } from "./email-panels";

export const metadata: Metadata = { title: "Email" };
export const dynamic = "force-dynamic";

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/settings/email");
  requirePermission(actor, "emails.view");

  const raw = await searchParams;
  const parsed = emailLogParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : emailLogParamsSchema.parse({});

  const [templates, logResult] = await Promise.all([
    listTemplates(actor),
    listEmailLog(actor, params),
  ]);

  return (
    <>
      <header className="mb-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Settings</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Email</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Every send is recorded here, including the ones that failed.
        </p>
      </header>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Mail server</CardTitle>
          </CardHeader>
          <CardBody>
            <MailerCheck configured={isEmailConfigured()} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {templates.map((template) => (
                <li
                  key={template.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/admin/settings/email/${template.key}`}
                      className="text-sm text-navy-800 hover:text-brand-red"
                    >
                      {template.name}
                    </Link>
                    <p className="truncate text-2xs text-ink-subtle">{template.subject}</p>
                  </div>
                  <Badge tone={template.isActive ? "success" : "neutral"}>
                    {template.isActive ? "On" : "Off"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <section>
          <h2 className="mb-3 font-display text-lg text-navy-800">Send log</h2>
          <EmailLogTable
            rows={logResult.rows.map((row) => ({
              id: row.id,
              to: row.to,
              subject: row.subject,
              status: row.status,
              error: row.error,
              templateKey: row.templateKey,
              createdAt: row.createdAt.toISOString(),
              sentAt: row.sentAt ? row.sentAt.toISOString() : null,
            }))}
            total={logResult.total}
            page={logResult.page}
            pages={logResult.pages}
            failures={logResult.failures}
            canRetry={can(actor, "emails.send")}
          />
        </section>
      </div>
    </>
  );
}
