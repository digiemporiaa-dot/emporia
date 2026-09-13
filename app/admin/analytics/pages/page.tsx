import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { pageFunnel } from "@/lib/services/analytics.service";
import { analyticsParamsSchema } from "@/lib/validation/marketing";
import { RANGE_LABEL, RANGE_PRESETS, resolveRange } from "@/lib/analytics/range";
import {
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata: Metadata = { title: "Page performance" };
export const dynamic = "force-dynamic";

/**
 * What each page is worth.
 *
 * The spine of the product read backwards: a landing page captured a lead, the
 * lead was qualified, it became a client, and that client paid. Every arrow is
 * a foreign key, so this is a join rather than an estimate.
 *
 * Traffic is deliberately absent. Nothing in this application stores a
 * pageview and no analytics provider is implemented, so sessions read "Not
 * connected" rather than zero — a zero would claim the page has no visitors,
 * which is a claim nobody here has the data to make.
 */
export default async function PagePerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/analytics/pages");
  requirePermission(actor, "analytics.view");

  const raw = await searchParams;
  const parsed = analyticsParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : analyticsParamsSchema.parse({});
  const range = resolveRange(params.range);

  const seesMoney = can(actor, "invoices.view");
  const rows = await pageFunnel(actor, range);

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/analytics" className="hover:text-brand-red">
            Analytics
          </Link>
          <span> / Pages</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">What each page is worth</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
          {RANGE_LABEL[params.range]}. Leads are counted where they landed. Revenue is attributed
          once, to the first page that brought the client — so the column sums to money actually
          received, not to more than it.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {RANGE_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={`/admin/analytics/pages?range=${preset}` as Route}
            aria-current={params.range === preset ? "page" : undefined}
            className={`h-8 rounded-md border px-3 text-xs leading-8 ${
              params.range === preset
                ? "border-brand-red bg-brand-red/5 text-brand-red-text"
                : "border-line-strong text-navy-800 hover:border-navy-300"
            }`}
          >
            {RANGE_LABEL[preset]}
          </Link>
        ))}
      </div>

      <TableWrap label="Page performance">
        <Table>
          <THead>
            <TR>
              <TH>Page</TH>
              <TH>Sessions</TH>
              <TH className="text-right">Leads</TH>
              <TH className="text-right">Qualified</TH>
              <TH className="text-right">Clients</TH>
              {seesMoney ? <TH className="text-right">Revenue</TH> : null}
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TableEmpty
                colSpan={seesMoney ? 6 : 5}
                title="No leads in this range"
                description="A page appears here once a lead has landed on it."
              />
            ) : (
              rows.map((row) => (
                <TR key={row.path}>
                  <TD>
                    {row.pageId ? (
                      <Link
                        href={`/admin/website/pages/${row.pageId}` as Route}
                        className="font-medium text-navy-800 hover:text-brand-red"
                      >
                        {row.title ?? row.path}
                      </Link>
                    ) : (
                      <span className="font-medium text-navy-800">{row.title ?? row.path}</span>
                    )}
                    <span className="block font-mono text-2xs text-ink-subtle">{row.path}</span>
                  </TD>
                  <TD className="text-xs text-ink-subtle">
                    {row.sessions === null ? "Not connected" : row.sessions}
                  </TD>
                  <TD className="text-right tabular-nums">{row.leads}</TD>
                  <TD className="text-right tabular-nums">{row.qualified}</TD>
                  <TD className="text-right tabular-nums">{row.clients}</TD>
                  {seesMoney ? (
                    <TD className="text-right tabular-nums">₹{row.revenue}</TD>
                  ) : null}
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>

      <p className="mt-3 max-w-2xl text-2xs text-ink-subtle">
        Sessions read <span className="text-ink">Not connected</span> because nothing here stores a
        pageview and no analytics provider is configured. A zero would say the page has no
        visitors, which is not something this data can tell you.
      </p>
    </>
  );
}
