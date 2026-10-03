# SEO Intelligence — Audit and Implementation Plan

**Status: Phase 1 built. Phase 2 (Search Console) is next.**

| Phase | State |
| ----- | ----- |
| 1 — Properties, countries, permissions, navigation | **Done** — 128 tests |
| 2 — Search Console + Executive Overview | Next |
| 3–11 | Planned, Part E |

This is the mandatory audit step (CLAUDE.md §15) for the SEO Intelligence
brief: what exists today, what the brief collides with, the data model and
provider layer that the eleven phases share, and what each phase delivers. It
is written to be argued with.

---

## Part A — What exists today

### A.1 Nothing SEO-intelligence-shaped exists yet

| Brief asks for              | In the repository today                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Rank tracker                | **None.** Nothing stores a keyword position. So nothing gets duplicated; Phase 4 builds the first one.                     |
| Search Console              | **None.** `lib/reporting/types.ts` names `SEARCH_CONSOLE` in a provider boundary for campaign metrics, with no implementation. |
| GA4                         | **None.** Same boundary, `GA4`, not implemented. `/admin/analytics/pages` says "Not connected" for sessions, on purpose.    |
| Crawler                     | **None.** No outbound URL fetcher and no SSRF guard anywhere in `lib/`.                                                    |
| Competitors, SERP, backlinks | **None.**                                                                                                                  |
| Country model               | **None.** `City` has `state String` and `country String @default("India")`. No `/in/`, `/ae/` routes exist.                |
| Website/property model      | **None.** `Client.website` is one free-text string.                                                                        |

### A.2 What we reuse

| Existing                                                     | How SEO Intelligence uses it                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `Client`, `Project`, `ProjectTask`                           | Properties belong to a client; "Create task" writes a real `ProjectTask`. No second task system.               |
| `lib/social/scope.ts` `resolveClientScope`                   | The same one-function client gate for every SEO service. Portal users get their client from the session only. |
| `IntegrationSetting` + `lib/security/secret`                 | Provider credentials (Google app, SERP/backlink API keys), encrypted, as the AI, SMTP and social settings are. |
| `lib/social/google-oauth.ts`                                 | Google OAuth is already built for YouTube and Business Profile. GSC and GA4 reuse it with their own scopes.    |
| `lib/social/google-business.ts`                              | Business Profile is already connected per client. Local SEO reads reviews and locations from it.              |
| `app/api/cron/route.ts`                                      | One pull-based scheduler. SEO syncs, crawls and change detection are added as jobs; no new infrastructure.     |
| `Lead` → `UTMTracking` → `Opportunity` → `Client` → `Invoice` | The attribution chain is already real foreign keys. Organic is `UTMTracking.source`/`medium` or the referrer.  |
| `analytics.service.ts` revenue rules                         | Revenue is `null` without `invoices.view`; lead figures respect `visibilityFilter`. SEO reuses both rules.     |
| `lib/seo/analyzer.ts`, `Seo`, CMS models                     | Content intelligence for the agency's own site joins crawled URLs to `Page`, `BlogPost`, `Service`, `ServiceCityPage`. |
| `AuditLog`, `checkRateLimit`, `Notification`                 | Settings and actions are audited; provider calls and manual triggers are rate limited; change events can notify. |

### A.3 Collisions to design around

1. **`Opportunity` is taken** — it is the sales pipeline. SEO's are `SeoOpportunity`.
2. **`ProjectTask` needs a `projectId`.** An opportunity can only become a task
   inside a project. A property therefore carries an optional default project;
   "Create task" asks for one when none is set (decision D1 covers the agency's
   own site).
3. **The CMS is the agency's own website.** Clients' websites are not in the
   CMS. Content intelligence can join to CMS records only for the agency's
   property; for client properties it works from crawl + GSC + GA4 data alone.
4. **`seo.view` / `seo.edit` already mean "edit the CMS SEO fields".** Re-using
   them for client SEO data would hand every content editor every client's
   rankings. New permissions are proposed (A.4).

### A.4 Permissions (proposed)

