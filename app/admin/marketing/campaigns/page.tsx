import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listCampaigns } from "@/lib/services/campaign.service";
import { campaignPerformance } from "@/lib/services/analytics.service";
import { campaignListParamsSchema } from "@/lib/validation/marketing";
import { pageParamsSchema } from "@/lib/paging";
import { Pagination } from "@/components/admin/pagination";
import { resolveRange, RANGE_LABEL, RANGE_PRESETS, type RangePreset } from "@/lib/analytics/range";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { CampaignStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

const TONE: Record<CampaignStatus, "neutral" | "navy" | "warning" | "success"> = {
  DRAFT: "neutral",
  ACTIVE: "navy",
  PAUSED: "warning",
  COMPLETED: "success",
};

const PLATFORM_LABEL: Record<string, string> = {
  GOOGLE_ADS: "Google Ads",
  META_ADS: "Meta Ads",
  LINKEDIN_ADS: "LinkedIn Ads",
  SEO: "SEO",
  EMAIL: "Email",
  SOCIAL_ORGANIC: "Organic social",
  OTHER: "Other",
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/marketing/campaigns");
  requirePermission(actor, "campaigns.view");

  const raw = await searchParams;
  const parsed = campaignListParamsSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : {};
  const pageParsed = pageParamsSchema.safeParse(raw);
  const params = { ...filters, ...(pageParsed.success ? pageParsed.data : pageParamsSchema.parse({})) };

  const preset: RangePreset = RANGE_PRESETS.includes(raw["range"] as RangePreset)
    ? (raw["range"] as RangePreset)
    : "30d";
  const range = resolveRange(preset);

  const [campaigns, performance] = await Promise.all([
    listCampaigns(actor, params),
    campaignPerformance(actor, range),
  ]);

  // Performance covers every campaign; the list may be narrowed by filters, so
  // the list drives the rows and performance is looked up per row.
  const byId = new Map(performance.map((row) => [row.id, row]));

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/marketing" className="hover:text-navy-800">
              Marketing
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Campaigns</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Campaigns</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            Performance shown for {RANGE_LABEL[preset].toLowerCase()}. Every figure was entered or
            imported by someone — nothing here is estimated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Reporting range" className="flex flex-wrap gap-1">
            {RANGE_PRESETS.map((option) => (
              <Link
                key={option}
                href={`/admin/marketing/campaigns?range=${option}`}
                aria-current={option === preset ? "true" : undefined}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  option === preset
                    ? "border-brand-red bg-red-50 text-brand-red-text"
                    : "border-line-strong text-navy-800 hover:border-navy-300"
                }`}
              >
                {RANGE_LABEL[option]}
              </Link>
            ))}
          </nav>
          {can(actor, "campaigns.create") ? (
            <Link href="/admin/marketing/campaigns/new">
              <Button size="sm">New campaign</Button>
            </Link>
          ) : null}
        </div>
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Campaign</TH>
              <TH>Platform</TH>
              <TH className="text-right">Budget</TH>
              <TH className="text-right">Spend</TH>
              <TH className="text-right">Clicks</TH>
              <TH className="text-right">CTR</TH>
              <TH className="text-right">Leads</TH>
              <TH className="text-right">Cost / lead</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {campaigns.rows.length === 0 ? (
              <TableEmpty
                colSpan={9}
                title="No campaigns yet"
                description="Add a campaign, then enter or import its daily numbers."
              />
            ) : (
              campaigns.rows.map((campaign) => {
                const row = byId.get(campaign.id);
                return (
                  <TR key={campaign.id}>
                    <TD>
                      <Link
                        href={`/admin/marketing/campaigns/${campaign.id}`}
                        className="font-medium text-navy-800 hover:text-brand-red"
                      >
                        {campaign.name}
                      </Link>
                      {campaign.client ? (
                        <span className="block text-2xs text-ink-subtle">
                          {campaign.client.name}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-xs text-ink-muted">
                      {PLATFORM_LABEL[campaign.platform] ?? campaign.platform}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney(campaign.budget, campaign.currency)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {row && row.days > 0 ? (
                        formatMoney(row.spend, campaign.currency)
                      ) : (
                        <span className="text-ink-subtle">no data</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-ink-muted">
                      {row && row.days > 0 ? row.clicks.toLocaleString("en-IN") : "—"}
                    </TD>
                    <TD className="text-right tabular-nums text-ink-muted">
                      {row?.ctr ? `${row.ctr}%` : "—"}
                    </TD>
                    <TD className="text-right tabular-nums">{row?.leads ?? 0}</TD>
                    <TD className="text-right tabular-nums">
                      {row?.cpl ? formatMoney(row.cpl, campaign.currency) : "—"}
                    </TD>
                    <TD>
                      <Badge tone={TONE[campaign.status]}>{campaign.status.toLowerCase()}</Badge>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </TableWrap>

      <Pagination
        basePath="/admin/marketing/campaigns"
        params={{ ...params, range: preset }}
        page={campaigns.page}
        pages={campaigns.pages}
        total={campaigns.total}
        perPage={campaigns.perPage}
      />
    </>
  );
}
