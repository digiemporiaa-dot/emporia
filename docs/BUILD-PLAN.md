# Build Plan

Sequenced delivery plan for the agency platform. Read `CLAUDE.md` first — the
rules there apply to every phase below.

Work **one phase at a time**. A phase closes only when typecheck, lint, tests
and `npm run build` all pass and the phase report has been posted.

---

## Phase 0 — Repository audit

**No code changes in this phase.**

Inspect and report on:

- `package.json` — dependencies, scripts, Next.js version
- Existing Prisma schema and migration state
- Database connection and current data
- Auth implementation, if any
- Existing routes, components, styling approach
- Existing API routes and server actions
- `.env` / `.env.example`
- Anything already working that must not be broken

**Output:** a written summary of what exists, what's reusable, what conflicts
with the target architecture, and what must be migrated rather than replaced.

---

## Phase 1 — Architecture plan

**Still no implementation.** Produce a concise plan covering:

- Current architecture vs proposed architecture
- Full Prisma schema outline (models, key relations, enums, indexes)
- Route map across website / admin / portal / api
- Service layer modules and their responsibilities
- Auth + RBAC design
- SEO and local SEO architecture
- CMS and CRM data flow
- Integration boundaries (R2, SMTP, Razorpay, AI)
- Risks, unknowns, and decisions needed from the user

Wait for approval before Phase 2.

---

## Phase 2 — Foundation

- Prisma schema + initial migration + Postgres running
- Prisma client singleton, seed script skeleton
- Auth.js with staff credentials, hashed passwords, sessions
- RBAC: roles, permissions, `requirePermission` / `requireOwnership` helpers
- Design tokens: CSS variables for color, type, spacing, radius, shadow, motion
- Base UI primitives (button, input, select, dialog, table, toast, card)
- Admin shell: navigation, layout, auth guard
- `loading.tsx` / `error.tsx` / `not-found.tsx` conventions
- Structured logging + audit log service
- Docker + docker-compose + `.dockerignore`

**Done when:** a seeded super admin can log in, reach an empty admin dashboard,
and a non-permitted role is rejected server-side.

---

## Phase 3 — Public website

- Homepage: hero, trust, positioning, services, results, featured work, process,
  industries, packages, testimonials, insights, final CTA
- About, Contact, Careers, Privacy Policy, Terms
- Services index and service detail (DB-driven)
- Packages index and detail with comparison UX
- Case studies index and detail
- Blog index and post
- Header, footer, navigation, mobile nav
- Framer Motion entrance + scroll reveal, reduced-motion respected

**Design bar:** each section has its own rhythm. Reject anything that reads as a
generic agency template. See the forbidden list in `CLAUDE.md` §6.

**Done when:** every route renders real DB content, is fully responsive with no
horizontal overflow, and passes a keyboard-navigation pass.

---

## Phase 4 — SEO engine

- `Seo` model + reusable relation across all indexable entities
- Centralised metadata builder with the fallback chains
- Canonical generation (auto, admin-overridable)
- OG + Twitter cards, including OG image alt text
- Dynamic sitemap (published only; admin/portal/auth/api/drafts excluded)
- robots.txt
- Breadcrumbs + `BreadcrumbList` schema
- Organization, WebSite, Service, Article, FAQ schema — only where supported
- Redirect management with loop detection
- Contextual internal linking

**Done when:** every public route has unique title, description and canonical,
and the sitemap contains no draft or private URL.

---

## Phase 5 — Local SEO

- `City` CMS: full CRUD, activation, ordering
- `ServiceCityPage` CMS with unique local content fields
- `/services/[service]/[city]` and `/cities/[city]` dynamic routes
- Local metadata, LocalBusiness schema, local FAQs, local case studies
- Related services and nearby cities linking
- `canPublish()` guard blocking thin pages from publishing

**Done when:** two service-city pages for the same service demonstrably differ
in substance, and an empty one refuses to leave DRAFT.

---

## Phase 6 — Packages + popups

- Package CMS: features, deliverables, billing type, Decimal pricing, tax
- Comparison UI, recommended package, custom-package CTA
- Package → proposal handoff
- Popup CMS: content, triggers, frequency, targeting, priority, scheduling
- Server-side targeting resolution
- Popup analytics: impressions, views, form starts, submissions, conversions
- Popup submissions creating real CRM leads with full attribution

**Done when:** a popup targeted at `/services/seo/gurgaon` fires only there, and
its submission appears in the CRM with popup, service, city and UTM attached.

---

## Phase 7 — CRM

- Lead model with full field set and attribution capture
- All lead sources, statuses, priorities
- Kanban pipeline with drag-to-move and status history
- Configurable lead scoring (budget, service, city, source, engagement)
- Assignment and reassignment with permission checks
- Activity timeline covering every tracked event
- Notes, tasks, follow-up scheduling
- Lead list with search, filters, sorting, server-side pagination

**Done when:** a website form submission flows to a scored, assigned lead with a
complete activity timeline, and a sales executive cannot see another rep's leads
without the team permission.

---

## Phase 8 — Sales