| Permission                    | Grants                                                         | Default roles                                    |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `seo.intelligence.view`       | Read dashboards, crawls, keywords, opportunities              | ADMIN, MARKETING_MANAGER, PROJECT_MANAGER       |
| `seo.intelligence.manage`     | Properties, competitors, keywords, thresholds; run syncs/crawls | ADMIN, MARKETING_MANAGER                        |
| `seo.intelligence.connect`    | Connect/disconnect GSC, GA4 and providers                      | ADMIN                                           |
| `seo.opportunities.manage`    | Assign, dismiss, resolve, create task                          | ADMIN, MARKETING_MANAGER, PROJECT_MANAGER       |

Revenue inside SEO screens additionally needs `invoices.view`, exactly as today.

---

## Part B — Data model (minimal, additive, no destructive change)

All new tables carry `propertyId`, and `SeoProperty` carries `clientId`, so every
query is scoped through one join to a client.

```
Country            code (ISO 3166-1 alpha-2, unique), name, defaultLanguage, isActive
City               + countryId? (nullable, backfilled from the existing string; string kept)

SeoProperty        clientId, projectId?, domain, displayName, protocol, verifiedAt?,
                   gscSiteUrl?, ga4PropertyId?, defaultCountryId?, defaultLanguage, timezone,
                   crawl settings (maxPages, concurrency, frequency, userAgent), isActive
                   @@unique([clientId, domain])
SeoConnection      propertyId, kind (GSC | GA4), status, encrypted tokens, granted scopes,
                   externalAccount, lastSyncedAt, lastError, failureCount
SeoSyncRun         propertyId, source, range, status, rowsWritten, error, startedAt, finishedAt

-- Search Console (daily, stored — never only live)
GscDailyTotal      propertyId, date, clicks, impressions, ctr, position, device?, country?
GscQueryPageDay    propertyId, date, query, page, country, device, clicks, impressions, position
                   (aggregated tables per dimension pair keep this from exploding)

-- GA4
Ga4LandingPageDay  propertyId, date, landingPath, channelGroup, sessions, users, engagedSessions,
                   conversions, revenue Decimal?, country, device

-- Crawler
CrawlRun           propertyId, status, limits used, counts, startedAt, finishedAt, error
CrawlPage          runId, url, status, redirectTo, canonical, metaRobots, title, description,
                   h1, h2Count, wordCount, contentHash, depth, responseMs, contentType,
                   hreflang Json, schemaTypes[], images, imagesMissingAlt, inSitemap, indexable
CrawlLink          runId, fromPageId, toUrl, toPageId?, anchor, rel, isInternal

-- Keywords / rankings / SERP
SeoKeyword         propertyId, keyword, countryId?, device, intent, tags, isTracked,
                   volume?, difficulty?, cpc Decimal? — each with its source
RankSnapshot       keywordId, date, position?, url?, source (GSC_AVG | <provider>), serpFeatures[]
SerpSnapshot       keywordId, date, provider, results Json (normalized), features[]
SeoCompetitor      propertyId, domain, name, countryId?, notes, isActive
CompetitorRank     competitorId, keywordId, date, position?, url?, source

-- Backlinks (provider only)
BacklinkSnapshot   propertyId, date, provider, referringDomains, backlinks
Backlink           propertyId, sourceUrl, targetUrl, anchor, rel, firstSeen, lastSeen, lostAt?, provider

-- Core Web Vitals
CwvSnapshot        propertyId, url?, date, formFactor, lcp, inp, cls, fcp, ttfb, source (CrUX)

-- Intelligence
SeoChangeEvent     propertyId, kind, metric, period, before, after, deltaPct, severity,
                   entityType, entityKey, source, range, detectedAt
SeoOpportunity     propertyId, type, ruleKey, fingerprint (unique per property — re-detection
                   updates, never duplicates), title, description, evidence Json, source,
                   severity, impact, effort, confidence, url?, keywordId?, recommendedAction,
                   status, assigneeId?, dueAt?, projectTaskId?, createdAt, resolvedAt
SeoThreshold       propertyId? (null = agency default), key, value
```

