# CLAUDE.md

Project context for Claude Code. Read this fully before touching code. These are
standing rules, not suggestions — they apply to every task in this repo.

---

## 1. What we are building

A **digital marketing agency operating system**: a premium public website fused
with a real CRM, CMS, sales pipeline, project management, client portal and
marketing analytics. One connected platform sharing one database — not a
marketing site with an unrelated admin bolted on.

The spine of the product, end to end:

```
SEO / Ads / Social
  → Service, City or Service-City page
  → CTA or Popup
  → Lead (with UTM + attribution captured)
  → Lead scoring + assignment
  → CRM pipeline
  → Proposal → Contract → Client
  → Project + Campaign
  → Client approval + Reporting
  → Invoice → Payment → Retainer / Renewal
```

Every arrow above must be a real foreign key relationship, not a screenshot.

**This is a production build.** Not a prototype, not a UI mock. If a feature
cannot be built for real in the current phase, leave it unimplemented and say so
in the phase report — do not stub it with fake data and call it done.

---

## 2. Non-negotiables

Violating any of these means the work is rejected regardless of how good the
rest looks.

| # | Rule |
|---|------|
| 1 | **Money is `Decimal`.** Prisma `Decimal` + decimal.js operations. Never JS `number` for prices, budgets, discounts, tax, invoices, payments, revenue, ad spend, proposal values. |
| 2 | **Authorization is server-side.** Every server action and route handler checks session + permission before doing work. Hiding a button is not authorization. |
| 3 | **Client data isolation.** A portal user can never read another client's projects, files, invoices, payments, campaigns, reports or messages. Enforced in the service/query layer, scoped by `clientId` from the session — never by a client-supplied id. |
| 4 | **Zod on every input.** All server actions and route handlers validate input before use. |
| 5 | **No fakes.** No fake CRM, fake analytics, fake payment success, fake uploads, fake SMTP, fake auth, fabricated campaign metrics. Empty state beats invented data. |
| 6 | **No secrets client-side.** DB creds, auth secrets, SMTP, R2, Razorpay, Shiprocket, AI keys stay server-only. Never `NEXT_PUBLIC_` them. |
| 7 | **No thin city pages.** A Service-City page without genuine unique content stays `DRAFT` or `noindex`. Never mass-publish templated content with the city name swapped. |
| 8 | **Server Components by default.** `"use client"` only where interactivity genuinely requires it, as low in the tree as possible. |
| 9 | **Strict TypeScript.** No `any` without a written justification comment. Type errors and build errors are blockers, never "known limitations". |
| 10 | **Don't destroy working code.** Audit before you change. Migrate, don't bulldoze. |

---

## 3. Tech stack

**Frontend** — Next.js 15 (App Router), React Server Components, TypeScript,
Tailwind CSS, Framer Motion, Lucide React.

**Backend** — Server Actions (route handlers only for webhooks, uploads, cron,
sitemap/robots), Prisma ORM, PostgreSQL, Zod.

**Auth** — Auth.js (NextAuth v5). Staff email + password, hashed with argon2 or
bcrypt. Session-based. RBAC on top. Customer phone OTP and WhatsApp auth are
*architected for* but **not implemented** until asked.

**Storage** — Cloudflare R2 (S3-compatible) via presigned URLs. File metadata in
Postgres. The app server filesystem is never permanent storage.

**Email** — SMTP through one reusable `EmailService`. Templates in DB, every
send logged.

**Payments** — Razorpay, behind a `PaymentService` interface.

**Shipping** — Shiprocket-ready interface only.

**Deploy** — Docker + docker-compose, targeting Coolify, with Postgres.

---

## 4. Layer discipline

Every write follows this path. Do not skip layers, do not put business logic in
components.

```
UI (RSC / Client Component)
  → Server Action or Route Handler
    → Zod validation
      → Authorization check (session + permission + ownership)
        → Service function  ← all business logic lives here
          → Prisma
            → PostgreSQL
```

- Services are pure-ish, testable, and framework-agnostic where possible.
- A service function never trusts its caller for identity — it receives an
  authenticated actor and re-checks ownership.
- Shared logic (lead scoring, proposal totals, invoice math, SEO fallbacks,
  popup targeting) exists in exactly one place.

