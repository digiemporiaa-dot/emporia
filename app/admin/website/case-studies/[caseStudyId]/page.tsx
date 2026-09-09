import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getCaseStudy } from "@/lib/services/case-study.service";
import { getEntitySeo } from "@/lib/services/seo.service";
import { db } from "@/lib/db";
import { EntitySeoPanel } from "@/components/admin/entity-seo-panel";
import { DeleteButton } from "@/components/admin/delete-button";
import { caseBodySchema, parseBody } from "@/lib/content/entity-body";
import { deleteCaseStudyAction } from "../../content-actions";
import { CaseStudyForm } from "../case-study-form";

export const metadata: Metadata = { title: "Case study" };

export default async function CaseStudyDetailPage({
  params,
}: {
  params: Promise<{ caseStudyId: string }>;
}) {
  const { caseStudyId } = await params;
  const actor = await requireActorPage(`/admin/website/case-studies/${caseStudyId}`);
  const study = await getCaseStudy(actor, caseStudyId);

  const seesSeo = can(actor, "seo.view");
  const [services, cities, seo] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    seesSeo ? getEntitySeo(actor, "caseStudy", caseStudyId) : Promise.resolve(null),
  ]);

  const imageIds = [seo?.seo?.ogImageId, seo?.seo?.twitterImageId].filter((id): id is string =>
    Boolean(id),
  );
  const images = imageIds.length
    ? await db.media.findMany({
        where: { id: { in: imageIds } },
        select: { id: true, url: true, filename: true, type: true },
      })
    : [];
  const image = (id: string | null | undefined) =>
    (id ? images.find((row) => row.id === id) : null) ?? null;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/case-studies" className="hover:text-navy-800">
              Case studies
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">{study.title}</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">{study.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/case-studies/${study.slug}`}
            className="text-xs text-ink-muted underline-offset-4 hover:text-navy-800 hover:underline"
          >
            View on site
          </Link>
          {can(actor, "casestudies.delete") ? (
            <DeleteButton
              id={study.id}
              label={study.title}
              description="The case study and its metrics are removed. This cannot be undone."
              action={deleteCaseStudyAction}
              redirectTo="/admin/website/case-studies"
            />
          ) : null}
        </div>
      </header>

      <div className="max-w-3xl space-y-8">
        <CaseStudyForm
          services={services}
          cities={cities}
          study={{
            id: study.id,
            title: study.title,
            slug: study.slug,
            clientName: study.clientName,
            summary: study.summary,
            serviceId: study.serviceId,
            cityId: study.cityId,
            status: study.status,
            cover: study.cover
              ? {
                  id: study.cover.id,
                  url: study.cover.url,
                  filename: study.cover.alt ?? "Cover image",
                  type: "IMAGE",
                }
              : null,
            metrics: study.metrics,
            body: parseBody(caseBodySchema, study.body),
          }}
        />

        {seo ? (
          <EntitySeoPanel
            entity="caseStudy"
            id={study.id}
            seo={seo.seo}
            ogImage={image(seo.seo?.ogImageId)}
            twitterImage={image(seo.seo?.twitterImageId)}
            titleHint={study.title}
            canEdit={can(actor, "seo.edit")}
          />
        ) : null}
      </div>
    </>
  );
}
