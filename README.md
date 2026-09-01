# Emporia

A digital marketing agency operating system: a public website fused with a CRM,
CMS, sales pipeline, project management, client portal and marketing analytics —
one platform on one database.

Read [`CLAUDE.md`](./CLAUDE.md) before changing anything. The delivery plan is
[`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md); the design and the reasoning behind
it are in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

**Status: Phase 2 (foundation) complete.** Schema, auth, RBAC, design tokens, UI
primitives, admin shell, audit trail and Docker files exist. The public website,
CRM, sales, projects, portal, media, email, finance, marketing, automation and
AI phases are not built yet.

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
npm run db:seed
```

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
