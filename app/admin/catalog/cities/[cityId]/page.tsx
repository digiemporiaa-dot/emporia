import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getCity } from "@/lib/services/city.service";
import { isAppError } from "@/lib/errors";
import { CityForm } from "../city-form";

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
    </>
  );
}
