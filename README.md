# Emporia

A digital marketing agency operating system: a public website fused with a CRM,
CMS, sales pipeline, project management, client portal and marketing analytics —
one platform on one database.

Read [`CLAUDE.md`](./CLAUDE.md) before changing anything. The delivery plan is
[`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md); the design and the reasoning behind
it are in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

**Status: all 17 phases complete.** The foundation from Phase 2
(schema, auth, RBAC, design tokens, UI primitives, admin shell, audit trail,
Docker) plus the public marketing site: homepage, services, packages, case
studies, blog, CMS-driven pages, and a contact form that creates real CRM leads.
Plus the SEO engine: one metadata builder with the fallback chains, derived
canonicals, OG and Twitter cards, dynamic sitemap, robots, breadcrumbs and
JSON-LD, and DB-managed redirects with loop detection.

Plus local SEO: the City and Service x City CMS in admin, `/cities/[city]` and
`/services/[service]/[city]` routes, LocalBusiness schema, and a `canPublish()`
guard that refuses to publish a thin or templated local page.

Plus the package CMS with a package-to-proposal handoff, and a popup engine
whose targeting is resolved server-side, with submissions creating real CRM
leads carrying full UTM attribution.

Plus the CRM: lead list with server-side search, filters, sorting and
pagination, a kanban pipeline, configurable scoring, assignment with history,
and a complete activity timeline.

Plus sales: a reusable quoting catalog, opportunities, proposals with line
items, revisions and Decimal totals, the full proposal lifecycle, contracts with
numbering and renewal dates, and lead-to-client conversion on acceptance.

Plus delivery: projects with derived health, tasks with subtasks and
dependencies, milestones, comments, time tracking, a task board, a content
calendar across seven channels with the full workflow, and creative approvals
with version history.

Plus the client portal: a separate `/portal` surface with its own invitation
flow, where a client sees their projects, content, approvals, documents,
invoices, campaigns, files and a message thread — every query scoped by the
session's own client, proved by an isolation suite.

Plus the media library: presigned uploads straight from the browser to
Cloudflare R2, server-side content sniffing that refuses a spoofed extension,
folders, versioning, and a picker wired into approvals, content and contracts.

Plus email: one SMTP service, eleven editable templates, in-app notifications,
and a send log where every attempt — including every failure — is recorded and
retryable.

Plus finance: invoices with Decimal line maths shared with proposals, the
invoice lifecycle, manual and gateway payments, refunds, retainers that bill on
a cycle, and a Razorpay integration where the webhook — signature-checked
against the raw body, keyed on the gateway's own payment id — is the only thing
that marks an invoice paid.

Plus marketing analytics: campaigns with Decimal budgets and daily performance
that is typed in or imported from a platform export — never fabricated — and an
analytics dashboard that ranks sources, services, cities, campaigns, popups and
owners by the revenue they actually produced, with revenue withheld from roles
that hold no finance permission.

Plus automation: a `trigger → conditions → actions` engine whose rules live in
the database and are built, tried and switched on from admin with no deploy.
Every automated action is attributed to no user and written to the audit trail,
which is also what the run log reads back.

Plus AI assistance: one provider abstraction over Claude, with six assists —
lead summary, lead assessment, proposal narrative, content, SEO copy and a read
of the analytics figures. Every result is a labelled draft that writes nothing;
every figure the model may mention is handed to it from the database, and the
screens render those figures from our own data rather than from its prose.

Plus production hardening: a password reset flow, security headers, server-side
paging on every admin list, and an accessibility pass that took the whole app to
zero serious axe violations at AA.

Every phase in [`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md) is built.

Online payment is optional: with no `RAZORPAY_*` credentials the gateway is
simply absent, the portal shows no pay button, and payments are recorded by
hand. AI is optional in the same way: with no `AI_API_KEY` the assist buttons
are not rendered and the screens say why. Nothing is faked in either case.

---

## Requirements

- Node 22+
- PostgreSQL 16
- Docker (optional, for the containerised stack)

## Getting started

```bash
cp .env.example .env      # then fill in DATABASE_URL and AUTH_SECRET
npm install
npm run db:migrate        # apply migrations
npm run db:seed           # roles, permissions, super admin, lead sources
npm run db:seed:demo      # optional: demo content so the website has something to render
npm run dev
```

`AUTH_SECRET` must be at least 32 characters:

```bash
openssl rand -base64 32
```

The seed creates a super admin only if `SEED_SUPER_ADMIN_EMAIL` and
`SEED_SUPER_ADMIN_PASSWORD` are set. Credentials are never hardcoded, and the
seed is idempotent — re-running it will not duplicate anything.

Sign in at `/auth/login`, then `/admin`.

## Commands

```bash
npm run dev              # local dev server
npm run build            # prisma generate + next build
npm run start            # NOTE: use the standalone server instead, see below
npm run lint
npm run typecheck
npm run test             # vitest; integration tests need TEST_DATABASE_URL

npm run db:migrate       # prisma migrate dev
npm run db:deploy        # prisma migrate deploy (production)
npm run db:generate
npm run db:studio
npm run db:seed          # configuration: roles, permissions, super admin
npm run db:seed:demo     # demo website content — never run against production
```

