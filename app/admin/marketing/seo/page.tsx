import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties, propertyOrigin } from "@/lib/services/seo-intel/property.service";
import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Select } from "@/components/ui";
import { SeoHeader } from "./seo-header";

export const metadata: Metadata = { title: "SEO Intelligence" };
export const dynamic = "force-dynamic";

/**
 * Executive Overview.
 *
 * Today it can only say which website is selected and which of its data
 * sources are connected — and that is all it says. Clicks, rankings, the
 * Emporia SEO Health Score and "What changed" appear as each source is
 * connected (docs/SEO-INTELLIGENCE-PLAN.md, Part E); until then the screen
 * states what is missing rather than showing a zero that would read as "no
 * traffic" (CLAUDE.md 2 rule 5).
 */
export default async function SeoOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/marketing/seo");
  requirePermission(actor, "seo.intelligence.view");

  const raw = await searchParams;
  const requested = typeof raw["property"] === "string" ? raw["property"] : null;
  const properties = await listProperties(actor, { status: "active" });
  const canManage = can(actor, "seo.intelligence.manage");

  if (properties.length === 0) {
    return (
      <>
        <SeoHeader current="overview" title="SEO Intelligence" description="What is happening in search, why, and what to do next — for each client's websites." />
        <Card>
          <CardBody className="py-10 text-center">
            <h2 className="font-display text-lg text-navy-800">No websites yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-subtle">
              Everything here is about a website: a client&apos;s, or your own. Add one, then connect its Search Console
              to start collecting data.
            </p>
            {canManage ? (
              <div className="mt-5">
                <Link href="/admin/marketing/seo/properties/new">
                  <Button>Add website</Button>
                </Link>
              </div>
            ) : (
              <p className="mt-4 text-xs text-ink-subtle">Someone with SEO management access can add one.</p>
            )}
          </CardBody>
        </Card>
      </>
    );
  }

  // An id that is not one of the listed (active, visible) properties falls
  // back to the first rather than reading anything by the raw id.
  const property = properties.find((candidate) => candidate.id === requested) ?? (properties[0] as (typeof properties)[number]);

  const sources: { name: string; state: "connected" | "missing"; detail: string }[] = [
    {
      name: "Google Search Console",
      state: property.gscSiteUrl ? "connected" : "missing",
      detail: property.gscSiteUrl
        ? property.gscSiteUrl
        : "Not connected yet. Clicks, impressions, CTR, average position and queries come from here.",
    },
    {
      name: "Google Analytics 4",
      state: property.ga4PropertyId ? "connected" : "missing",
      detail: property.ga4PropertyId
        ? property.ga4PropertyId
        : "Not connected yet. Organic sessions, engagement and conversions come from here.",
    },
    {
      name: "Site crawl",
      state: "missing",
      detail: "Not run yet. Technical issues, indexability, internal links and schema come from crawling the site.",
    },
    {
      name: "Rankings",
      state: property.gscSiteUrl ? "connected" : "missing",
      detail: "Search Console average position per query. No rank-tracking provider is configured, so exact daily positions are not available.",
    },
    {
      name: "SERP and backlinks",
      state: "missing",
      detail: "No provider configured. These screens will say so rather than estimate.",
    },
  ];

  return (
    <>
      <SeoHeader
        current="overview"
        title="SEO Intelligence"
        description="What is happening in search, why, and what to do next — for each client's websites."
        query={`?property=${property.id}`}
      />

      <form className="mb-5 flex flex-wrap items-end gap-2">
        <label htmlFor="seo-property" className="sr-only">
          Website
        </label>
        <Select id="seo-property" name="property" defaultValue={property.id} className="w-full max-w-md">
          {properties.map((option) => (
            <option key={option.id} value={option.id}>
              {option.client.name} — {option.displayName} ({option.domain})
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>{property.displayName}</CardTitle>
            <CardDescription>
              <a href={propertyOrigin(property)} target="_blank" rel="noreferrer noopener" className="font-mono hover:text-navy-800">
                {propertyOrigin(property)}
              </a>
            </CardDescription>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-subtle">Client</dt>
              <dd className="text-navy-800">
                {property.client.name}
                {property.client.isInternal ? <span className="ml-1 text-xs text-ink-subtle">(our own website)</span> : null}
              </dd>
              <dt className="text-ink-subtle">Main market</dt>
              <dd className="text-navy-800">{property.defaultCountry?.name ?? "Not set"}</dd>
              <dt className="text-ink-subtle">Language</dt>
              <dd className="font-mono text-navy-800">{property.defaultLanguage}</dd>
              <dt className="text-ink-subtle">Time zone</dt>
              <dd className="text-navy-800">{property.timezone.replace(/_/g, " ")}</dd>
              <dt className="text-ink-subtle">Tasks go to</dt>
              <dd className="text-navy-800">{property.project ? `${property.project.code} — ${property.project.name}` : "No project chosen"}</dd>
              <dt className="text-ink-subtle">Ownership</dt>
              <dd className="text-navy-800">
                {property.verifiedAt ? "Verified through Search Console" : "Not verified — confirmed when Search Console is connected"}
              </dd>
            </dl>
            {canManage ? (
              <div className="mt-4">
                <Link href={`/admin/marketing/seo/properties/${property.id}`} className="text-sm text-navy-800 underline underline-offset-2 hover:text-brand-red">
                  Edit website
                </Link>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>Data sources</CardTitle>
            <CardDescription>
              Every figure on these screens comes from one of these. The Emporia SEO Health Score is calculated only
              once there is data to calculate it from.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {sources.map((source) => (
                <li key={source.name} className="flex items-start justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-navy-800">{source.name}</p>
                    <p className="mt-0.5 break-words text-xs text-ink-subtle">{source.detail}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap">
                    {source.state === "connected" ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not yet</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