Numbers that come from a provider keep that provider's name beside them.
Numbers Emporia derives (health scores, opportunity priority) are labelled
"calculated" in the UI and documented with their formula.

---

## Part C — Provider layer

```
lib/seo-intel/providers/
  types.ts        SearchConsoleProvider, AnalyticsProvider, RankProvider,
                  SerpProvider, BacklinkProvider, PerformanceProvider
  gsc.ts          Search Console API (searchanalytics.query, urlInspection, sitemaps)
  ga4.ts          GA4 Data API (runReport)
  crux.ts         Chrome UX Report API (field Core Web Vitals) — free, API key
  unconfigured.ts every interface, throwing a typed "not configured" error
lib/seo-intel/normalize/   provider rows → internal shapes (pure, unit tested)
lib/seo-intel/engine/      rules: opportunities, change detection, indexation
                           classification, cannibalization, link graph (pure)
lib/seo-intel/crawler/     fetcher with SSRF guard, robots.txt, sitemap, parser
lib/services/seo-intel/*.service.ts   the AI-ready read boundary:
                           getSEOOverview, getTrafficDrops, getKeywordOpportunities,
                           getContentOpportunities, getCompetitorGap,
                           getTechnicalIssues, getConversionInsights, getSEOHistory
```

The engine never imports a provider. Providers never write the database.
Services orchestrate: provider → normalize → store → engine → store.

### Honest limits that shape the screens

- **Search Console** keeps 16 months and lags 2–3 days; "Today" shows the
  latest day Google has published, labelled with its date.
- **Index status per URL** comes only from the URL Inspection API (2,000
  inspections a day per property). The Page-indexing report itself is not in
  the API. Indexation therefore inspects a rotating, prioritised sample and
  says how many URLs it has inspected.
- **Rankings without a rank provider** are Search Console average positions
  per query — real data, labelled as such. Exact daily positions, competitor
  positions, search volume, difficulty and SERP features need a provider (D2).
- **Backlinks** exist only when a backlink provider is configured. No provider
  means the screen says so.
- **Core Web Vitals** come from CrUX field data, which exists only for URLs
  and origins with enough Chrome traffic. Small sites will often have none.

---

## Part D — Decisions (answered 2026-10-03)

- **D1. The agency's own website is a property** of an internal "Digi Emporia"
  client record (`Client.isInternal`), created when someone first adds the
  agency's own site. Tasks, projects and isolation then work exactly as for
  any client, and CMS content intelligence applies to that property only.
- **D2. No paid provider.** Rankings come from Search Console average
  positions, labelled as such. `RankProvider`, `SerpProvider` and
  `BacklinkProvider` are built as interfaces with an unconfigured
  implementation, so a provider can be added later without touching the
  engine — but until then exact daily positions, search volume, difficulty,
  CPC, SERP snapshots, competitor positions and backlinks show "not
  configured" rather than numbers. Competitor intelligence uses what is real
  without a provider: competitors' own sitemaps and pages (content gap, via
  the same crawler and its limits) and the keywords the client already gets
  impressions for.