---

## 5. Repo architecture

```
app/
├── (website)/          # public marketing site
│   ├── page.tsx
│   ├── about/
│   ├── services/[serviceSlug]/[citySlug]/
│   ├── cities/[citySlug]/
│   ├── packages/[packageSlug]/
│   ├── case-studies/[slug]/
│   ├── blog/[slug]/
│   ├── contact/ careers/ privacy-policy/ terms-and-conditions/
│   └── [...landingPage]/   # CMS-driven landing pages (last resort match)
├── admin/              # staff operating system
├── portal/             # client-facing portal
├── auth/
└── api/                # webhooks, presigned uploads, sitemap, robots, cron

lib/
├── auth/               # session, rbac, permission helpers
├── db/                 # prisma client singleton
├── services/           # business logic, one module per domain
├── validation/         # zod schemas, shared between client + server
├── seo/                # metadata builders, canonical, schema.org
├── email/  storage/  payments/  ai/   # provider-abstracted integrations
└── utils/

components/
├── ui/                 # primitives
├── website/  admin/  portal/
prisma/
├── schema.prisma  migrations/  seed.ts
```

Route groups keep the three surfaces (website / admin / portal) visually and
structurally separate. They share services, not components.

---

## 6. Design system

### Brand colors (mandatory)

```
--brand-red:   #DF1F38    CTAs, accents, active states, key metrics, hover
--brand-navy:  #002A3A    dark backgrounds, nav, footer, headings on light
--white:       #FFFFFF    light canvas, cards, text on dark, negative space
```

Derive neutrals as CSS variables — muted navy, soft gray, light gray, border
gray, dark text, muted text. **No colors outside this system.**

Red is an accent, not a background. If a section is mostly red, it's wrong.

### Tokens

Everything themeable lives in CSS variables: colors, type scale, spacing,
radius, shadows, motion durations and easings, container widths, breakpoints.
Rebranding should mean editing one token file.

### Typography

Premium modern sans-serif. A display face for headlines, a highly readable face
for body. Large hero type. Responsive scaling with `clamp()`. Typography carries
the identity — treat it as a primary design element, not an afterthought.

### Motion

Framer Motion, used selectively: hero entrance, scroll reveal, number counters,
image reveals, hover states, magnetic CTAs, page transitions. Motion signals
hierarchy and interactivity. Everything must respect `prefers-reduced-motion`.

### Visual direction

Futuristic, premium, editorial, technology-driven, conversion-focused. Strong
typography, asymmetric grids, layered composition, data-inspired graphics,
subtle depth, considered whitespace. Each section gets its own rhythm.

### Explicitly forbidden

Generic SaaS layouts. Template agency hero. Endless identical card grids. Heavy
glassmorphism. Neon. Random gradients. Glowing blobs. Red everywhere. Stock
photography clichés. Everything rounded. Animating everything. Visual noise.

### Admin UI

Deliberately different from the public site: dense, professional, fast. Data
tables, charts, filters, command palette, keyboard shortcuts. Navy navigation,
red as accent only. Desktop-first, tablet-compatible, mobile-usable.

---

## 7. Data model

Group the schema by domain. Minimum entities:

**Identity** — `User`, `Role`, `Permission`, `RolePermission`, `Department`

**CRM** — `Lead`, `LeadSource`, `LeadActivity`, `LeadNote`, `LeadTask`,
`LeadAssignment`, `LeadTag`, `Tag`

**Content / Local SEO** — `Service`, `City`, `ServiceCityPage`, `Page`,
`PageSection`, `BlogPost`, `BlogCategory`, `BlogTag`, `CaseStudy`,
`CaseStudyMetric`, `Testimonial`, `FAQ`

**Commercial** — `ServicePackage`, `PackageFeature`, `Opportunity`, `Proposal`,
`ProposalItem`, `ProposalRevision`, `Contract`, `Client`, `ClientContact`

**Delivery** — `Project`, `ProjectTask`, `ProjectMilestone`, `TimeEntry`,
`ContentCalendarItem`, `Approval`, `ApprovalVersion`