`db:seed` and `db:seed:demo` are deliberately separate commands. `db:seed` is
configuration and is safe anywhere; `db:seed:demo` inserts sample services,
packages, case studies, blog posts and page content for development. Every demo
run records `demo.seededAt` in `SiteSetting` so the data can be identified and
removed later.

> `next start` does **not** work with `output: "standalone"`. To run a
> production build locally, copy the static assets next to the standalone server
> and run it directly:
>
> ```bash
> npm run build
> cp -r .next/static .next/standalone/.next/static
> cp -r public .next/standalone/
> node .next/standalone/server.js
> ```
>
> The Docker image does exactly this.

## Docker

```bash
docker compose up -d     # postgres + app
```

`POSTGRES_PASSWORD` and `DATABASE_URL` have no defaults — Compose refuses to
start without them. A fallback password here is one that reaches production
silently, and this file is also the reference for the Coolify deployment.

The entrypoint runs `prisma migrate deploy` before starting the server. Seeding
is deliberately **not** automatic, so a redeploy can never overwrite live data
with demo records — run `npm run db:seed` by hand:

```bash
docker compose exec app npm run db:seed
```

The runner image carries the full `node_modules` rather than a hand-picked
subset, because the Prisma CLI the entrypoint runs and the `tsx` the seed runs
are both devDependencies with large dependency closures. It costs about 2 GB of
image; the reasoning is in [docs/ARCHITECTURE.md §17.1](docs/ARCHITECTURE.md).

## Deploying

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — environment variables and
which of them fail loudly vs. quietly, the Coolify setup, first-boot seeding,
the provider-side configuration the app cannot do for you (R2 CORS, the Razorpay
webhook), running more than one instance, backups, rollback and migrations, and
troubleshooting.

## Testing

Unit tests run anywhere. The database integration tests need a **separate**
database so a test run cannot touch development data:

```bash
createdb emporia_test
# add TEST_DATABASE_URL=postgresql://.../emporia_test to .env
npm run test
```

The suite applies migrations and seeds that database itself before running.

## Notes for contributors

A few things that will bite you if you assume otherwise:

- **`prisma@latest` is a release candidate** (8.0.0-rc at time of writing).
  `prisma` and `@prisma/client` are pinned to exactly `7.10.0`. Do not run a
  bare `npm install prisma`.
- **Prisma 7 needs a driver adapter.** There is no query-engine binary; the
  client connects through `@prisma/adapter-pg`. The generated client is
  TypeScript in `generated/`, which is gitignored and rebuilt by `npm run build`.
- **Money is `Decimal`, never `number`.** All arithmetic goes through
  `lib/money`. Values crossing into a client component are converted with
  `toMoneyString` first.
- **`process.env` is read in exactly one place**, `lib/config/env.ts`. Env is
  validated at server boot by `instrumentation.ts`, not at import time, so
  `next build` stays hermetic — the container image is built without database
  credentials.
- **Rate limiting is shared, not in-process.** `checkRateLimit` is async and
  writes a `RateLimitWindow` row, so the limit holds across instances. It needs
  the database — do not call it from the edge.
- **Authorization is server-side, always.** `middleware.ts` only checks that a
  session token exists so the redirect gets a proper 307; it is not the security
  boundary. Every action, route handler and page re-checks its own permission.
- **Public routes that read the database are `force-dynamic`, with the data
  cached.** A static route that queries Postgres gets prerendered at build,
  which would make the container build need database credentials. The data layer
  in `lib/content/queries.ts` is wrapped in `unstable_cache` with tags instead,
  so publishing content can bust the cache immediately.
- **Cached queries must return serialisable values.** No `Decimal` and no `Date`
  crosses that boundary — money becomes a fixed 2dp string and dates become ISO
  strings, which is the rule for reaching a client component anyway.
- **Never give `Link` an object `href` with `typedRoutes`.** In the App Router
  an object href is formatted literally, so
  `{ pathname: "/services/[serviceSlug]", query: { serviceSlug } }` renders
  `/services/[serviceSlug]?serviceSlug=seo` — a link to a page that does not
  exist. Use a template literal: `` href={`/services/${slug}`} ``.
- **Do not add a `loading.tsx` above the public routes.** A loading boundary
  makes Next stream the shell before `notFound()` runs, so dead URLs answer 200
  with a skeleton instead of a real 404.
- **All page metadata goes through `lib/seo/metadata.ts`.** The title,
  description, canonical and OG image fallback chains live there once; a
  template that builds its own metadata object is a bug.
- **Redirects are served as 307/308, not 301/302.** Next's redirect primitives
  emit only the method-preserving equivalents. The stored intent is kept and
  exposed as `intendedStatus`; see `lib/services/redirect.service.ts`.
- **`publishPage()` is the only route to a published local page.** It calls
  `canPublish()`, which enforces word counts, a minimum of three local FAQs,
  local proof, complete metadata *and* near-duplicate detection against sibling
  cities for the same service. Setting `status` directly bypasses the rule the
  product exists to enforce — don't.
