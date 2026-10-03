import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { listCountries } from "@/lib/geo/countries";
import { propertyFormOptions } from "@/lib/services/seo-intel/property.service";
import { Card, CardBody } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { PropertyForm } from "../property-form";
import { timeZoneOptions } from "../time-zones";

export const metadata: Metadata = { title: "Add website" };
export const dynamic = "force-dynamic";

export default async function NewSeoPropertyPage() {
  const actor = await requireActorPage("/admin/marketing/seo/properties/new");
  requirePermission(actor, "seo.intelligence.manage");

  const { clients, projects, internal } = await propertyFormOptions(actor);

  return (
    <>
      <SeoHeader
        current="properties"
        title="Add website"
        description="Search Console and Analytics are connected after the website is added. Choosing your own website files it under your agency's internal client record, created the first time."
        crumbs={[{ href: "/admin/marketing/seo/properties", label: "Websites" }, { label: "Add" }]}
      />
      <Card>
        <CardBody>
          <PropertyForm
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
