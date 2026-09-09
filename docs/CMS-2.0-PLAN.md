# CMS 2.0 — Audit and Implementation Plan

**Status: Phases 1 and 2 are built and merged. Phase 3 is next.**

| Phase | State |
|---|---|
| 1 — Content admin | **Done** — merged, 18 tests |
| 2 — Page builder upgrade | **Done** — merged, 17 tests |
| 3 — Block library, wave 1 | **Done** — merged, 45 tests |
| 4 — Dynamic block filtering + taxonomy | **Done** — merged, 13 tests |
| 5 — Version history and workflow | Next |
| 6–15 | Planned, below |

This is the deliverable of the mandatory audit step: a map of the CMS as it
actually exists today, an honest coverage matrix against the 26 requested
phases, the findings that change the shape of the work, and a proposed
sequence. It is written to be argued with. Nothing here is implemented until
it is approved.

---

## Part A — The CMS as it exists today

### A.1 The layers, and where CMS work lands in them

```
app/(website)/…                  public renderer      RSC, cached by tag
app/admin/website/…              the editor           RSC shell + client builder
  → app/admin/website/actions.ts server actions       zod, then hand off
    → lib/services/*.service.ts  business logic       requirePermission + audit
      → lib/db (Prisma)          data
lib/content/*                    block schemas, presentation tokens, queries
lib/seo/*                        metadata, schema.org, analyzer, urls
components/website/*             the block renderers
```

Every rule the master prompt states as non-negotiable is already the
established pattern here. Nothing in this plan needs to introduce a new one.

### A.2 Data model — 90 models, 44 enums

The CMS-relevant ones:

| Concern | Models |
|---|---|
| Pages | `Page`, `PageSection`, `ReusableSection` |
| Content entities | `BlogPost`, `BlogCategory`, `BlogTag`, `BlogPostTag`, `CaseStudy`, `CaseStudyMetric`, `Testimonial`, `FAQ`, `Service`, `ServicePackage`, `PackageFeature`, `City`, `ServiceCityPage` |
| SEO | `Seo` (one relation shared by 8 entity types), `Redirect` |
| Media | `Media`, `MediaFolder`, `MediaVersion` |
| Marketing | `Campaign`, `CampaignMetric`, `UTMTracking`, `Popup`, `PopupTarget`, `PopupAnalytics` |
| Platform | `SiteSetting`, `IntegrationSetting`, `AuditLog`, `Automation*` |

### A.3 The page builder

`lib/content/blocks.ts` (1,263 lines) declares **31 block types**, each a zod
schema with a label, defaults and validation:

> hero · heading · richText · image · imageBox · imageText · table · feature ·
> list · textList · icon · iconCards · imageCards · cta · faq · textImage ·
> benefits · logoGrid · fullWidthImage · featureCards · stats · testimonials ·
> clientStrip · serviceGrid · packageGrid · blogGrid · caseStudyGrid ·
> positioning · process · industries

`parseSections` validates every stored row before render and drops one that
does not match its schema, so bad CMS data degrades a single band rather than
the page. Content is stored **parsed**, so unknown keys are stripped.

Already present in the editor (`style-fields.tsx`, `lib/content/presentation.ts`,
`lib/content/grid.ts`):

- responsive column counts — desktop 1–6, tablet 1–4, mobile 1–2, mapped to
  **literal** Tailwind classes, never interpolated
- an 8-step spacing scale, container widths, alignment
- backgrounds (solid / gradient / image + overlay) with a `safeCssUrl` guard
- border, radius, tone, anchor IDs
- per-section hide/show that keeps the slot and the order
- drag-and-drop **and** Move up / Move down (keyboard path is mandatory here)

### A.4 What already covers requested phases