- **D3. Both connection methods.** A property's GSC/GA4 connection is either
  OAuth (a Google user clicks Allow, through the existing Google app) or a
  service account (the agency's service-account email is added as a user in
  the client's GSC/GA4). One `SearchConsoleProvider` / `AnalyticsProvider`,
  two credential sources.
- **D4. Admin only for now.** Services are client-scoped from the start so
  the portal can follow without a rewrite.

---

## Part E — Phases

Each phase closes with typecheck, lint, tests, build, mutation checks, a
browser check and a report, then waits for the go-ahead.

| Phase | Delivers | Needs |
| ----- | -------- | ----- |
| 1 | `Country` (+ `City.countryId` backfill), `SeoProperty`, permissions, navigation, property CRUD, client/property selector, SSRF-safe URL validator | D1 |
| 2 | Google settings, GSC OAuth connect, sync runs (cron + manual), daily tables, Executive Overview with comparison periods | D3, a Google Cloud project with the Search Console API enabled |
| 3 | Crawler (robots, sitemap, limits, SSRF), Crawl Intelligence, Technical SEO, Indexation (crawl + sitemap + URL Inspection) | — |
| 4 | Keywords, rank snapshots (GSC average position; provider when D2 is configured), ranking movement and 4–10 / 11–20 opportunities | D2 for provider data |
| 5 | Content intelligence (decay, refresh, low CTR, high potential, potential cannibalization with evidence), internal link graph and suggestions | — |
| 6 | `SerpProvider`, SERP snapshots and diffs, competitors, keyword/content gap, SERP overlap | D2 |
| 7 | `BacklinkProvider`, snapshots, gained/lost, competitor link gap | D2 |
| 8 | Local SEO (country → region → city → service coverage, GBP reviews and velocity, NAP and local schema checks), international SEO (hreflang, canonical conflicts, country duplication) | — |
| 9 | GA4 connect and sync, organic → lead → opportunity → customer → revenue by keyword, page, country, city, service, campaign | Google Analytics Data API enabled |
| 10 | Opportunity engine, configurable thresholds, change detection jobs, Command Center, opportunity → `ProjectTask` | — |
| 11 | History charts, structured monthly report data, Core Web Vitals (CrUX), performance pass, full test sweep | CrUX API key |

### Risks

- **Volume.** GSC query × page × country × device is large. Stored as daily
  aggregates per dimension pair, pruned to 16 months, paginated server-side.
- **Crawling other people's servers.** Hard limits, robots.txt respected,
  public addresses only (DNS resolved and checked on every hop, redirects
  included), one crawl per property at a time.
- **Google verification.** A Google OAuth app reading Search Console and
  Analytics needs Google's verification for external users; until then it
  works for test users added in the Cloud console.
- **Cost.** Paid providers are per request. Tracked keywords and SERP checks
  are capped per property and the cap is visible in settings.

---

## Part F — Phase 1, as built

**Models** (migration `seo_property_country`, additive only): `Country` (ISO
code, created on first use), `City.countryId` (linked from the existing text by
`lib/geo/country-rows`, in `city.service` on every save and in the deploy-time
platform sync for existing rows; unknown names stay unlinked and are listed in
the sync log), `Client.isInternal`, `SeoProperty`.

**Countries** come from the runtime's CLDR data (`lib/geo/countries.ts`): 249
ISO 3166-1 countries plus Kosovo, with groupings, placeholders and deprecated
aliases excluded by an explicit list. No market is written into the code.

**Properties** (`lib/services/seo-intel/property.service.ts`): staff only;
the owner is fixed at creation; a project must belong to the same client; one
domain once per client (the same domain under two clients is allowed — each
keeps its own data); deleted clients' properties disappear from every read;
creates and edits are audited with before/after. The agency's own website goes
to the internal client, created on first use under an advisory lock so two
simultaneous adds cannot create two. The internal client is shown with an "Our
agency" badge in Clients and left out of the client counts on the dashboard,
Sales and Analytics.

**Safe targets** (`lib/seo-intel/net/`): `site-input.ts` is pure and shared
with forms — refuses IP literals (dotted, integer, hex, bracketed IPv6),
single-label and reserved names (`localhost`, `.local`, `.internal`,
`home.arpa`, `.test`…), credentials, non-default ports and non-http(s)
schemes. `safe-url.ts` is server-only — `isPublicAddress` blocks every RFC 6890
special-purpose range, IPv4-mapped and NAT64 forms included, and
`resolvePublicHost` refuses a name if *any* answer is non-public and returns
the addresses for the crawler to connect to (closing DNS rebinding in Phase 3).

**Permissions**: `seo.intelligence.view`, `.manage`, `.connect`,
`seo.opportunities.manage`, granted by the platform sync on deploy (ADMIN all;
MARKETING_MANAGER view/manage/opportunities; PROJECT_MANAGER view/opportunities).
A nav module now shows when any of its sub-sections is permitted, so a project
manager reaches Marketing → SEO Intelligence without holding popups.

**Screens**: Marketing → SEO Intelligence → Overview (property selector,
property details, data-source status — no figures until a source is connected)
and Websites (list with client/status/search filters, add, edit). Tabs appear
only for sections that exist.
