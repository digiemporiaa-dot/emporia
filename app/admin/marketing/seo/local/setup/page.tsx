import type { Metadata, Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { availableCities, localSetup } from "@/lib/services/seo-intel/local.service";
import { Card, CardBody, CardHeader, Input, Label, Select, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { PropertyPicker } from "../../crawl-parts";
import { ActionForm } from "../../action-form";
import {
  addLocalCitiesAction,
  importLocalFromCmsAction,
  removeLocalCityAction,
  removeLocalServiceAction,
  saveLocalServiceAction,
  setLocalCityAliasesAction,
} from "../actions";
import { LocalNav } from "../local-parts";

export const metadata: Metadata = { title: "Local SEO — services and cities" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ property: z.string().max(40).optional().catch(undefined) });

export default async function LocalSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/local/setup");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description =
    "The services this website should be found for and the cities it targets. Search words decide which pages and Search Console queries count for a service; other names catch spellings people search for a city.";

  if (!property) {
    return (
      <>
        <SeoHeader current="local" title="Local SEO" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const [setup, cities] = await Promise.all([localSetup(actor, property.id), canManage ? availableCities(actor, property.id) : Promise.resolve([])]);

  return (
    <>
      <SeoHeader
        current="local"
        title="Services and cities"
        description={description}
        query={`?property=${property.id}`}
        canConnect={canConnect}
        crumbs={[{ href: `/admin/marketing/seo/local?property=${property.id}` as Route, label: "Local SEO" }]}
      />
      <PropertyPicker id="local-setup-property" properties={properties} current={property.id} />
      <LocalNav current="setup" propertyId={property.id} />

      {setup.isInternal && canManage ? (
        <Card className="mb-5">
          <CardBody>
            <ActionForm action={importLocalFromCmsAction} label="Import from the CMS" pendingLabel="Importing…" variant="secondary" hidden={{ propertyId: property.id }}>
              <p className="text-xs text-ink-muted">
                The agency&rsquo;s own website: adds each published CMS service and each city with a Service × City page that is not on the lists yet. Imported services point at their Service × City pages. Nothing is removed.
              </p>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <h2 className="text-base text-navy-800">
              Services <span className="text-xs font-normal text-ink-subtle">{setup.services.length} of {setup.caps.services}</span>
            </h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {setup.services.length === 0 ? <p className="text-sm text-ink-subtle">No services yet.</p> : null}
            {setup.services.map((service) => (
              <div key={service.id} className="rounded-md border border-line p-3">
                {canManage ? (
                  <div className="space-y-2">
                    <ActionForm action={saveLocalServiceAction} label="Save" variant="secondary" hidden={{ propertyId: property.id, id: service.id }} className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`name-${service.id}`}>Name</Label>
                          <Input id={`name-${service.id}`} name="name" defaultValue={service.name} maxLength={100} required />
                        </div>
                        <div>
                          <Label htmlFor={`terms-${service.id}`}>Search words</Label>
                          <Input id={`terms-${service.id}`} name="terms" defaultValue={service.terms.join(", ")} placeholder="seo, search engine optimisation" />
                        </div>
                      </div>
                      {service.cmsServiceId ? <p className="text-2xs text-ink-subtle">Imported from the CMS.</p> : null}
                    </ActionForm>
                    <ActionForm action={removeLocalServiceAction} label="Remove" variant="danger" hidden={{ propertyId: property.id, id: service.id }} confirm={`Remove ${service.name}? Pages chosen for it go too.`} />
                  </div>
                ) : (
                  <p className="text-sm text-navy-800">
                    {service.name} <span className="text-xs text-ink-subtle">{service.terms.join(", ") || "matched by its name"}</span>
                  </p>
                )}
              </div>
            ))}
            {canManage && setup.services.length < setup.caps.services ? (
              <ActionForm action={saveLocalServiceAction} label="Add service" hidden={{ propertyId: property.id }} className="space-y-2 border-t border-line pt-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="new-service-name">New service</Label>
                    <Input id="new-service-name" name="name" maxLength={100} placeholder="SEO" required />
                  </div>
                  <div>
                    <Label htmlFor="new-service-terms">Search words</Label>
                    <Input id="new-service-terms" name="terms" placeholder="seo, search engine optimisation" />
                  </div>
                </div>
                <p className="text-2xs text-ink-subtle">Comma-separated, up to {setup.caps.terms}. Empty means the name itself.</p>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <h2 className="text-base text-navy-800">
              Cities <span className="text-xs font-normal text-ink-subtle">{setup.cities.length} of {setup.caps.cities}</span>
            </h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>City</TH>
                    <TH>Other names</TH>
                    {canManage ? <TH className="text-right">Remove</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {setup.cities.length === 0 ? (
                    <TableEmpty colSpan={canManage ? 3 : 2} title="No cities yet." />
                  ) : (
                    setup.cities.map((city) => (
                      <TR key={city.id}>
                        <TD>
                          <span className="text-navy-800">{city.name}</span>
                          <span className="block text-2xs text-ink-subtle">{[city.state, city.country].filter(Boolean).join(", ")}</span>
                        </TD>
                        <TD className="min-w-[14rem]">
                          {canManage ? (
                            <ActionForm action={setLocalCityAliasesAction} label="Save" variant="secondary" hidden={{ propertyId: property.id, localCityId: city.id }} className="flex flex-wrap items-center gap-2">
                              <label htmlFor={`aliases-${city.id}`} className="sr-only">
                                Other names for {city.name}
                              </label>
                              <Input id={`aliases-${city.id}`} name="aliases" defaultValue={city.aliases.join(", ")} placeholder="bangalore" className="w-44" />
                            </ActionForm>
                          ) : (
                            <span className="text-xs text-ink-muted">{city.aliases.join(", ") || "—"}</span>
                          )}
                        </TD>
                        {canManage ? (
                          <TD className="text-right">
                            <ActionForm action={removeLocalCityAction} label="Remove" variant="danger" hidden={{ propertyId: property.id, localCityId: city.id }} confirm={`Remove ${city.name}?`} />
                          </TD>
                        ) : null}
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </TableWrap>
            {canManage && setup.cities.length < setup.caps.cities ? (
              cities.length ? (
                <ActionForm action={addLocalCitiesAction} label="Add cities" hidden={{ propertyId: property.id }} className="space-y-2 border-t border-line pt-4">
                  <Label htmlFor="add-cities">Add cities</Label>
                  <Select id="add-cities" name="cityIds" multiple size={8} className="w-full">
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name} — {[city.state, city.country].filter(Boolean).join(", ")}
                        {city.isActive ? "" : " (inactive)"}
                      </option>
                    ))}
                  </Select>
                  <p className="text-2xs text-ink-subtle">Hold Ctrl or ⌘ to choose several. Cities come from Catalog → Cities.</p>
                </ActionForm>
              ) : (
                <p className="border-t border-line pt-4 text-xs text-ink-subtle">Every city in the catalog is already on the list. Add cities under Catalog → Cities.</p>
              )
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