| Requested | State | Owned by |
|---|---|---|
| Dynamic content blocks | **Substantially exists** — `mode: latest / featured / manual`, limit, layout, per-block collection resolution, fetched only when used | `lib/content/collections.ts`, `components/website/collection-blocks.tsx` |
| Global / reusable sections | **Exists** — `ReusableSection` with `isGlobal`, publish-propagation in one transaction, snapshot on each placement so deletion degrades rather than blanks, `listUsages`, detach-to-local | `lib/services/reusable-section.service.ts` |
| SEO checks and scoring | **Exists** — weighted pass/warn/fail checks over a pure page snapshot, surfaced in the editor | `lib/seo/analyzer.ts`, `seo-panel.tsx` |
| Local SEO (Service × City) | **Exists** — dynamic route, `canPublish()` completeness guard, admin CRUD, local FAQs | `lib/services/serviceCityPage.service.ts` |
| Redirects + loop detection | **Exists** (engine) | `lib/services/redirect.service.ts` |
| Media library on R2 | **Exists** — presign/confirm, folders, versions, soft delete | `lib/services/media.service.ts` |
| AI abstraction | **Exists** — provider-swappable, admin-configured, `Draft<T>` wrapper, per-task budget | `lib/ai/*`, `lib/services/ai.service.ts` |
| Attribution → CRM → revenue | **Exists** — `UTMTracking` first/last touch on `Lead`, `landingPath`, campaign, through to `Invoice`/`Payment` | `middleware.ts`, `lib/services/analytics.service.ts` |
| RBAC / audit / zod | **Exists** — 99 permissions incl. `pages.*`, audit on every privileged mutation | `lib/auth/permissions.ts`, `lib/services/audit.service.ts` |
| Accessibility conventions | **Exists as practice** — focus traps, aria wiring, keyboard reorder | throughout |

---

## Part B — Findings that change the plan

### B.1 The blocking finding: most content types have no admin UI at all

There is **no write path anywhere in the application** for four of the content
types the plan is built on. Verified by searching every service for a
create/update against each model:

| Model | Admin UI | Service write path | Only writer today |
|---|---|---|---|
| `Service` | none | none | `prisma/seed-demo.ts` |
| `BlogPost` | none | none | `prisma/seed-demo.ts` |
| `CaseStudy` | none | none | `prisma/seed-demo.ts` |
| `Testimonial` | none | none | `prisma/seed-demo.ts` |
| `FAQ` | inside service-city pages only | partial | `serviceCityPage.service.ts` |
| `City`, `ServicePackage`, `ServiceCityPage`, `Page` | full | full | admin |

The models exist. The public pages render them. The dynamic CMS blocks query
them. `canPublish()` for a local page requires them. But **an agency using
Emporia today cannot publish a blog post, add a case study, or record a
testimonial** — the only way content of those types has ever entered the
database is the demo seed, which must never be run against production.

This has a direct consequence for work already shipped: the `blogGrid`,
`caseStudyGrid` and `testimonials` bands on the starter homepage will render
nothing on a real install, permanently, and no amount of CMS 2.0 changes that.

It also precedes most of the requested phases. Templates, taxonomy, dynamic
filtering, CMS search, bulk operations, import/export, workflow, versioning and
per-page analytics are all operations *on content that cannot currently be
created*. Building them first would be building the second floor.

**Recommendation: this becomes Phase 1, ahead of the page-builder upgrade.**

### B.2 There is no page-view store, so "page views" cannot be honest yet

Analytics today is derived entirely from CRM and finance rows — leads,
pipeline, invoices, payments, plus the popup funnel and campaign performance.
`PopupAnalytics` is the only first-party event table, and it records popup
events, not page views. GA4 and the other tags are **client-side only**; no
server ever reads them back.

So of the metrics requested for the per-page performance view:

| Metric | Available today |
|---|---|
| Leads, qualified, opportunities, customers, attributed revenue | **Yes** — via `Lead.landingPath` + first/last touch UTM through to `Payment` |
| Form starts / submissions, CTA clicks | **Only where a popup was involved** |
| Page views, unique visitors | **No source at all** |

