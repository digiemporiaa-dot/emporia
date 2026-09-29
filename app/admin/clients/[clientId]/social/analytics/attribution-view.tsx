import Link from "next/link";
import type { Route } from "next";
import { Info } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { formatMoney } from "@/lib/money";
import type { AttributionRow, SocialAttribution } from "@/lib/services/social-attribution.service";

/**
 * Social → leads → opportunities → clients → revenue (brief §42).
 *
 * Every figure is a row in the CRM traced through a UTM tag; nothing is
 * modelled. Money a viewer may not see reads "Hidden", never zero.
 */

// Decimal strings from the service, formatted by the one money formatter.
const money = (value: string | null) => (value === null ? "Hidden" : formatMoney(value));

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3.5">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className={`mt-1 break-words tabular-nums ${value === "Hidden" ? "text-base text-ink-subtle" : "text-xl text-navy-800"}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-2xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

function Th({ children, end = false }: { children: React.ReactNode; end?: boolean }) {
  return <th className={`py-1.5 pr-3 text-2xs font-medium uppercase tracking-wide text-ink-subtle ${end ? "text-right" : "text-left"}`}>{children}</th>;
}

function Row({ row, label }: { row: AttributionRow; label: React.ReactNode }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3">{label}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{row.leads}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{row.opportunities}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{money(row.won)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{row.clients}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{money(row.revenue)}</td>
    </tr>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <Th>{first}</Th>
        <Th end>Leads</Th>
        <Th end>Opportunities</Th>
        <Th end>Won value</Th>
        <Th end>Became clients</Th>
        <Th end>Revenue received</Th>
      </tr>
    </thead>
  );
}

export function AttributionView({ clientId, data }: { clientId: string; data: SocialAttribution }) {
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>Leads and revenue from social</CardTitle>
          <p className="max-w-3xl text-2xs text-ink-subtle">
            Leads captured on this website whose last visit came through this client&rsquo;s social posts (their UTM
            tags), and what those leads became. Traffic sent to the client&rsquo;s own website is not in this CRM and
            cannot appear here. Revenue is money received in the period from clients who first came through these leads.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {!data.available ? (
          <p className="text-sm text-ink-subtle">You need access to leads to see social attribution.</p>
        ) : data.totals.leads === 0 && (data.totals.revenue === null || data.totals.revenue === "0.00") ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-subtle">
            No leads in this period came through this client&rsquo;s social posts.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Tile label="Leads" value={String(data.totals.leads)} />
              <Tile label="Opportunities" value={String(data.totals.opportunities)} />
              <Tile label="Open pipeline" value={money(data.totals.pipeline)} />
              <Tile label="Won value" value={money(data.totals.won)} />
              <Tile label="Became clients" value={String(data.totals.clients)} />
              <Tile label="Revenue received" value={money(data.totals.revenue)} />
            </div>

            {data.campaigns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-xs">
                  <Head first="Campaign" />
                  <tbody>
                    {data.campaigns.map((row) => (
                      <Row key={row.id} row={row} label={<span className="text-navy-800">{row.label}</span>} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {data.posts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-xs">
                  <Head first="Post" />
                  <tbody>
                    {data.posts.map((row) => (
                      <Row
                        key={row.id}
                        row={row}
                        label={
                          <Link href={`/admin/clients/${clientId}/social/content/${row.itemId}` as Route} className="text-navy-800 hover:text-brand-red-text">
                            {row.label}
                            <span className="ml-1.5 text-2xs text-ink-subtle">{PROVIDER_LABEL[row.provider]}</span>
                          </Link>
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}

        {data.available ? (
          <ul className="space-y-1 text-2xs text-ink-subtle">
            {data.ownLeadsOnly ? (
              <li className="flex items-start gap-1.5">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                Counting only the leads assigned to you.
              </li>
            ) : null}
            {data.moneyWithheld.opportunities || data.moneyWithheld.revenue ? (
              <li className="flex items-start gap-1.5">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                Some amounts are hidden because your role does not include{" "}
                {[data.moneyWithheld.opportunities ? "opportunities" : null, data.moneyWithheld.revenue ? "invoices" : null].filter(Boolean).join(" or ")}.
              </li>
            ) : null}
            {data.truncated ? (
              <li className="flex items-start gap-1.5">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                Only the most recent 5,000 social leads were examined.
              </li>
            ) : null}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