- Opportunities
- Reusable service/product catalog for quoting
- Proposals with items, revisions, Decimal totals, tax, discount
- Proposal lifecycle: DRAFT → SENT → VIEWED → NEGOTIATION → ACCEPTED/REJECTED
- Contracts: numbering, dates, value, terms, document, renewal, status
  (e-signature-ready interface, not implemented)
- Lead → Client conversion on WON

**Done when:** proposal totals are verifiably correct to the paisa under a
decimal test suite, and accepting a proposal creates a Client.

---

## Phase 9 — Projects

- Projects with client, service, manager, dates, Decimal budget, status, health
- Tasks, subtasks, assignments, due dates, priorities, dependencies
- Milestones, comments, attachments
- List / Kanban / Calendar views
- Time tracking
- Content calendar across Instagram, Facebook, LinkedIn, Blog, YouTube, Email,
  Ads with the full workflow states
- Creative approval with version history

**Done when:** a project can be run end to end internally and content moves
through every workflow stage.

---

## Phase 10 — Client portal

- `/portal` auth and layout, separate from admin
- Dashboard, projects, tasks, campaigns, reports, files, approvals, proposals,
  contracts, invoices, payments, messages, profile
- Every query scoped by session `clientId`

**Done when:** an isolation test suite proves a client cannot read another
client's records by any route, id or parameter manipulation.

---

## Phase 11 — Media

- R2 client, presigned upload flow, server-side validation
- Media library: drag/drop, multi-upload, progress, preview, search, filter
- Folders, rename, delete, copy URL, metadata, versioning
- Media picker component used across the CMS
- Permission-gated upload and delete

**Supported:** JPG, JPEG, PNG, WEBP, SVG, GIF, MP4, PDF, DOCX, XLSX.

**Done when:** an upload with a spoofed extension is rejected server-side.

---

## Phase 12 — Email

- `EmailService` over SMTP
- `EmailTemplate` + `EmailLog` models with admin editing
- Templates: NEW_LEAD, LEAD_ASSIGNED, FOLLOW_UP, STAFF_INVITATION,
  PASSWORD_RESET, PROPOSAL_SENT, PROPOSAL_ACCEPTED, INVOICE_SENT,
  PAYMENT_RECEIVED, PAYMENT_REMINDER, CLIENT_NOTIFICATION
- In-app + email notification system (WhatsApp/SMS/push architected only)

**Done when:** every send is logged with status, and failures are visible in
admin rather than silent.

---

## Phase 13 — Finance

- Invoices, invoice items, Decimal subtotal/discount/tax/total/paid/due
- Invoice statuses and overdue detection
- Payments and reconciliation
- Retainers with billing cycle, renewal date, renewal reminders
- `PaymentService`: `createOrder`, `verifyPayment`, `handleWebhook`, `refund`
- Razorpay webhook with signature verification and idempotency

**Done when:** invoice math passes a decimal test suite and a replayed webhook
does not double-credit a payment.

---

## Phase 14 — Marketing

- Campaigns with platform, Decimal budget, objective, owner, status
- Campaign metrics — entered or imported, **never fabricated**
- UTM tracking and first-touch / last-touch attribution
- Client reporting with adapter interfaces for Google Ads, Meta Ads, GA4,
  Search Console (interfaces now, integrations later)
- Analytics dashboard: leads, qualified, won, conversion rate, pipeline value,
  revenue, outstanding, active clients/projects, tasks due/overdue; breakdowns
  by source, city, service, popup, campaign, staff; revenue by service and city

**Done when:** the dashboard answers "which source produces the highest-value
leads" from real data, and shows empty state where data doesn't exist.

---

## Phase 15 — Automation

Simple, extensible `Trigger → Condition → Action` engine.

Ship at least:

- New lead → assign executive, create follow-up, send email, notify manager
- Proposal accepted → create client, create project, create onboarding tasks,
  notify PM, send welcome email

**Done when:** rules are editable in admin without a deploy, and every automated
action lands in the audit log.

---

## Phase 16 — AI

- `AIService` abstraction, provider-swappable
- Lead summarisation and scoring assistance
- Proposal, content and SEO drafting assistants
- CRM insights

All output editable, labelled as AI-generated, and barred from inventing
metrics.

---

## Phase 17 — Production hardening

Run and fix everything:

```
typecheck · lint · unit tests · integration tests · build
database validation · security review · SEO review
performance review · responsive review · accessibility review
```

Plus: verify Docker build, Coolify deployment config, `.env.example`
completeness, seed data clearly marked as demo, and that no credential is
hardcoded anywhere.

---

## Seed data

Roles: `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_EXECUTIVE`,
`MARKETING_MANAGER`, `CONTENT_MANAGER`, `PROJECT_MANAGER`, `STAFF` — with their
permission mappings.

Demo records (clearly flagged as demo): services, packages, cities,
service-city pages, leads, clients, projects, proposals, blog posts, case
studies, popups, testimonials.

Credentials come from environment variables. Never hardcoded.

---

## Phase report template

Post this at the end of every phase.

```markdown
## Phase N — <name>

### Implemented


### Architecture changes


### Files added


### Files modified


### Database changes


### Routes added


### Environment variables


### SEO changes


### Tests run


### Bugs fixed


### Known limitations


### Next phase

```