Showing a zero would be fabricating a metric, which CLAUDE.md 2 rule 5 forbids
and the master prompt repeats. Three honest options, in B.5.

### B.3 There is no scheduler

The automation engine is post-commit and event-driven: `runAutomations` is
called after the mutation it reacts to. Nothing in the repository runs on a
clock — no cron route, no queue, no scheduled job. Scheduling (`publishAt` /
`unpublishAt`) therefore needs an entry point that does not exist yet.

### B.4 The Embed block is in tension with two deliberate decisions

Rich text here is markdown-lite parsed to React elements. **Nothing in the
render path reaches `dangerouslySetInnerHTML`**, which is why there is no
sanitiser to keep current and no stored-XSS surface. The CSP is enumerated
per provider in `next.config.ts` with `object-src 'none'` and no `unsafe-eval`
in production.

A general "paste any embed code" block breaks both. The plan proposes an
allow-listed provider embed instead (YouTube, Vimeo, Google Maps, Calendly),
where the editor supplies an ID or URL and the block builds the iframe.

### B.5 Scope

The master prompt is 26 phases. Honestly sized against this codebase's quality
bar — service layer, zod, RBAC, audit, tests, accessibility, docs — it is
several months of work, not one pass. It also arrived truncated mid-sentence in
section 33 ("Only create models that the existi…"), so the database-design
constraints at the end are incomplete.

The sequence below is ordered by *what unblocks what*, not by the prompt's
numbering.

---

## Part C — Proposed sequence

Each phase closes with typecheck, lint, tests and build green, plus the phase
report from `docs/BUILD-PLAN.md`. Each is independently shippable.

### Phase 1 — Content admin (unblocks everything else) — **DONE**
Admin CRUD for `Service`, `BlogPost`, `CaseStudy` (+ metrics), `Testimonial`,
and standalone `FAQ`. Reuses the existing list/detail/form patterns from
`catalog/packages`, the shared `Seo` relation, the media picker, `content.*` and
`catalog.*` permissions, audit and cache tags. **No new models.**

### Phase 2 — Page builder upgrade — **DONE**
Per-breakpoint visibility and alignment/spacing overrides with
desktop → tablet → mobile inheritance; a device preview toolbar; a `version`
field on block content plus a migration hook so future schema changes cannot
break stored pages; unsaved-changes warning. Columns/nesting assessed against
the current flat `PageSection` model before committing to it.

### Phase 3 — Block library, wave 1 (conversion and trust) — **DONE**
Lead form, contact form, newsletter, sticky CTA, WhatsApp CTA, team, gallery,
video (allow-listed), tabs, accordion, timeline, pricing table, comparison
table. Built on shared primitives, not 13 bespoke components. Forms route
through the **existing** lead capture path so attribution is captured once.

### Phase 4 — Dynamic block filtering + taxonomy — **DONE**
Category / tag / service / city / industry / rating filters and sort on the
collection blocks. Reuses `BlogCategory`, `BlogTag`, `Tag`, `Service`, `City`;
adds `Industry` only if Phase 1 shows it is genuinely a separate entity.

### Phase 5 — Version history and workflow
`PageVersion` (snapshot, author, timestamp, reason) with view / compare /
restore / draft-from-version. Workflow states extending `PublishStatus`
(IN_REVIEW, CHANGES_REQUESTED, APPROVED), permission-gated transitions, every
transition audited. Precedent: `ApprovalVersion`, `ProposalRevision`.

### Phase 6 — Scheduling
`publishAt` / `unpublishAt` plus one `/api/cron` route, secret-authenticated,
driven by a Coolify scheduled job — the smallest thing that fits (decision D2).
Explicit UTC storage, rendered in the operator's timezone.

