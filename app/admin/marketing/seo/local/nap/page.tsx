import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { napOverview } from "@/lib/services/seo-intel/nap.service";
import { Badge, Card, CardBody, CardHeader, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { DATE_TIME, PropertyPicker, Stat, UrlCell } from "../../crawl-parts";
import { formatCount } from "../../overview-parts";
import { LocalNav, Notice } from "../local-parts";
import type { NapMismatch, SchemaField } from "@/lib/seo-intel/engine/nap";

export const metadata: Metadata = { title: "Local SEO — name, address, phone" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ property: z.string().max(40).optional().catch(undefined) });

const FIELD: Record<NapMismatch["field"], string> = { name: "Name", phone: "Phone", street: "Street", locality: "City", postalCode: "Postal code" };
const SCHEMA_FIELD: Record<SchemaField, string> = {
  name: "name",
  telephone: "telephone",
  streetAddress: "streetAddress",
  addressLocality: "addressLocality",
  postalCode: "postalCode",
  addressCountry: "addressCountry",
  geo: "geo",
  openingHours: "openingHours",
};

function Mismatches({ rows }: { rows: NapMismatch[] }) {
  if (!rows.length) return <Badge tone="success">Matches</Badge>;
  return (
    <ul className="space-y-0.5 text-xs">
      {rows.map((row) => (
        <li key={row.field}>
          <span className="font-medium text-brand-red-text">{FIELD[row.field]}</span>: <span className="text-navy-800">{row.found}</span>{" "}
          <span className="text-ink-subtle">— profile says {row.expected}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function LocalNapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/local/nap");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const description =
    "The client's business profile is the reference. The website's LocalBusiness structured data, its phone links and each Google Business listing are compared with it; every difference is a signal Google may not trust.";

  if (!property) {
    return (
      <>
        <SeoHeader current="local" title="Name, address, phone" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const nap = await napOverview(actor, property.id);
  const truth = nap.truth;
  const report = nap.report;
  const profileHref = `/admin/clients/${property.client.id}/onboarding` as Route;

  return (
    <>
      <SeoHeader
        current="local"
        title="Name, address, phone"
        description={description}
        query={`?property=${property.id}`}
        canConnect={canConnect}
        crumbs={[{ href: `/admin/marketing/seo/local?property=${property.id}` as Route, label: "Local SEO" }]}
      />
      <PropertyPicker id="nap-property" properties={properties} current={property.id} />
      <LocalNav current="nap" propertyId={property.id} />

      <Card className="mb-5">
        <CardHeader>
          <h2 className="text-base text-navy-800">Business profile</h2>
          <p className="text-2xs text-ink-subtle">
            From the client&rsquo;s onboarding.{" "}
            <Link href={profileHref} className="text-navy-800 underline underline-offset-2">
              See it
            </Link>
          </p>
        </CardHeader>
        <CardBody className="grid gap-2 text-sm sm:grid-cols-3">
          <p>
            <span className="block text-2xs uppercase tracking-wide text-ink-subtle">Name</span>
            {truth.names.join(" / ") || "—"}
          </p>
          <p>
            <span className="block text-2xs uppercase tracking-wide text-ink-subtle">Address</span>
            {[truth.street, truth.locality, truth.region, truth.postalCode, truth.country].filter(Boolean).join(", ") || "—"}
          </p>
          <p>
            <span className="block text-2xs uppercase tracking-wide text-ink-subtle">Phone</span>
            {truth.phone ?? "—"}
          </p>
        </CardBody>
      </Card>

      {!nap.profileReady || !report ? (
        <Card>
          <CardBody className="text-sm text-ink-subtle">
            The business profile has no address or phone yet, so there is nothing to compare against.{" "}
            <Link href={profileHref} className="text-navy-800 underline underline-offset-2">
              Ask the client to complete it
            </Link>
            .
          </CardBody>
        </Card>
      ) : (
        <>
          {!nap.run ? (
            <Notice>
              No finished crawl yet, so the website itself has not been checked.{" "}
              <Link href={`/admin/marketing/seo/crawl?property=${property.id}` as Route} className="text-navy-800 underline underline-offset-2">
                Crawl it
              </Link>
              .
            </Notice>
          ) : null}

          {nap.run ? (
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <Stat label="Pages with LocalBusiness data" value={formatCount(report.schemaPages)} note={nap.run.finishedAt ? `Crawl of ${DATE_TIME.format(nap.run.finishedAt)}` : undefined} />
              <Stat label="Pages that disagree" value={formatCount(new Set(report.schemaMismatches.map((row) => row.url)).size)} note="Structured data vs the profile" />
              <Stat label="Profile phone on the site" value={report.phoneOnSite === null ? "—" : report.phoneOnSite ? "Yes" : "No"} note="In a tel: link or structured data" />
            </div>
          ) : null}

          <h2 className="mb-2 text-base text-navy-800">Google Business listings</h2>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Listing</TH>
                  <TH>Against the profile</TH>
                </TR>
              </THead>
              <TBody>
                {nap.listings.length === 0 ? (
                  <TableEmpty colSpan={2} title="No Google Business listing has been read yet." />
                ) : (
                  nap.listings.map((listing, i) => (
                    <TR key={listing.id}>
                      <TD>
                        <span className="text-navy-800">{listing.name}</span>
                        <span className="block text-2xs text-ink-subtle">
                          {[listing.subject.name, listing.subject.street, listing.subject.locality, listing.subject.postalCode, listing.subject.phone].filter(Boolean).join(" · ")}
                        </span>
                      </TD>
                      <TD>
                        <Mismatches rows={report.listing[i]?.mismatches ?? []} />
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>

          {nap.run ? (
            <>
              <h2 className="mb-2 mt-6 text-base text-navy-800">Structured data on the website</h2>
              {report.schemaPages === 0 ? (
                <Card>
                  <CardBody className="text-sm text-ink-subtle">
                    No page carries LocalBusiness structured data (JSON-LD with a business type or an address). Adding it to the home and contact pages tells Google the business&rsquo;s name, address and phone directly.
                  </CardBody>
                </Card>
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Page</TH>
                        <TH>Against the profile</TH>
                        <TH>Missing fields</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {[...new Set([...report.schemaMismatches.map((row) => row.url), ...report.incomplete.map((row) => row.url)])].slice(0, 50).map((url) => {
                        const mismatches = report.schemaMismatches.filter((row) => row.url === url).flatMap((row) => row.mismatches);
                        const missing = report.incomplete.filter((row) => row.url === url);
                        return (
                          <TR key={url}>
                            <TD className="max-w-[18rem]">
                              <UrlCell url={url} />
                            </TD>
                            <TD>
                              <Mismatches rows={mismatches} />
                            </TD>
                            <TD className="text-xs">
                              {missing.length === 0 ? (
                                <span className="text-ink-subtle">—</span>
                              ) : (
                                missing.map((row, index) => (
                                  <p key={index}>
                                    {row.required.length ? <span className="text-brand-red-text">Required: {row.required.map((field) => SCHEMA_FIELD[field]).join(", ")}</span> : null}
                                    {row.required.length && row.recommended.length ? " · " : null}
                                    {row.recommended.length ? <span className="text-ink-muted">Recommended: {row.recommended.map((field) => SCHEMA_FIELD[field]).join(", ")}</span> : null}
                                  </p>
                                ))
                              )}
                            </TD>
                          </TR>
                        );
                      })}
                      {report.schemaMismatches.length === 0 && report.incomplete.length === 0 ? <TableEmpty colSpan={3} title="Every LocalBusiness entity matches the profile and has all its fields." /> : null}
                    </TBody>
                  </Table>
                </TableWrap>
              )}

              {report.otherPhones.length ? (
                <>
                  <h2 className="mb-2 mt-6 text-base text-navy-800">Other phone numbers on the website</h2>
                  <p className="mb-2 text-xs text-ink-subtle">Linked numbers that are not the profile&rsquo;s. Fine if they belong to other branches or departments; otherwise update them.</p>
                  <ul className="space-y-0.5 text-sm">
                    {report.otherPhones.slice(0, 20).map((row) => (
                      <li key={row.phone} className="flex flex-wrap justify-between gap-x-3">
                        <span className="font-mono text-xs text-navy-800">{row.phone}</span>
                        <span className="text-2xs tabular-nums text-ink-subtle">
                          {row.pages} {row.pages === 1 ? "page" : "pages"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </>
  );
}
