import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ai, isAIConfigured } from "@/lib/ai";
import { AIUnavailable } from "@/components/admin/ai-draft";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { ContentStudio, SEOStudio } from "./studio";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default async function AIPage() {
  const actor = await requireActorPage("/admin/ai");
  requirePermission(actor, "ai.use");

  const configured = isAIConfigured();
  const canContent = can(actor, "content.create");
  const canSeo = can(actor, "seo.edit");

  const [clients, services, cities] = await Promise.all([
    canContent
      ? db.client.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    canSeo
      ? db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    canSeo
      ? db.city.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <header className="mb-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">Assistant</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Drafting</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
          Everything here produces a draft you edit and save yourself — nothing is written for you,
          and no figure comes from the model. Lead summaries live on the lead; the read of the
          analytics numbers lives on that page.
          {configured ? ` Currently using ${ai().describe}.` : ""}
        </p>
      </header>

      {!configured ? (
        <Card>
          <CardBody className="py-10 text-center">
            <p className="text-sm font-medium text-navy-800">Drafting is switched off</p>
            <div className="mx-auto mt-2 max-w-md">
              <AIUnavailable />
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {canContent ? (
            <Card>
              <CardHeader>
                <CardTitle>Content</CardTitle>
                <p className="text-xs text-ink-subtle">
                  A post or article to take into the content calendar.
                </p>
              </CardHeader>
              <CardBody>
                <ContentStudio clients={clients} />
              </CardBody>
            </Card>
          ) : null}

          {canSeo ? (
            <Card>
              <CardHeader>
                <CardTitle>SEO copy</CardTitle>
                <p className="text-xs text-ink-subtle">
                  Metadata and a local intro. It reports when it did not have enough to be specific.
                </p>
              </CardHeader>
              <CardBody>
                <SEOStudio services={services} cities={cities} />
              </CardBody>
            </Card>
          ) : null}

          {!canContent && !canSeo ? (
            <Card>
              <CardBody>
                <p className="text-sm text-ink-subtle">
                  Your role does not include content or SEO editing, so there is nothing to draft
                  here. Lead summaries are on the lead itself.
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
