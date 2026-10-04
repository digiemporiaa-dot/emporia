import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { crawlIssueSummary, listCrawlIssues, listCrawlRuns } from "@/lib/services/seo-intel/crawl.service";
import { RULES, type RuleKey } from "@/lib/seo-intel/engine/technical";
import { Pagination } from "@/components/admin/pagination";
import { Card, CardBody, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { DATE_TIME, FilterLinks, PropertyPicker, SeverityBadge, Stat, UrlCell } from "../crawl-parts";
import { formatCount } from "../overview-parts";

export const metadata: Metadata = { title: "Technical SEO" };
export const dynamic = "force-dynamic";

const SEVERITIES = ["CRITICAL", "WARNING", "NOTICE"] as const;

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  run: z.string().max(40).optional().catch(undefined),
  rule: z.string().max(60).optional().catch(undefined),
  severity: z.enum(SEVERITIES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const PAGE_SIZE = 50;

const isRule = (value: string): value is RuleKey => value in RULES;

/** The evidence a finding carries, as one readable line. */
function evidence(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d["status"] === "number") parts.push(`HTTP ${d["status"]}`);
  if (Array.isArray(d["chain"])) parts.push((d["chain"] as string[]).join(" → "));
  if (typeof d["target"] === "string") parts.push(`→ ${d["target"]}`);
  if (typeof d["canonical"] === "string") parts.push(`canonical ${d["canonical"]}`);
  if (typeof d["alternate"] === "string") parts.push(`${d["lang"] ?? ""} ${d["alternate"]}`.trim());
  if (typeof d["length"] === "number") parts.push(`${d["length"]} characters`);
  if (typeof d["words"] === "number") parts.push(`${d["words"]} words`);
  if (typeof d["ms"] === "number") parts.push(`${d["ms"]} ms`);
  if (typeof d["depth"] === "number") parts.push(`${d["depth"]} clicks deep`);
  if (typeof d["count"] === "number" && !Array.isArray(d["duplicates"])) parts.push(`${d["count"]}`);
  if (Array.isArray(d["duplicates"])) parts.push(`same as ${(d["duplicates"] as string[]).slice(0, 3).join(", ")}${(d["count"] as number) > 4 ? ` and ${(d["count"] as number) - 4} more` : ""}`);
  if (typeof d["error"] === "string") parts.push(d["error"]);
  if (Array.isArray(d["linkedFrom"]) && (d["linkedFrom"] as string[]).length) parts.push(`linked from ${(d["linkedFrom"] as string[]).slice(0, 2).join(", ")}`);
  if (d["inSitemap"] === true) parts.push("in the sitemap");
  return parts.length ? parts.join(" · ") : null;
}

export default async function TechnicalSeoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/technical");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));

  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const description = "Problems found by the latest finished crawl, worst first. Each finding names the rule, why it matters and the evidence. Calculated by Emporia from the crawl; not a Google report.";

  if (!property) {
    return (
      <>
        <SeoHeader current="technical" title="Technical SEO" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const runs = (await listCrawlRuns(actor, property.id)).filter((run) => run.status === "SUCCEEDED");
  const run = runs.find((candidate) => candidate.id === params.run) ?? runs[0];
  const header = <SeoHeader current="technical" title="Technical SEO" description={description} query={`?property=${property.id}`} canConnect={canConnect} />;

  if (!run) {
    return (
      <>
        {header}
        <PropertyPicker id="tech-property" properties={properties} current={property.id} />
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">
              No finished crawl for this website yet.{" "}
              <Link href={`/admin/marketing/seo/crawl?property=${property.id}`} className="text-navy-800 underline underline-offset-2">
                Start or follow a crawl
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const rule = params.rule && isRule(params.rule) ? params.rule : undefined;
  const [summary, issues] = await Promise.all([
    crawlIssueSummary(actor, run.id),
    rule || params.severity ? listCrawlIssues(actor, run.id, { rule, severity: params.severity, page: params.page, perPage: PAGE_SIZE }) : null,
  ]);
  const totals = { CRITICAL: 0, WARNING: 0, NOTICE: 0 };
  for (const group of summary) totals[group.severity] += group.count;

  const link = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { property: property.id, run: params.run, rule, severity: params.severity, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    return `/admin/marketing/seo/technical?${query}` as Route;
  };

  return (
    <>
      {header}
      <PropertyPicker id="tech-property" properties={properties} current={property.id} />

      <p className="mb-3 text-2xs text-ink-subtle">
        Crawl of {DATE_TIME.format(run.startedAt)} · {formatCount(run.pagesFetched)} pages
        {run.limitReached ? " · stopped at the page limit, so findings cover part of the site" : ""}
        {runs.length > 1 ? " · " : ""}
        {runs.length > 1
          ? runs
              .filter((other) => other.id !== run.id)
              .slice(0, 3)
              .map((other, index) => (
                <span key={other.id}>
                  {index > 0 ? ", " : "compare with "}
                  <Link href={link({ run: other.id, page: undefined })} className="text-navy-800 underline underline-offset-2">
                    {DATE_TIME.format(other.startedAt)}
                  </Link>
                </span>
              ))
          : null}
      </p>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Critical" value={formatCount(totals.CRITICAL)} note="Broken, failing or unreachable" />
        <Stat label="Warnings" value={formatCount(totals.WARNING)} note="Likely to cost rankings or traffic" />
        <Stat label="Notices" value={formatCount(totals.NOTICE)} note="Worth a look; may be intended" />
      </div>

      {rule || params.severity ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base text-navy-800">
                {rule ? (
                  <>
                    <SeverityBadge severity={RULES[rule].severity} />
                    {RULES[rule].title}
                  </>
                ) : (
                  <>All {params.severity?.toLowerCase()} findings</>
                )}
              </h2>
              {rule ? <p className="mt-1 max-w-3xl text-xs text-ink-subtle">{RULES[rule].why}</p> : null}
            </div>
            <Link href={link({ rule: undefined, severity: undefined, page: undefined })} className="text-xs text-navy-800 underline underline-offset-2">
              Back to all findings
            </Link>
          </div>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>URL</TH>
                  {rule ? null : <TH>Finding</TH>}
                  <TH>Evidence</TH>
                </TR>
              </THead>
              <TBody>
                {issues && issues.rows.length > 0 ? (
                  issues.rows.map((issue) => (
                    <TR key={issue.id}>
                      <TD className="max-w-[24rem]">{issue.page ? <UrlCell url={issue.page.url} /> : <span className="text-ink-subtle">—</span>}</TD>
                      {rule ? null : (
                        <TD className="text-xs">
                          <Link href={link({ rule: issue.rule, severity: undefined, page: undefined })} className="text-navy-800 hover:text-brand-red">
                            {isRule(issue.rule) ? RULES[issue.rule].title : issue.rule}
                          </Link>
                        </TD>
                      )}
                      <TD className="max-w-[32rem] break-words text-2xs text-ink-muted">{evidence(issue.detail) ?? "—"}</TD>
                    </TR>
                  ))
                ) : (
                  <TableEmpty colSpan={rule ? 2 : 3} title="Nothing here." />
                )}
              </TBody>
            </Table>
          </TableWrap>
          {issues ? (
            <div className="mt-3">
              <Pagination basePath="/admin/marketing/seo/technical" params={{ property: property.id, run: params.run, rule, severity: params.severity }} page={issues.page} pages={issues.pages} total={issues.total} perPage={PAGE_SIZE} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="mb-3">
            <FilterLinks
              label="Severity"
              items={SEVERITIES.map((severity) => ({
                key: severity,
                label: `All ${severity === "CRITICAL" ? "critical" : severity === "WARNING" ? "warnings" : "notices"}`,
                href: link({ severity, rule: undefined, page: undefined }),
                current: false,
                count: totals[severity],
              }))}
            />
          </div>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Severity</TH>
                  <TH>Finding</TH>
                  <TH className="text-right">Pages</TH>
                </TR>
              </THead>
              <TBody>
                {summary.length === 0 ? (
                  <TableEmpty colSpan={3} title="No technical problems found in this crawl." />
                ) : (
                  summary.map((group) => (
                    <TR key={group.rule}>
                      <TD>
                        <SeverityBadge severity={group.severity} />
                      </TD>
                      <TD>
                        <Link href={link({ rule: group.rule, severity: undefined, page: undefined })} className="text-sm text-navy-800 hover:text-brand-red">
                          {isRule(group.rule) ? RULES[group.rule].title : group.rule}
                        </Link>
                        {isRule(group.rule) ? <p className="mt-0.5 max-w-2xl text-2xs text-ink-subtle">{RULES[group.rule].why}</p> : null}
                      </TD>
                      <TD className="text-right tabular-nums">{formatCount(group.count)}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </>
      )}
    </>
  );
}
