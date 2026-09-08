import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { getCity } from "@/lib/services/city.service";
import { isAppError } from "@/lib/errors";
import { CityForm } from "../city-form";

import { db } from "@/lib/db";
import { getEntitySeo } from "@/lib/services/seo.service";
import { EntitySeoPanel } from "@/components/admin/entity-seo-panel";

export const metadata: Metadata = { title: "Edit city" };

export default async function EditCityPage({
  params,
}: {
  params: Promise<{ cityId: string }>;
}) {
  const { cityId } = await params;
  const actor = await requireActorPage("/admin/catalog/cities");
  requirePermission(actor, "catalog.edit");

  let city;
  try {
    city = await getCity(actor, cityId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }


  // SEO lives in its own panel, gated on `seo.edit` rather than `catalog.edit`.
  const seoRecord = await getEntitySeo(actor, "city", cityId);
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
          <Link href="/admin/catalog/cities" className="hover:text-navy-800">
            Cities
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{city.name}</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">{city.name}</h1>
      </header>
      <CityForm city={city} />

      <EntitySeoPanel
        entity="city"
        id={cityId}
        seo={seoRecord.seo}
        ogImage={
          seoRecord.seo?.ogImageId ? (seoMediaById.get(seoRecord.seo.ogImageId) ?? null) : null
        }
        twitterImage={
          seoRecord.seo?.twitterImageId
            ? (seoMediaById.get(seoRecord.seo.twitterImageId) ?? null)
            : null
        }
        titleHint="Blank uses the city name."
        canEdit={can(actor, "seo.edit")}
      />
    </>
  );
}
