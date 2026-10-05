import { change, reportMonthLabel, type SeoReportData } from "@/lib/seo-intel/report-doc";

/**
 * A monthly SEO report, as the client reads it (Phase 11).
 *
 * One component for the admin preview, the portal and the print view, so the
 * three can never disagree. Everything comes from the frozen report data. A
 * source that was not connected says so; it is never shown as zeros, and a
 * change is shown only where both periods have a figure.
 */

const NUMBER = new Intl.NumberFormat("en-IN");
const COMPACT = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const SEVERITY = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" } as const;

function pct(fraction: number | null, digits = 0): string | null {
  if (fraction === null) return null;
  const value = fraction * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function money(value: string, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: currency ? "currency" : "decimal", currency: currency ?? undefined, maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return value;
  }
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="break-inside-avoid space-y-2">
      <h2 className="text-sm font-semibold text-navy-800">{title}</h2>
      {note ? <p className="text-2xs text-ink-subtle">{note}</p> : null}
      {children}
    </section>
  );
}

function Figure({ label, value, title, detail }: { label: string; value: string; title?: string; detail?: string | null }) {
  return (
    <div className="rounded-lg border border-line p-3.5 break-inside-avoid">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 text-2xl tabular-nums text-navy-800" title={title}>
        {value}
      </p>
      {detail ? <p className="mt-0.5 text-2xs text-ink-subtle">{detail}</p> : null}
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}

function compare(current: number, previous: number, lastYear?: number): string | null {
  const parts: string[] = [];
  const month = pct(change(current, previous));
  if (month) parts.push(`${month} vs previous month`);
  const year = lastYear === undefined ? null : pct(change(current, lastYear));
  if (year) parts.push(`${year} vs last year`);
  return parts.length ? parts.join(" · ") : null;
}

const ms = (value: number | null) => (value === null ? "Not enough data" : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`);

export function SeoReportDocument({ data, notes }: { data: SeoReportData; notes: string | null }) {
  const s = data.search;
  const o = data.organic;
  const t = data.technical;

  return (
    <article className="space-y-6 text-ink">
      <header className="border-b border-line pb-4">
        <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">SEO report</p>
        <h1 className="mt-1 text-2xl text-navy-800">
          {data.website.name} — {reportMonthLabel(data.month)}
        </h1>
        <p className="mt-1 text-2xs text-ink-subtle">
          {data.website.client} · {data.website.domain} · Figures from Google Search Console, Google Analytics and our site crawler as stored on{" "}
          {DATE.format(new Date(data.generatedAt))}.
        </p>
      </header>

      {notes ? (
        <Section title="From your team">
          <p className="whitespace-pre-line text-sm leading-relaxed">{notes}</p>
        </Section>
      ) : null}

      <Section
        title="Google Search"
        note={s && s.current.days < s.daysInMonth ? `Search Console had data for ${s.current.days} of ${s.daysInMonth} days this month.` : undefined}
      >
        {!s ? (
          <Missing>Google Search Console is not connected for this website, so there are no search figures.</Missing>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label="Clicks" value={COMPACT.format(s.current.clicks)} title={NUMBER.format(s.current.clicks)} detail={compare(s.current.clicks, s.previous.clicks, s.lastYear.days ? s.lastYear.clicks : undefined)} />
              <Figure label="Impressions" value={COMPACT.format(s.current.impressions)} title={NUMBER.format(s.current.impressions)} detail={compare(s.current.impressions, s.previous.impressions, s.lastYear.days ? s.lastYear.impressions : undefined)} />
              <Figure label="Click-through rate" value={s.current.ctr === null ? "—" : `${(s.current.ctr * 100).toFixed(1)}%`} detail={s.previous.ctr === null ? null : `${(s.previous.ctr * 100).toFixed(1)}% the month before`} />
              <Figure
                label="Average position"
                value={s.current.position === null ? "—" : s.current.position.toFixed(1)}
                detail={s.previous.position === null ? null : `${s.previous.position.toFixed(1)} the month before · lower is better`}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Top searches</h3>
                {s.topQueries.length === 0 ? (
                  <Missing>No searches recorded.</Missing>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-2xs text-ink-subtle">
                        <th className="py-1 font-medium">Search</th>
                        <th className="py-1 text-right font-medium">Clicks</th>
                        <th className="py-1 text-right font-medium">Before</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {s.topQueries.map((row) => (
                        <tr key={row.query}>
                          <td className="max-w-0 truncate py-1 pr-2" title={row.query}>
                            {row.query}
                          </td>
                          <td className="py-1 text-right tabular-nums">{NUMBER.format(row.clicks)}</td>
                          <td className="py-1 text-right tabular-nums text-ink-subtle">{NUMBER.format(row.previousClicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Top pages</h3>
                {s.topPages.length === 0 ? (
                  <Missing>No pages recorded.</Missing>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-2xs text-ink-subtle">
                        <th className="py-1 font-medium">Page</th>
                        <th className="py-1 text-right font-medium">Clicks</th>
                        <th className="py-1 text-right font-medium">Before</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {s.topPages.map((row) => (
                        <tr key={row.page}>
                          <td className="max-w-0 truncate py-1 pr-2" title={row.page}>
                            {row.page}
                          </td>
                          <td className="py-1 text-right tabular-nums">{NUMBER.format(row.clicks)}</td>
                          <td className="py-1 text-right tabular-nums text-ink-subtle">{NUMBER.format(row.previousClicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <p className="text-2xs text-ink-subtle">&ldquo;Before&rdquo; is the same search or page&apos;s clicks the month before.</p>
          </>
        )}
      </Section>

      {data.keywords ? (
        <Section title="Tracked keywords" note="Average position in Google for the keywords we track for you, this month against the month before.">
          <p className="text-sm">
            <span className="tabular-nums">{data.keywords.inTop10}</span> of <span className="tabular-nums">{data.keywords.tracked}</span> tracked keywords averaged a
            first-page position (top 10).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["Moved up", data.keywords.improved],
                ["Moved down", data.keywords.declined],
              ] as const
            ).map(([label, rows]) => (
              <div key={label}>
                <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</h3>
                {rows.length === 0 ? (
                  <Missing>None moved a full place or more.</Missing>
                ) : (
                  <ul className="space-y-0.5 text-xs">
                    {rows.map((row) => (
                      <li key={row.keyword} className="flex justify-between gap-2">
                        <span className="truncate" title={row.keyword}>
                          {row.keyword}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {row.from.toFixed(1)} → {row.to.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Visits from search" note={o ? "Google Analytics sessions from organic search, and what they led to." : undefined}>
        {!o ? (
          <Missing>Google Analytics is not connected for this website, so there are no visit figures.</Missing>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Organic sessions" value={COMPACT.format(o.current.sessions)} title={NUMBER.format(o.current.sessions)} detail={compare(o.current.sessions, o.previous.sessions)} />
            <Figure label="Engaged sessions" value={COMPACT.format(o.current.engagedSessions)} title={NUMBER.format(o.current.engagedSessions)} detail={compare(o.current.engagedSessions, o.previous.engagedSessions)} />
            <Figure label="Key events" value={NUMBER.format(Math.round(o.current.keyEvents))} detail={compare(o.current.keyEvents, o.previous.keyEvents)} />
            <Figure label="Revenue" value={money(o.current.revenue, o.currency)} detail={compare(Number(o.current.revenue), Number(o.previous.revenue))} />
          </div>
        )}
      </Section>

      <Section title="Site health">
        {!t ? (
          <Missing>The site has not been crawled yet.</Missing>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label="Pages checked" value={NUMBER.format(t.latest.pagesFetched)} detail={t.previous ? `${NUMBER.format(t.previous.pagesFetched)} last time` : null} />
              <Figure label="Indexable pages" value={NUMBER.format(t.latest.indexablePages)} detail={t.previous ? `${NUMBER.format(t.previous.indexablePages)} last time` : null} />
              <Figure label="Critical issues" value={NUMBER.format(t.latest.critical)} detail={t.previous ? `${NUMBER.format(t.previous.critical)} last time` : null} />
              <Figure label="Warnings" value={NUMBER.format(t.latest.warning)} detail={t.previous ? `${NUMBER.format(t.previous.warning)} last time` : null} />
            </div>
            <p className="text-2xs text-ink-subtle">From the crawl finished {DATE.format(new Date(t.latest.finishedAt))}{t.previous ? `, compared with ${DATE.format(new Date(t.previous.finishedAt))}` : ""}.</p>
          </>
        )}
      </Section>

      {data.cwv ? (
        <Section title="Page speed (Core Web Vitals)" note={`Real Chrome users on phones, the 28 days to ${DAY.format(new Date(`${data.cwv.periodEnd}T00:00:00Z`))}, 75th percentile.`}>
          <div className="grid grid-cols-3 gap-3">
            <Figure label="Largest paint (LCP)" value={ms(data.cwv.lcp)} detail="Good is 2.5 s or less" />
            <Figure label="Responsiveness (INP)" value={ms(data.cwv.inp)} detail="Good is 200 ms or less" />
            <Figure label="Layout shift (CLS)" value={data.cwv.cls === null ? "Not enough data" : data.cwv.cls.toFixed(2)} detail="Good is 0.1 or less" />
          </div>
        </Section>
      ) : null}

      <Section title="Work on the site">
        <p className="text-sm">
          <span className="tabular-nums">{data.opportunities.done}</span> improvements completed,{" "}
          <span className="tabular-nums">{data.opportunities.resolved}</span> issues found fixed on the site, and{" "}
          <span className="tabular-nums">{data.opportunities.opened}</span> new ones found this month. <span className="tabular-nums">{data.opportunities.openNow}</span> are open now.
        </p>
        {data.opportunities.top.length ? (
          <div>
            <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Next up</h3>
            <ul className="space-y-0.5 text-xs">
              {data.opportunities.top.map((item, i) => (
                <li key={`${i}-${item.title}`} className="flex justify-between gap-2">
                  <span>{item.title}</span>
                  <span className="shrink-0 text-ink-subtle">{SEVERITY[item.severity]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {data.reviews ? (
        <Section title="Google reviews" note={`Across ${data.reviews.locations} connected Google Business ${data.reviews.locations === 1 ? "location" : "locations"}.`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="New reviews" value={NUMBER.format(data.reviews.newReviews)} />
            <Figure label="Their average" value={data.reviews.averageInMonth === null ? "—" : `${data.reviews.averageInMonth.toFixed(1)} ★`} />
            <Figure label="Awaiting a reply" value={NUMBER.format(data.reviews.unanswered)} />
            <Figure label="Google rating" value={data.reviews.googleRating === null ? "—" : `${data.reviews.googleRating.toFixed(1)} ★`} detail="As Google showed it when the report was made" />
          </div>
        </Section>
      ) : null}

      {data.changes.length ? (
        <Section title="Notable changes">
          <ul className="space-y-1 text-xs">
            {data.changes.map((item, i) => (
              <li key={`${i}-${item.title}`} className="flex justify-between gap-2">
                <span>{item.title}</span>
                <span className="shrink-0 text-ink-subtle">{DAY.format(new Date(`${item.periodEnd}T00:00:00Z`))}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}
