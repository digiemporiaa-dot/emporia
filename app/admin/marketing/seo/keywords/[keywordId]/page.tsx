import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { keywordDetail } from "@/lib/services/seo-intel/keyword.service";
import { eachDay } from "@/lib/seo-intel/dates";
import { TrendChart } from "@/components/admin/charts";
import { Card, CardBody, CardHeader, CardTitle, Field, Input, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { ActionForm } from "../../action-form";
import { removeKeywordsAction, setKeywordTagsAction } from "../../actions";
import { Stat, UrlCell } from "../../crawl-parts";
import { formatCount, formatRange } from "../../overview-parts";
import { BandNote, ChangeCell, formatCtr, formatPos } from "../keyword-parts";

export const metadata: Metadata = { title: "Keyword" };
export const dynamic = "force-dynamic";

export default async function KeywordPage({
  params,
  searchParams,
}: {
  params: Promise<{ keywordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { keywordId } = await params;
  const raw = await searchParams;
  const propertyId = typeof raw["property"] === "string" ? raw["property"].slice(0, 40) : "";
  const actor = await requireActorPage("/admin/marketing/seo/keywords");
  requirePermission(actor, "seo.intelligence.view");
  const canManage = can(actor, "seo.intelligence.manage");

  let detail;
  try {
    detail = await keywordDetail(actor, propertyId, keywordId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { keyword } = detail;
  const back = `/admin/marketing/seo/keywords?property=${propertyId}` as Route;

  const header = (
    <SeoHeader
      current="keywords"
      title={keyword.keyword}
      description={`Tracked since ${keyword.createdAt.toISOString().slice(0, 10)}${keyword.createdBy ? ` by ${keyword.createdBy.name}` : ""}${keyword.source === "SEARCH_CONSOLE" ? ", picked from Search Console" : ""}. Positions are Search Console's average for this query.`}
      crumbs={[{ href: back, label: "Keywords" }, { label: keyword.keyword }]}
      query={`?property=${propertyId}`}
      canConnect={can(actor, "seo.intelligence.connect")}
    />
  );

  const manage = canManage ? (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <ActionForm action={setKeywordTagsAction} label="Save tags" variant="secondary" hidden={{ propertyId, keywordId: keyword.id }}>
          <Field id="kw-tags" label="Tags" hint="Comma separated.">
            {(aria) => <Input {...aria} name="tags" defaultValue={keyword.tags.join(", ")} maxLength={500} />}
          </Field>
        </ActionForm>
        <ActionForm action={removeKeywordsAction} label="Stop tracking" variant="danger" hidden={{ propertyId, keywordIds: keyword.id }} confirm="Stop tracking this keyword? Its Search Console history stays." />
      </CardBody>
    </Card>
  ) : null;

  if (!detail.hasData) {
    return (
      <>
        {header}
        <p className="mb-5 text-sm text-ink-subtle">No Search Console data for this website yet.</p>
        {manage}
      </>
    );
  }

  const byDay = new Map(detail.series.map((row) => [row.date, row]));
  const days = eachDay(detail.seriesRange.start, detail.seriesRange.end);
  const position = days.map((day) => ({ day, value: byDay.get(day)?.position ?? null }));
  const clicks = days.map((day) => ({ day, value: byDay.get(day)?.clicks ?? null }));

  return (
    <>
      {header}
      <p className="mb-3 text-2xs text-ink-subtle">
        {formatRange(detail.period.current)} vs {formatRange(detail.period.previous)}
      </p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-white px-4 py-3">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Average position</p>
          <p className="mt-1 font-display text-2xl tabular-nums text-navy-800">{formatPos(detail.current.position, detail.current.impressions)}</p>
          <p className="mt-0.5 text-2xs text-ink-subtle">
            <ChangeCell movement={detail.movement} /> <span>was {formatPos(detail.previous.position, detail.previous.impressions)}</span>
          </p>
          <BandNote movement={detail.movement} />
        </div>
        <Stat label="Clicks" value={formatCount(detail.current.clicks)} note={`was ${formatCount(detail.previous.clicks)}`} />
        <Stat label="Impressions" value={formatCount(detail.current.impressions)} note={`was ${formatCount(detail.previous.impressions)}`} />
        <Stat label="CTR" value={formatCtr(detail.current.clicks, detail.current.impressions)} note={`was ${formatCtr(detail.previous.clicks, detail.previous.impressions)}`} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardBody>
            <TrendChart title="Average position per day" data={position} variant="position" emptyText="Search Console reported no impressions for this query in the last 90 days." />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <TrendChart title="Clicks per day" data={clicks} emptyText="Search Console reported no impressions for this query in the last 90 days." />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <h2 className="mb-2 text-base text-navy-800">Pages ranking for it</h2>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Page</TH>
                  <TH className="text-right">Position</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">Impressions</TH>
                </TR>
              </THead>
              <TBody>
                {detail.pages.length === 0 ? (
                  <TableEmpty
                    colSpan={4}
                    title="No ranking pages in this period."
                    description={detail.pairsSince ? `Pages are known from ${detail.pairsSince}.` : "Pages appear after the next Search Console sync."}
                  />
                ) : (
                  detail.pages.map((row) => (
                    <TR key={row.page}>
                      <TD className="max-w-[28rem]">
                        <UrlCell url={row.page} />
                      </TD>
                      <TD className="text-right tabular-nums">{formatPos(row.position, row.impressions)}</TD>
                      <TD className="text-right tabular-nums">{formatCount(row.clicks)}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{formatCount(row.impressions)}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
          {detail.pages.length > 1 ? (
            <p className="mt-2 text-2xs text-ink-subtle">More than one page ranks for this query. Phase 5 will flag cannibalisation; for now, compare them here.</p>
          ) : null}
        </div>
        <div className="space-y-5">
          {manage}
          <Card>
            <CardBody className="text-xs text-ink-muted">
              {detail.rankProvider ? `Exact rank from ${detail.rankProvider}.` : "No rank provider is configured, so exact daily rank, search volume and difficulty are not shown."}
            </CardBody>
          </Card>
          <Link href={back} className="text-xs text-navy-800 underline underline-offset-2">
            Back to keywords
          </Link>
        </div>
      </div>
    </>
  );
}
