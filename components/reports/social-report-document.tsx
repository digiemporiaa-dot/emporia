import { POST_TYPE_LABEL, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { CONTENT_STAGE_LABEL } from "@/lib/projects/lifecycle";
import { monthLabel, type SocialReportData } from "@/lib/social/report-doc";
import type { ContentStage } from "@/generated/prisma/enums";

/**
 * A monthly social report, as the client reads it (brief §32).
 *
 * One component for the admin preview, the portal and the print view, so the
 * three can never disagree. Everything comes from the frozen report data; a
 * figure nobody reported says so, and the change against the previous month is
 * shown only where both months have a figure.
 */

const NUMBER = new Intl.NumberFormat("en-IN");
const COMPACT = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

type Total = { value: number | null; reporting: number; total: number };

function change(now: number | null, before: number | null): string | null {
  if (now === null || before === null || before === 0) return null;
  const pct = ((now - before) / before) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs previous month`;
}

function Figure({ label, total, previous }: { label: string; total: Total; previous: Total }) {
  const delta = change(total.value, previous.value);
  return (
    <div className="rounded-lg border border-line p-3.5 break-inside-avoid">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      {total.value === null ? (
        <p className="mt-1 text-base text-ink-subtle">Not reported</p>
      ) : (
        <p className="mt-1 text-2xl tabular-nums text-navy-800" title={NUMBER.format(total.value)}>
          {COMPACT.format(total.value)}
        </p>
      )}
      <p className="mt-0.5 text-2xs text-ink-subtle">
        {total.value === null ? "No platform reported this." : `from ${total.reporting} of ${total.total} posts`}
        {delta ? ` · ${delta}` : ""}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-2">
      <h2 className="text-sm font-semibold text-navy-800">{title}</h2>
      {children}
    </section>
  );
}

export function SocialReportDocument({ data, notes }: { data: SocialReportData; notes: string | null }) {
  const c = data.current;
  const p = data.previous;
  const postsDelta = change(c.posts, p.posts);

  return (
    <article className="space-y-6 text-ink">
      <header className="border-b border-line pb-4">
        <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Social media report</p>
        <h1 className="mt-1 text-2xl text-navy-800">
          {data.clientName} — {monthLabel(data.month)}
        </h1>
        <p className="mt-1 text-2xs text-ink-subtle">
          Figures as the platforms reported them on {DATE.format(new Date(data.generatedAt))}. A figure a platform does not
          report is shown as not reported, never as zero.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line p-3.5 break-inside-avoid">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Posts published</p>
          <p className="mt-1 text-2xl tabular-nums text-navy-800">{NUMBER.format(c.posts)}</p>
          <p className="mt-0.5 text-2xs text-ink-subtle">
            {c.measured} with figures{postsDelta ? ` · ${postsDelta}` : ""}
          </p>
        </div>
        <Figure label="Reach" total={c.reach} previous={p.reach} />
        <Figure label="Impressions" total={c.impressions} previous={p.impressions} />
        <Figure label="Engagement" total={c.engagement} previous={p.engagement} />
        <Figure label="Followers gained" total={c.followersGained} previous={p.followersGained} />
        <div className="rounded-lg border border-line p-3.5 break-inside-avoid">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Engagement rate</p>
          <p className={`mt-1 tabular-nums ${c.rate.value === null ? "text-base text-ink-subtle" : "text-2xl text-navy-800"}`}>
            {c.rate.value === null ? "Needs reach" : `${c.rate.value.toFixed(2)}%`}
          </p>
          <p className="mt-0.5 text-2xs text-ink-subtle">Engagement over reach, from {c.rate.reporting} posts</p>
        </div>
      </div>

      {data.direct && data.direct.posts > 0 ? (
        <Section title="Also posted directly on the platforms">
          <p className="text-xs text-ink-subtle">
            Posts made on the platforms themselves, outside this workspace. Not included in the figures above. LinkedIn and
            X do not let us read these, so they are not counted here.
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Posts", { value: data.direct.posts, reporting: data.direct.posts, total: data.direct.posts }],
                ["Reach", data.direct.reach],
                ["Impressions", data.direct.impressions],
                ["Engagement", data.direct.engagement],
              ] as const
            ).map(([label, figure]) => (
              <div key={label} className="rounded-lg border border-line p-3 break-inside-avoid">
                <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
                <dd className={`mt-1 tabular-nums ${figure.value === null ? "text-sm text-ink-subtle" : "text-lg text-navy-800"}`}>
                  {figure.value === null ? "Not reported" : NUMBER.format(figure.value)}
                </dd>
                {label !== "Posts" && figure.value !== null ? (
                  <p className="text-2xs text-ink-subtle">
                    from {figure.reporting} of {figure.total} posts
                  </p>
                ) : null}
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <Section title="Highlights">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line p-3.5">
            <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Top post</dt>
            <dd className="mt-1 text-sm text-navy-800">
              {data.topPost ? (
                <>
                  {data.topPost.externalUrl ? (
                    <a href={data.topPost.externalUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                      {data.topPost.title}
                    </a>
                  ) : (
                    data.topPost.title
                  )}
                  <span className="block text-2xs text-ink-subtle">
                    {PROVIDER_LABEL[data.topPost.provider]} · {POST_TYPE_LABEL[data.topPost.type]} ·{" "}
                    {DAY.format(new Date(data.topPost.publishedAt))} · {data.topPost.rate.toFixed(2)}% of{" "}
                    {NUMBER.format(data.topPost.reach)} reached
                  </span>
                </>
              ) : (
                <span className="text-ink-subtle">No post reported reach.</span>
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-line p-3.5">
            <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Top platform</dt>
            <dd className="mt-1 text-sm text-navy-800">
              {data.topPlatform ? (
                <>
                  {PROVIDER_LABEL[data.topPlatform.provider]}
                  <span className="block text-2xs text-ink-subtle">{data.topPlatform.rate.toFixed(2)}% engagement rate</span>
                </>
              ) : (
                <span className="text-ink-subtle">Not enough figures.</span>
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-line p-3.5">
            <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Top campaign</dt>
            <dd className="mt-1 text-sm text-navy-800">
              {data.topCampaign ? (
                <>
                  {data.topCampaign.name}
                  <span className="block text-2xs text-ink-subtle">{data.topCampaign.rate.toFixed(2)}% engagement rate</span>
                </>
              ) : (
                <span className="text-ink-subtle">No campaign reported reach.</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="text-2xs text-ink-subtle">Chosen by engagement rate, which compares fairly across platforms.</p>
      </Section>

      <Section title="Content summary">
        {c.posts === 0 ? (
          <p className="text-sm text-ink-subtle">Nothing was published this month.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">By platform</h3>
              <ul className="space-y-0.5 text-xs">
                {data.byProvider.map((row) => (
                  <li key={row.provider} className="flex justify-between gap-2">
                    <span>{PROVIDER_LABEL[row.provider]}</span>
                    <span className="tabular-nums">{row.posts}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">By format</h3>
              <ul className="space-y-0.5 text-xs">
                {data.content.formats.map((row) => (
                  <li key={`${row.provider}-${row.type}`} className="flex justify-between gap-2">
                    <span>
                      {PROVIDER_LABEL[row.provider]} · {POST_TYPE_LABEL[row.type]}
                    </span>
                    <span className="tabular-nums">{row.posts}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">By campaign and pillar</h3>
              <ul className="space-y-0.5 text-xs">
                {data.content.campaigns.map((row) => (
                  <li key={`c-${row.name}`} className="flex justify-between gap-2">
                    <span>{row.name}</span>
                    <span className="tabular-nums">{row.posts}</span>
                  </li>
                ))}
                {data.content.pillars.map((row) => (
                  <li key={`p-${row.name}`} className="flex justify-between gap-2 text-ink-muted">
                    <span>{row.name}</span>
                    <span className="tabular-nums">{row.posts}</span>
                  </li>
                ))}
                {data.content.campaigns.length + data.content.pillars.length === 0 ? (
                  <li className="text-ink-subtle">None filed under a campaign or pillar.</li>
                ) : null}
              </ul>
            </div>
          </div>
        )}
        {notes ? <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-muted p-3.5 text-sm">{notes}</p> : null}
      </Section>

      <Section title={`Plan for ${monthLabel(data.nextMonth.month)}`}>
        {data.nextMonth.ideas === 0 ? (
          <p className="text-sm text-ink-subtle">Nothing was planned yet when this report was generated.</p>
        ) : (
          <>
            <p className="text-xs text-ink-muted">
              {data.nextMonth.ideas} idea{data.nextMonth.ideas === 1 ? "" : "s"}, {data.nextMonth.versions} platform version
              {data.nextMonth.versions === 1 ? "" : "s"} —{" "}
              {data.nextMonth.byStage.map((s) => `${s.ideas} ${CONTENT_STAGE_LABEL[s.stage as ContentStage]?.toLowerCase() ?? s.stage}`).join(", ")}.
            </p>
            <ul className="divide-y divide-line rounded-lg border border-line text-xs">
              {data.nextMonth.items.map((item, index) => (
                <li key={`${item.title}-${index}`} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
                  <span className="text-navy-800">{item.title}</span>
                  <span className="text-ink-subtle">
                    {item.platforms.map((pp) => PROVIDER_LABEL[pp]).join(", ") || "No platform yet"} ·{" "}
                    {item.day ? DAY.format(new Date(`${item.day}T00:00:00Z`)) : "No date"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {data.truncated ? (
        <p className="text-2xs text-ink-subtle">This month held more posts than one report adds up; figures cover the most recent ones.</p>
      ) : null}
    </article>
  );
}