- **Demo local content must actually pass `canPublish()`.** The seed writes
  `status` directly because it is not a user; if the seeded copy drifts below a
  threshold you get published content that the product would refuse.
- **Every email attempt is logged, and a failed send never fails the work.**
  `sendTemplate` writes an EmailLog row before touching SMTP and updates it with
  the outcome; it returns a result rather than throwing, so capturing a lead or
  sending a proposal succeeds on its own terms. Failures are visible under
  Settings → Email, not swallowed.
- **Template values are HTML-escaped.** Templates are filled with data from the
  public internet — a lead's own message — so an unescaped substitution would
  put a stranger's markup in mail sent from our domain. The plain-text part is
  deliberately not escaped; markup is not interpreted there.
- **A template edit that uses an unknown variable is refused**, because it would
  otherwise send with `{{placeholder}}` still in it. The log keeps the values a
  message was rendered with, so a retry sends what was meant.
- **WhatsApp, SMS and push are refused, not stubbed.** `assertChannelAvailable`
  throws for them, so nobody builds a workflow on a channel that does not
  deliver.
- **Uploaded files are identified by their bytes, never their name.** The
  browser's `Content-Type` and the filename are claims; `lib/media/sniff.ts`
  checks the leading bytes of the object that actually landed, and a mismatch
  deletes it from the bucket and refuses. SVGs are additionally refused if they
  carry script or external references — an SVG is a document the browser
  executes.
- **Object keys are generated, never derived from a filename.** Random, date
  partitioned, and given the extension of the *verified* type — so
  `invoice.pdf.exe` cannot produce an `.exe` key, and a public URL leaks nothing
  about who uploaded what.
- **The upload intent is signed, not stored.** Between presign and confirm the
  server remembers the key, type, exact size and user by HMAC-ing them into an
  opaque id (`lib/media/intent.ts`), so confirm cannot be driven by a
  caller-supplied key and there is no pending-row table to sweep.
- **Browser uploads need CORS on the bucket.** R2 must allow PUT from the site's
  origin, or the presigned URL is refused by the browser before it reaches
  Cloudflare. Nothing in the app can detect that for you.
- **The portal never accepts a client id.** Every function in
  `lib/services/portal.service.ts` takes a `PortalActor` — whose `clientId` is
  non-nullable — and scopes on that. A record id from the browser is resolved
  together with the scope, so another client's row is a 404, not a 403 that
  confirms it exists. A staff actor cannot be passed in at all: the type is
  rejected at compile time.
- **Portal invitations are links, not emails.** There is no mail service until
  phase 12, so `invitePortalUser` returns a single-use link for a staff member
  to send. The token is cleared in the same update that sets the password, so a
  leaked link cannot be replayed.
- **Project health is derived, never typed in.** `lib/projects/health.ts`
  computes it from the project's own tasks, milestones and dates, and
  `recomputeHealth` runs after every change that could move it. A manager
  marking a late project "on track" would make the column worthless.
- **Time is entered in hours and stored in whole minutes.** The conversion goes
  through Decimal, not JS floats: `4.1 * 60` is `245.99999999999997`, and
  flooring that loses a minute from every entry. See `lib/projects/hours.ts`.
- **A content item takes its `clientId` from its project, never from the
  caller.** That denormalised column is what portal isolation filters on in
  phase 10, so it must not depend on a join being written correctly at every
  call site.
- **Money is priced once and stored, never recomputed on read.** A proposal
  keeps its own line totals, subtotal, discount, tax and total. Editing the
  catalog or the tax logic later must not move a figure a client has already
  been quoted, so `lib/money` computes at write time and the stored values are
  what is displayed.
- **Popup targeting is resolved on the server and the response carries at most
  one popup.** The client sends only its path; device, new-versus-returning,
  frequency state, schedule, rules and priority are all decided server-side. A
  client-side filter would leak every campaign and its targeting to anyone
  reading the network tab.
- **Frequency state lives in an httpOnly cookie**, not localStorage, so a
  visitor cannot clear a key to replay a once-per-user popup.
- **Attribution is never accepted from a request body.** UTM, referrer, device,
  service and city are derived from cookies, headers and the path. The capture
  schemas deliberately have no attribution fields at all.
- **Lead visibility is one function.** `visibilityFilter()` in
  `lib/services/crm.service.ts` returns a Prisma filter, and every lead read and
  write composes it. `leads.view` shows a user their own leads; `leads.view.team`
  shows everyone's. Never write a lead query that does not include it — a filter
  the caller supplies cannot widen it, and a foreign lead must stay
  indistinguishable from one that does not exist.
- **There is no `loading.tsx` above `/admin` or the public routes.** A loading
  boundary streams the shell before `notFound()` runs, so an unauthorised record
  would answer 200. No data leaks either way, but the status code matters.
- **Do not use `focus:outline-none` without an explicit `focus:ring`.** It
  suppresses the global `:focus-visible` outline and leaves only a border tint,
  which is not an adequate focus indicator.
