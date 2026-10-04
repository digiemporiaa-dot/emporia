import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { internationalOverview } from "@/lib/services/seo-intel/international.service";
import { Badge, Card, CardBody, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { DATE_TIME, PropertyPicker, SeverityBadge, Stat } from "../crawl-parts";
import { formatCount } from "../overview-parts";

export const metadata: Metadata = { title: "International SEO" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ property: z.string().max(40).optional().catch(undefined) });
const pct = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

export default async function InternationalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/international");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const description =
    "The language and country versions the website declares with hreflang, what is wrong with them, and which countries send search traffic. A country without a version of its own is flagged only on websites that serve several.";

  if (!property) {
    return (
      <>
        <SeoHeader current="international" title="International SEO" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const data = await internationalOverview(actor, property.id);
  const issueTotal = data.issues.reduce((sum, issue) => sum + issue.count, 0);

  return (
    <>
      <SeoHeader current="international" title="International SEO" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="intl-property" properties={properties} current={property.id} />

      {!data.run ? (
        <Card className="mb-5">
          <CardBody className="text-sm text-ink-subtle">
            No finished crawl for this website yet.{" "}
            <Link href={`/admin/marketing/seo/crawl?property=${property.id}` as Route} className="text-navy-800 underline underline-offset-2">
              Crawl it
            </Link>{" "}
            to see its language and country versions.
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Versions declared" value={formatCount(data.versions.length)} note="Distinct hreflang codes" />
            <Stat label="Pages crawled" value={formatCount(data.pages)} note={data.run.finishedAt ? `Crawl of ${DATE_TIME.format(data.run.finishedAt)}` : undefined} />
            <Stat label="International issues" value={formatCount(issueTotal)} note="Findings in the latest crawl" />
            <Stat label="Countries without a version" value={data.multiVersion ? formatCount(data.countries.filter((row) => row.missing).length) : "—"} note={data.multiVersion ? "Above the thresholds" : "Single-version website"} />
          </div>

          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <h2 className="mb-2 text-base text-navy-800">Versions</h2>
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Hreflang</TH>
                      <TH className="text-right">Pages declaring it</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.versions.length === 0 ? (
                      <TableEmpty colSpan={2} title="No hreflang on this website." description="Fine for a site with one language and one market." />
                    ) : (
                      data.versions.map((row) => (
                        <TR key={row.code}>
                          <TD className="font-mono text-xs">{row.code}</TD>
                          <TD className="text-right tabular-nums">{formatCount(row.pages)}</TD>
                        </TR>
                      ))
                    )}
                  </TBody>
                </Table>
              </TableWrap>
              <p className="mt-2 text-2xs text-ink-subtle">
                Page languages (&lt;html lang&gt;): {data.languages.map((row) => `${row.language ?? "none"} ${formatCount(row.pages)}`).join(" · ") || "—"}
                {data.segments.length ? ` · Locale paths: ${data.segments.map((row) => `/${row.segment}/ ${formatCount(row.pages)}`).join(" · ")}` : ""}
              </p>
            </div>

            <div className="min-w-0">
              <h2 className="mb-2 text-base text-navy-800">Issues</h2>
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Rule</TH>
                      <TH>Severity</TH>
                      <TH className="text-right">Pages</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.issues.map((issue) => (
                      <TR key={issue.rule}>
                        <TD>
                          {issue.count ? (
                            <Link href={`/admin/marketing/seo/technical?property=${property.id}&rule=${issue.rule}` as Route} className="text-navy-800 underline-offset-2 hover:underline">
                              {issue.title}
                            </Link>
                          ) : (
                            <span className="text-ink-muted">{issue.title}</span>
                          )}
                          <span className="block text-2xs text-ink-subtle">{issue.why}</span>
                        </TD>
                        <TD>
                          <SeverityBadge severity={issue.severity} />
                        </TD>
                        <TD className="text-right tabular-nums">{formatCount(issue.count)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
          </div>
        </>
      )}

      <h2 className="mb-2 text-base text-navy-800">Search traffic by country</h2>
      {!data.period ? (
        <Card>
          <CardBody className="text-sm text-ink-subtle">
            No Search Console data yet.{" "}
            <Link href={`/admin/marketing/seo/properties/${property.id}/search-console` as Route} className="text-navy-800 underline underline-offset-2">
              Connect Search Console
            </Link>
            .
          </CardBody>
        </Card>
      ) : (
        <>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Country</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">Share</TH>
                  <TH className="text-right">Previous 28 days</TH>
                  <TH className="text-right">Impressions</TH>
                  <TH>Version</TH>
                </TR>
              </THead>
              <TBody>
                {data.countries.length === 0 ? (
                  <TableEmpty colSpan={6} title="No country data in this period." />
                ) : (
                  data.countries.map((row) => (
                    <TR key={row.country}>
                      <TD>
                        {row.name} <span className="font-mono text-2xs text-ink-subtle">{row.country}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{formatCount(row.clicks)}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{pct(row.share)}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{formatCount(row.previousClicks)}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{formatCount(row.impressions)}</TD>
                      <TD>
                        {row.hasVersion ? <Badge tone="success">Has one</Badge> : row.missing ? <Badge tone="warning">Missing</Badge> : <span className="text-xs text-ink-subtle">—</span>}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
          <p className="mt-2 text-2xs text-ink-subtle">
            Search Console, {data.period.current.start} to {data.period.current.end}. &ldquo;Has one&rdquo; means an hreflang region, a country path such as /ae/, or the website&rsquo;s default country. Thresholds are in Settings → Thresholds.
          </p>
        </>
      )}
    </>
  );
}