**Marketing** — `Campaign`, `CampaignMetric`, `UTMTracking`, `Popup`,
`PopupTarget`, `PopupAnalytics`

**Finance** — `Invoice`, `InvoiceItem`, `Payment`, `Retainer`

**Platform** — `Media`, `MediaFolder`, `MediaVersion`, `EmailTemplate`,
`EmailLog`, `Notification`, `Automation`, `AutomationTrigger`,
`AutomationCondition`, `AutomationAction`, `AuditLog`, `Seo`, `Redirect`,
`SiteSetting`, `IntegrationSetting`

Rules: enums over strings for fixed sets; indexes on every foreign key and every
column you filter or sort on; unique constraints on all slugs and on
`(serviceId, cityId)`; explicit cascade behaviour; soft delete where history
matters (leads, clients, invoices, media).

### Key enums

```
LeadStatus     NEW CONTACTED QUALIFIED PROPOSAL NEGOTIATION WON LOST NURTURE
Priority       LOW MEDIUM HIGH URGENT
ProposalStatus DRAFT SENT VIEWED NEGOTIATION ACCEPTED REJECTED
ContractStatus DRAFT SENT SIGNED ACTIVE EXPIRED TERMINATED
ProjectStatus  PLANNING ACTIVE ON_HOLD COMPLETED CANCELLED
ProjectHealth  ON_TRACK AT_RISK DELAYED
InvoiceStatus  DRAFT SENT PARTIALLY_PAID PAID OVERDUE CANCELLED
ContentStage   IDEA DRAFT INTERNAL_REVIEW CLIENT_REVIEW APPROVED SCHEDULED PUBLISHED
PublishStatus  DRAFT PUBLISHED ARCHIVED
```

---

## 8. RBAC

Roles: `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`,
`MARKETING_MANAGER`, `CONTENT_MANAGER`, `PROJECT_MANAGER`, `STAFF`.

Permissions are granular strings in `resource.action` form —
`leads.view`, `leads.assign`, `proposals.send`, `invoices.create`,
`media.delete`, `settings.edit`, and so on. Roles map to permission sets in the
database, so permissions can change without a deploy.

Every protected operation calls a single helper:

```ts
await requirePermission("leads.assign")        // throws if denied
await requireOwnership(client.id, session)     // portal scoping
```

Sales executives see their own leads unless they hold a team-wide permission.
`SUPER_ADMIN` bypasses checks; nothing else does.

---

## 9. SEO

SEO is a first-class feature, not decoration.

