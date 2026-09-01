# Emporia

A digital marketing agency operating system: a public website fused with a CRM,
CMS, sales pipeline, project management, client portal and marketing analytics —
one platform on one database.

Read [`CLAUDE.md`](./CLAUDE.md) before changing anything. The delivery plan is
[`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md); the design and the reasoning behind
it are in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

**Status: Phase 5 (local SEO) complete.** The foundation from Phase 2
(schema, auth, RBAC, design tokens, UI primitives, admin shell, audit trail,
Docker) plus the public marketing site: homepage, services, packages, case
studies, blog, CMS-driven pages, and a contact form that creates real CRM leads.
Plus the SEO engine: one metadata builder with the fallback chains, derived
canonicals, OG and Twitter cards, dynamic sitemap, robots, breadcrumbs and
JSON-LD, and DB-managed redirects with loop detection.

Plus local SEO: the City and Service x City CMS in admin, `/cities/[city]` and
`/services/[service]/[city]` routes, LocalBusiness schema, and a `canPublish()`
guard that refuses to publish a thin or templated local page.

Popups, CRM admin, sales, projects, portal, media, email, finance, marketing,
automation and AI phases are not built yet.

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

The entrypoint runs `prisma migrate deploy` before starting the server. Seeding
is deliberately **not** automatic, so a redeploy can never overwrite live data
with demo records — run `npm run db:seed` by hand.

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
