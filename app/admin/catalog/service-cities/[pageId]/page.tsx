import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { checkPublishable, getPage } from "@/lib/services/serviceCityPage.service";
import { isAppError } from "@/lib/errors";
import { Badge } from "@/components/ui";
import { ServiceCityPageForm } from "../page-form";
import { PublishPanel } from "../publish-panel";
import { LocalFaqs } from "../local-faqs";

import { getEntitySeo } from "@/lib/services/seo.service";
import { EntitySeoPanel } from "@/components/admin/entity-seo-panel";

export const metadata: Metadata = { title: "Edit local page" };

export default async function EditServiceCityPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const actor = await requireActorPage("/admin/catalog/service-cities");
  requirePermission(actor, "catalog.view");

  let page;
  try {
    page = await getPage(actor, pageId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [check, services, cities] = await Promise.all([
    checkPublishable(actor, pageId),
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);

  const industries = Array.isArray(page.industries)
    ? page.industries.filter((i): i is string => typeof i === "string")
    : [];


  // SEO lives in its own panel, gated on `seo.edit` rather than `catalog.edit`.
  const seoRecord = await getEntitySeo(actor, "serviceCityPage", pageId);
  const seoMediaIds = [seoRecord.seo?.ogImageId, seoRecord.seo?.twitterImageId].filter(
    (value): value is string => Boolean(value),
  );
  const seoMedia =
    seoMediaIds.length === 0
      ? []
      : await db.media.findMany({
          where: { id: { in: seoMediaIds }, deletedAt: null },
          select: { id: true, url: true, filename: true, type: true },
        });
  const seoMediaById = new Map(seoMedia.map((row) => [row.id, row]));

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/catalog/service-cities" className="hover:text-navy-800">
            Local pages
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">
            {page.service.name} · {page.city.name}
          </span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">
            {page.service.name} in {page.city.name}
          </h1>
          <Badge tone={page.status === "PUBLISHED" ? "success" : "neutral"}>{page.status}</Badge>
        </div>
        {page.status === "PUBLISHED" ? (
          <p className="mt-1.5 text-xs text-ink-subtle">
            Live at{" "}
            <code className="font-mono">
              /services/{page.service.slug}/{page.city.slug}
            </code>
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-8">
          <ServiceCityPageForm
            services={services}
            cities={cities}
            page={{
              id: page.id,
              serviceId: page.service.id,
              cityId: page.city.id,
              localIntro: page.localIntro,
              marketContext: page.marketContext,
              industries,
              positioning: page.positioning,
              ctaHeading: page.ctaHeading,
              ctaBody: page.ctaBody,
            }}
          />

          <LocalFaqs
            pageId={page.id}
            faqs={page.faqs}
            canEdit={can(actor, "catalog.edit")}
          />
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          {can(actor, "catalog.publish") ? (
            <PublishPanel
              pageId={page.id}
              status={page.status}
              checks={check.checks}
              canPublishNow={check.ok}
            />
          ) : (
            <div className="rounded-lg border border-line bg-white p-4 text-xs text-ink-subtle">
              You do not have permission to publish local pages.
            </div>
          )}
        </aside>
      </div>

      <EntitySeoPanel
        entity="serviceCityPage"
        id={pageId}
        seo={seoRecord.seo}
        ogImage={
          seoRecord.seo?.ogImageId ? (seoMediaById.get(seoRecord.seo.ogImageId) ?? null) : null
        }
        twitterImage={
          seoRecord.seo?.twitterImageId
            ? (seoMediaById.get(seoRecord.seo.twitterImageId) ?? null)
            : null
        }
        titleHint="Blank is generated from the service and city."
        canEdit={can(actor, "seo.edit")}
      />
    </>
  );
}
