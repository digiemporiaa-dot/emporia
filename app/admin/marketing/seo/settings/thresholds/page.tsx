import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { thresholdSettings } from "@/lib/services/seo-intel/thresholds.service";
import { THRESHOLD_DEFS, THRESHOLD_KEYS, type ThresholdKey } from "@/lib/seo-intel/thresholds";
import { Card, CardBody, CardHeader, CardTitle, Input } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { ActionForm } from "../../action-form";
import { saveThresholdsAction } from "../../actions";
import { PropertyPicker } from "../../crawl-parts";

export const metadata: Metadata = { title: "SEO thresholds" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ property: z.string().max(40).optional().catch(undefined) });

const show = (key: ThresholdKey, value: number) => (THRESHOLD_DEFS[key].unit === "percent" ? `${+(value * 100).toFixed(2)}%` : `${value}`);
const inputValue = (key: ThresholdKey, value: number | undefined) => (value === undefined ? "" : THRESHOLD_DEFS[key].unit === "percent" ? `${+(value * 100).toFixed(2)}` : `${value}`);

/** Agency defaults, or one website's overrides. An empty field inherits. */
export default async function ThresholdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/settings/thresholds");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse({ property: typeof raw["property"] === "string" ? raw["property"] : undefined });
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? null;
  const settings = await thresholdSettings(actor, property?.id ?? null);
  const canEdit = property ? can(actor, "seo.intelligence.manage") : can(actor, "seo.intelligence.connect");
  const groups = [...new Set(THRESHOLD_KEYS.map((key) => THRESHOLD_DEFS[key].group))];

  const fields = (
    <div className="space-y-5">
      {groups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <CardBody className="grid gap-4 md:grid-cols-2">
            {THRESHOLD_KEYS.filter((key) => THRESHOLD_DEFS[key].group === group).map((key) => {
              const def = THRESHOLD_DEFS[key];
              const own = property ? settings.overrides[key] : settings.agency[key] !== settings.defaults[key] ? settings.agency[key] : undefined;
              const inherited = property ? settings.agency[key] : settings.defaults[key];
              return (
                <div key={key}>
                  <label htmlFor={`t-${key}`} className="block text-sm text-navy-800">
                    {def.label} {def.unit === "percent" ? <span className="text-ink-subtle">(%)</span> : null}
                  </label>
                  <Input
                    id={`t-${key}`}
                    name={`t:${key}`}
                    type="number"
                    step="any"
                    min={def.unit === "percent" ? def.min * 100 : def.min}
                    max={def.unit === "percent" ? def.max * 100 : def.max}
                    defaultValue={inputValue(key, own)}
                    placeholder={`${property ? "Agency" : "Default"}: ${show(key, inherited)}`}
                    disabled={!canEdit}
                    className="mt-1"
                    aria-describedby={`h-${key}`}
                  />
                  <p id={`h-${key}`} className="mt-1 text-2xs text-ink-subtle">
                    {def.help} Now: <span className="text-navy-800">{show(key, settings.effective[key])}</span>.
                  </p>
                </div>
              );
            })}
          </CardBody>
        </Card>
      ))}
    </div>
  );

  return (
    <>
      <SeoHeader
        current="settings"
        title="SEO thresholds"
        description={
          property
            ? `Overrides for ${property.displayName}. Leave a field empty to use the agency default shown in it.`
            : "Agency defaults for every website. A website can override any of them; leave a field empty to use the built-in default shown in it."
        }
        crumbs={[{ href: "/admin/marketing/seo/settings" as Route, label: "Settings" }, { label: "Thresholds" }]}
        canConnect={can(actor, "seo.intelligence.connect")}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PropertyPicker id="th-property" properties={properties} current={property?.id ?? ""} />
        {property ? (
          <Link href={"/admin/marketing/seo/settings/thresholds" as Route} className="mb-4 text-xs text-navy-800 underline underline-offset-2">
            Edit agency defaults instead
          </Link>
        ) : null}
      </div>
      {!canEdit ? (
        <p role="status" className="mb-4 rounded-md border border-line bg-white px-3.5 py-2.5 text-xs text-ink-muted">
          {property ? "Changing a website's thresholds needs permission to manage SEO Intelligence." : "Changing agency defaults needs permission to manage SEO settings."}
        </p>
      ) : null}
      {canEdit ? (
        <ActionForm action={saveThresholdsAction} label="Save thresholds" hidden={{ scope: property?.id ?? "agency" }} className="space-y-5">
          {fields}
        </ActionForm>
      ) : (
        fields
      )}
    </>
  );
}