### Phase 7 — Media 2.0
Extends the existing library: tags, caption/title/description, focal point,
**usage tracking** across pages, blocks and entities, orphan detection,
replace-in-place, and a delete guard that shows usage count first.

### Phase 8 — SEO 2.0
Extends `lib/seo/analyzer.ts`: target keyword, keyword presence and density,
H2 structure, internal/external link checks, image alt. Adds internal-link
suggestions — **surfaced as suggestions, never auto-applied** — plus the
redirect admin UI that the engine has been missing.

### Phase 9 — CMS search and bulk operations
Server-side, paginated, filtered global search across pages and every content
type. Bulk publish / unpublish / archive / tag, permission-checked, audited,
with per-record validation and clear partial-failure reporting.

### Phase 10 — Templates
Page templates defining default sections, allowed sections and default SEO
shape. Deliberately after the block library, so templates are assembled from
blocks that exist.

### Phase 11 — Page analytics and content → revenue
Per-page rollup on `Lead.landingPath` through opportunity, client and payment.
Traffic metrics per decision D1; anything unavailable renders
**"Not connected"**, never a zero.

### Phase 12 — Personalization
Rules modelled directly on `PopupTarget` + `resolveForPage` — the same
server-side, deterministic, inspectable shape, evaluated before render.
"Preview as a Gurgaon visitor" mode. No sensitive attributes.

### Phase 13 — Experiments
Deterministic variant assignment, conversion tracked through the existing CRM
join. **No winner declared without a defensible sample**; the UI shows sample
size and refuses a verdict below threshold rather than guessing.

### Phase 14 — AI CMS assistant
On the existing `AIService`: page generation into real block JSON, per-field
rewrite / shorten / expand / tone, headline, CTA, FAQ, meta title/description,
internal-link suggestions, translation. Everything returns `Draft<T>`, is
labelled AI-generated, and requires human approval — the existing contract,
extended, not replaced. AI quality checks fold into the analyzer from Phase 8.

### Phase 15 — Import / export
CSV upload → validate → preview → show errors → confirm → transactional import,
for blog posts, services, locations, FAQs and testimonials.

Accessibility (23), performance (24), security (25) and admin UX (26) are not
phases. They are acceptance criteria applied to every phase above.

---

## Part D — Decisions needed before Phase 1

**D1 — Traffic metrics.** Which?
- **(a) First-party pageview store** — one lightweight event table plus an
  ingest route. Full control, correct attribution joins, no third party. Cost:
  a new write path on every public request, and bot filtering to get right.
- **(b) GA4 Data API** — read back what the existing GA4 tag already collects.
  No new write path. Cost: a Google service-account credential, an API
  dependency, and numbers that will not reconcile exactly with CRM rows.
- **(c) Neither for now** — ship the CRM-derived half of the page report
  (leads → qualified → customers → revenue, which is the half that matters
  commercially) and render traffic as "Not connected".

*My recommendation: (c) now, (a) as its own phase later.*

**D2 — Scheduler.** Confirm `/api/cron` + a Coolify scheduled job hitting it
with a shared secret. It is the smallest addition that fits, and it needs one
setting in your Coolify project.

**D3 — Embeds.** Confirm allow-listed provider embeds (YouTube, Vimeo, Google
Maps, Calendly) rather than arbitrary embed code. Arbitrary embeds mean
widening the CSP and accepting a stored-XSS surface the codebase currently does
not have.

**D4 — Order.** Confirm Phase 1 is content admin rather than the page-builder
upgrade the prompt puts first. My argument is in B.1: the blog, case-study and
testimonial blocks are already shipping with nothing behind them.

**D5 — Batch size.** How many phases per approval round? I would propose
Phase 1 alone first, so you can see the shape before committing to the rest.

**D6 — The truncated section 33.** Your prompt cut off at "Only create models
that the existi…". If there were further constraints on database design, send
them — Part C's model additions (`PageVersion`, personalization rules,
experiments) are the parts most likely to be affected.
