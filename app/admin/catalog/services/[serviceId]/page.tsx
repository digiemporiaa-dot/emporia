import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getService } from "@/lib/services/service.service";
import { getEntitySeo } from "@/lib/services/seo.service";
import { db } from "@/lib/db";
import { EntitySeoPanel } from "@/components/admin/entity-seo-panel";
import { DeleteButton } from "@/components/admin/delete-button";
import { parseBody, serviceBodySchema } from "@/lib/content/entity-body";
import { deleteServiceAction } from "../../actions";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "Service" };

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const actor = await requireActorPage(`/admin/catalog/services/${serviceId}`);
  const service = await getService(actor, serviceId);

  const seesSeo = can(actor, "seo.view");
  const seo = seesSeo ? await getEntitySeo(actor, "service", serviceId) : null;

  // Only the two images the SEO panel renders as previews; the panel itself
  // holds the ids.
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
            <Link href="/admin/catalog/services" className="hover:text-navy-800">
              Services
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">{service.name}</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">{service.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/services/${service.slug}`}
            className="text-xs text-ink-muted underline-offset-4 hover:text-navy-800 hover:underline"
          >
            View on site
          </Link>
          {can(actor, "catalog.delete") ? (
            <DeleteButton
              id={service.id}
              label={service.name}
              description="Services with city pages, packages, case studies or leads cannot be deleted — archive those instead. Nothing else references this one."
              action={deleteServiceAction}
              redirectTo="/admin/catalog/services"
            />
          ) : null}
        </div>
      </header>

      <div className="max-w-3xl space-y-8">
        <ServiceForm
          service={{
            id: service.id,
            name: service.name,
            slug: service.slug,
            shortDescription: service.shortDescription,
            icon: service.icon,
            status: service.status,
            order: service.order,
            hero: service.heroMedia
              ? {
                  id: service.heroMedia.id,
                  url: service.heroMedia.url,
                  filename: service.heroMedia.alt ?? "Hero image",
                  type: "IMAGE",
                }
              : null,
            body: parseBody(serviceBodySchema, service.body),
          }}
        />

        {seo ? (
          <EntitySeoPanel
            entity="service"
            id={service.id}
            seo={seo.seo}
            ogImage={image(seo.seo?.ogImageId)}
            twitterImage={image(seo.seo?.twitterImageId)}
            titleHint={service.name}
            canEdit={can(actor, "seo.edit")}
          />
        ) : null}
      </div>
    </>
  );
}
