import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { listCountries } from "@/lib/geo/countries";
import { getProperty, propertyFormOptions, propertyOrigin } from "@/lib/services/seo-intel/property.service";
import { Card, CardBody } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { PropertyForm } from "../property-form";
import { timeZoneOptions } from "../time-zones";

export const metadata: Metadata = { title: "Edit website" };
export const dynamic = "force-dynamic";

export default async function EditSeoPropertyPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const actor = await requireActorPage(`/admin/marketing/seo/properties/${propertyId}`);
  requirePermission(actor, "seo.intelligence.manage");

  const property = await getProperty(actor, propertyId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { clients, projects, internal } = await propertyFormOptions(actor);

  return (
    <>
      <SeoHeader
        current="properties"
        title={property.displayName}
        description={`${propertyOrigin(property)} · ${property.client.name}`}
        crumbs={[{ href: "/admin/marketing/seo/properties", label: "Websites" }, { label: property.displayName }]}
        query={`?property=${property.id}`}
      />
      <Card>
        <CardBody>
          <PropertyForm
            property={{
              id: property.id,
              clientId: property.clientId,
              clientName: property.client.isInternal ? `${property.client.name} (our own website)` : property.client.name,
              website: property.domain,
              protocol: property.protocol,
              displayName: property.displayName,
              projectId: property.project?.id ?? null,
              defaultCountry: property.defaultCountry?.code ?? null,
              defaultLanguage: property.defaultLanguage,
              timezone: property.timezone,
              isActive: property.isActive,
            }}
            clients={clients}
            internal={internal}
            projects={projects}
            countries={listCountries()}
            timeZones={timeZoneOptions()}
          />
        </CardBody>
      </Card>
    </>
  );
}