**Every indexable entity** carries meta title, meta description, canonical, OG
title/description/image/**image alt**, Twitter title/description/image, robots
index, robots follow, and schema type — via one reusable `Seo` relation shared
by pages, services, cities, service-city pages, packages, case studies, blog
posts and landing pages.

**Fallback chains** are centralised, never duplicated per template:

```
title:    page SEO → generated from entity → site default
og:image: page OG → service/city OG → global OG
canonical: always derived from the public URL; admin can override
```

**Implement:** dynamic `generateMetadata`, dynamic sitemap (published records
only, excluding `/admin`, `/portal`, `/auth`, `/api` and drafts), robots,
breadcrumbs with `BreadcrumbList` schema, and Organization / WebSite / Service /
LocalBusiness / Article / FAQ schema — **only where the page genuinely contains
that content.**

**Redirects** are managed in the DB (old URL, new URL, 301/302/307/308, active)
with loop detection at write time.

**Internal linking** is contextual and derived from relationships — a service
links to its cities, case studies, related services and blog posts. No
site-wide link dumps.

### Local SEO — the hard rule

`Service × City = ServiceCityPage`, generated dynamically from the database.
Never hand-write hundreds of React pages.

Each combination must support genuinely unique local intro, market context,
industries, case studies, testimonials, FAQs, positioning, CTA and metadata. A
page lacking that content is not publishable. Enforce this — a `canPublish()`
check in the service layer, not a note in the docs.

---

## 10. Popups and lead capture

CMS-driven popup engine. Admin defines content, CTA, form, trigger
(`PAGE_LOAD`, `TIME_DELAY`, `SCROLL_PERCENT`, `EXIT_INTENT`, `BUTTON_CLICK`),
frequency (`EVERY_VISIT`, `ONCE_PER_SESSION`, `ONCE_PER_DAY`, `ONCE_PER_WEEK`,
`ONCE_PER_USER`), targeting (page, service, city, package, new vs returning,
device) and priority.

Targeting resolution runs **server-side**; the client receives only the popup it
should see. Track impressions, views, form starts, submissions, conversions —
and attribute each to popup, page, service, city, campaign and UTM so it lands
in CRM analytics.

Every lead-capturing form records, where available: UTM source/medium/campaign/
term/content, landing page, referrer, device, popup, service, city.

Popups must be accessible: focus trap, `Esc` to close, restored focus,
`role="dialog"`, `aria-modal`.

---

## 11. Security

- Sessions: httpOnly, secure, sameSite cookies.
- Passwords: argon2/bcrypt, never logged, never returned.
- Rate limiting on auth, contact forms, popup submissions, password reset.
- Uploads: validate server-side. Never trust extension, client MIME or
  filename. Enforce size caps, sniff MIME, generate opaque object keys, require
  auth for presigning.
- Razorpay: verify webhook signatures, handle idempotency keys, reconcile
  payment status server-side. A client-side "success" callback never marks an
  invoice paid.
- Audit log every privileged mutation: actor, action, entity, before/after,
  IP, timestamp.
- Never surface raw stack traces to users.

---

## 12. Quality bar

**Performance** — RSC by default, static generation + revalidation for SEO
pages, DB indexes, server-side pagination and filtering (never load a full table
into the browser), `next/image`, lazy loading below the fold.

**Accessibility** — semantic HTML, keyboard navigation, visible focus states,
labelled forms, accessible dialogs, AA contrast, reduced-motion support.

**Error handling** — `loading.tsx`, `error.tsx`, `not-found.tsx` per route
segment. Skeletons, empty states, toasts, confirmation dialogs, inline
validation.

**Responsive** — public site mobile-first through large desktop; admin
desktop-first, tablet-compatible, mobile-usable. Zero horizontal overflow at any
width.

**Tests** — cover auth, RBAC, lead creation/assignment/status/scoring, proposal
and invoice decimal math, payment verification, media permissions, client
isolation, popup targeting, SEO metadata and canonical generation, sitemap,
robots, redirects.

---

## 13. Commands

Verify these against `package.json` during the audit and correct this section if
they differ.

```bash
npm run dev              # local dev
npm run build            # production build — must pass before any phase closes
npm run lint
npm run typecheck
npm run test

npx prisma migrate dev --name <name>
npx prisma generate
npx prisma studio
npm run db:seed

docker compose up -d     # local postgres + app
```

---

## 14. Environment

Maintain `.env.example` with every key, no real values, ever committed.

```env
DATABASE_URL=
AUTH_SECRET=
NEXTAUTH_URL=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

SHIPROCKET_EMAIL=
SHIPROCKET_PASSWORD=

AI_PROVIDER=
AI_API_KEY=
```

---

## 15. How to work in this repo

1. **Audit before building.** Read the existing code — `package.json`, Next
   version, Prisma schema, auth setup, existing routes, components, styling,
   API. Report what exists before proposing changes.
2. **Plan before coding.** For anything larger than a bug fix, write the plan
   first: models, routes, services, risks. Get confirmation.
3. **Work one phase at a time.** See `docs/BUILD-PLAN.md`. Don't generate
   hundreds of files in one pass.
4. **Close each phase properly.** Typecheck, lint, tests and build must pass.
   Then post the phase report (template in the build plan).
5. **Flag, don't fake.** Blocked on a credential, an API or an unclear
   requirement? Say so and leave it unimplemented. Never paper over it.
6. **Ask when the spec is ambiguous** rather than guessing at business rules —
   especially around money, permissions and client isolation.

---

## 16. AI features

All AI access goes through one `AIService` abstraction — `summarizeLead`,
`scoreLead`, `generateProposal`, `generateContent`, `generateSEOContent`,
`analyzeCRM`. Provider-swappable, never coupled to a single vendor.

AI output is always a draft: editable, clearly marked as AI-generated, and never
permitted to invent business metrics. Campaign numbers come from the database or
they don't appear.
