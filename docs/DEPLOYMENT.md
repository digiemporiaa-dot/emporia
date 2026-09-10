# Deployment

How to run Emporia in production. The target is **Coolify** fronting a single
container, with PostgreSQL alongside it; the same image runs anywhere that can
run a container and hand it a `DATABASE_URL`.

Architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md) §17.
Development setup lives in the [README](../README.md). This file is the
operator's copy: what to set, in what order, and what breaks if you don't.

---

## 1. What you are deploying

```
        internet
           │  TLS terminated by Coolify's proxy
           ▼
   ┌───────────────┐        ┌──────────────┐
   │  emporia app  │───────▶│  PostgreSQL  │
   │  (container)  │        │      16      │
   └───────┬───────┘        └──────────────┘
           │
           ├──▶ Cloudflare R2      (media, direct browser upload)
           ├──▶ SMTP               (all outbound mail)
           ├──▶ Razorpay           (checkout + webhook)
           └──▶ Anthropic          (AI drafting, optional)
```

One process, one database. Three properties matter operationally:

- **The container is disposable.** Nothing is written to its filesystem that
  needs to survive. Uploads go to R2. No volume is mounted into the app, and
  none should be.
- **Sessions are JWTs.** No server-side session store, so no sticky sessions
  and no shared cache to stand up.
- **All shared state is in Postgres** — including rate-limit windows, which
  used to be in process memory. See [§7 Running more than one instance](#7-running-more-than-one-instance).

---

## 2. Prerequisites

| Thing        | Version / note                                         |
| ------------ | ------------------------------------------------------ |
| Coolify      | any recent version, with a server attached             |
| PostgreSQL   | 16                                                     |
| Domain       | pointed at the Coolify server, TLS issued by its proxy |
| Docker build | performed by Coolify from this repo's `Dockerfile`     |

The image builds on `node:22-bookworm-slim`. Alpine is deliberately not used:
`argon2` ships glibc prebuilds and rebuilds from source on musl, which turns a
routine deploy into an intermittent build failure.

**The build is hermetic.** `next build` runs with no database and no secrets —
do not give the builder production credentials, and do not add a build-time
`DATABASE_URL` to "fix" a build error. If a build starts needing the database,
a route that reads Postgres has lost its `force-dynamic` and is being
prerendered; fix the route, not the build environment.

---

## 3. Environment variables

Every key the application reads is listed in [`.env.example`](../.env.example).
`lib/config/env.ts` is the only module that touches `process.env`, and it
validates the whole set at boot.

### Required

Two of these stop the container at boot if they are missing. The other two do
not — and that is worth knowing, because their failure mode is quieter.

| Key                            | Notes                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | `postgresql://user:password@host:5432/emporia` — **boot fails without it**                                                                                                                          |
| `AUTH_SECRET`                  | **at least 32 characters**, `openssl rand -base64 32` — **boot fails without it**                                                                                                                   |
| `SITE_URL`                     | public origin, e.g. `https://emporia.example`. Defaults to `http://localhost:3000`, so an unset value boots happily and emits **canonical URLs and sitemap entries pointing at localhost**. Set it. |
| `AUTH_URL` _or_ `NEXTAUTH_URL` | same origin. Optional in the schema because `trustHost` is on and the origin is derived from the request; set one anyway so callback URLs do not depend on a proxy header being right.              |

`NODE_ENV=production` is baked into the image; you do not need to set it, and
setting it to anything else in production will hand out non-`__Secure-` session
cookies.

A missing or malformed required key **kills the container at boot** with a
readable list of what is wrong — by design (`instrumentation.ts`). A container
that restart-loops immediately after a config change is telling you which key
you got wrong; read the first ten lines of its log.

### Optional — each one switches a feature on

Absent means _not configured_, and the app says so rather than pretending.
An unconfigured integration raises a typed `IntegrationNotConfiguredError` and
the screen explains what is missing. Nothing is faked, ever.

| Group      | Keys                                                                                       | Off means                                                        |
| ---------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Email      | `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `SMTP_FROM` `SMTP_SECURE`              | no mail sends; attempts are still logged                         |
| Storage    | `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET_NAME` `R2_PUBLIC_URL` | media library refuses uploads                                    |
| Payments   | `RAZORPAY_KEY_ID` `RAZORPAY_KEY_SECRET` `RAZORPAY_WEBHOOK_SECRET`                          | invoices can still be recorded paid manually; no online checkout |
| AI         | `AI_PROVIDER=anthropic` `AI_API_KEY`                                                       | AI drafting hidden                                               |
| Logging    | `LOG_LEVEL`                                                                                | defaults to `info`                                               |
| Scheduling | `CRON_SECRET`                                                                              | `/api/cron` returns 503 and **scheduled publishing never runs**  |

`R2_ENDPOINT`, `RAZORPAY_API_URL` and `AI_BASE_URL` exist to point a client at a
local double during verification. **Leave all three blank in production.**

`CRON_SECRET` must be at least 24 characters. Generate one with
`openssl rand -base64 32`. Without it the scheduler endpoint refuses every
caller rather than running open — see step 8 of §4.

`SEED_SUPER_ADMIN_*` are read only by `npm run db:seed`. Set them for the first
seed, then remove them — they are not needed at runtime and there is no reason
to leave a password in the environment.

### The rules that bite

- **Never prefix a secret with `NEXT_PUBLIC_`.** Next inlines those into the
  client bundle at build time. There are currently no `NEXT_PUBLIC_` variables
  in this project, and that is the correct number.
- **`AUTH_SECRET` rotation invalidates every session.** Everyone is signed out.
  Do it deliberately, not as part of a routine redeploy.

---

## 4. Deploying on Coolify

1. **Create the database.** Add a PostgreSQL 16 resource in Coolify, or point at
   a managed instance. Note its internal connection string.
2. **Create the application.** New resource → from your Git repository →
   Dockerfile build. Coolify reads the `Dockerfile` at the repo root; there is
   nothing to configure about the build itself.
3. **Set the port.** The container listens on **3000** and binds `0.0.0.0`.
4. **Set the environment variables** from §3. Coolify injects them at runtime,
   which is what the hermetic build is for.
5. **Set the health check** to `GET /api/health` on port 3000. It runs a
   `SELECT 1`, so it reports the database being unreachable, not merely the
   process being alive. It returns no detail on failure — it is unauthenticated,
   and an error body there would describe your infrastructure to anyone asking.

   Coolify runs that probe as a command _inside the container_, and
   `node:22-bookworm-slim` ships neither `curl` nor `wget`. The runner stage
   therefore installs `curl`, so the default probe shape works as written:

   ```bash
   curl -fsS http://127.0.0.1:3000/api/health
   ```

   The image also declares its own `HEALTHCHECK` with the same command, which
   is what `docker ps` and Compose report against. If you prefer not to depend
   on `curl` being present, `node -e "fetch('http://127.0.0.1:3000/api/health')
.then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` needs nothing
   but the runtime — that is the form `docker-compose.yml` uses.

6. **Attach the domain** and let the proxy issue TLS. HTTPS is not optional:
   session cookies are `__Secure-`-prefixed and `secure` in production, so over
   plain HTTP nobody can stay signed in.
7. **Deploy.**
8. **Add the scheduled job**, if you want pages to publish and unpublish on a
   schedule. In Coolify, add a _Scheduled Task_ on the application resource:

   | Field     | Value                                                                              |
   | --------- | ---------------------------------------------------------------------------------- |
   | Frequency | `*/5 * * * *` — every five minutes                                                 |
   | Command   | `curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron` |

   Any scheduler works — Coolify's, a system crontab, an external pinger — as
   long as it sends the secret. The endpoint also accepts `?secret=…` for
   schedulers that cannot set a header, and answers both GET and POST.

   Calling it more often than needed is safe: each run selects only what is due
   and clears its own marker, so a duplicate or concurrent run finds nothing to
   do. Five minutes is the resolution of a schedule — a page set to go live at
   09:00 goes live on the first check after 09:00, and the editor is told so on
   screen.

   Without this job, `publishAt` and `unpublishAt` are recorded and simply never
   fire. Everything else in the application is unaffected.

### What happens on every deploy

The entrypoint runs `prisma migrate deploy` before the server accepts traffic.
That command applies committed migrations only — it never generates, never
resets — and Prisma takes a Postgres advisory lock, so several instances
starting at once do not race each other.

`SKIP_MIGRATIONS=1` skips that step, for the case where you want to apply
migrations from a one-off job instead. Use it knowingly; the default is right
for almost everyone.

It then runs `npm run db:sync`. A schema migration is only half of a release:
the other half is the data the new code assumes exists. That step brings the
database in line with the deployed source — the permission catalogue, which
permissions each system role holds, the lead source types, the email templates'
variable lists, the two example automations, and the `home` page that `/`
renders. Without it, a release that adds a permission 403s its own new screen
for everybody until somebody remembers to run a command.

It is safe to run unattended, and that is enforced by what it does _not_ do:

| It does                                                      | It never does                                   |
| ------------------------------------------------------------ | ----------------------------------------------- |
| Upsert the permission catalogue                              | Create a user or set a password                 |
| Reconcile the nine `isSystem` roles against the code         | Touch a role you created yourself               |
| Create missing site settings                                 | Update a site setting that exists               |
| Create missing email templates, refresh their variable lists | Rewrite a template's subject or body            |
| Create the two example automations, switched off             | Re-enable or edit an automation                 |
| Create the `home` page if no page has that slug              | Overwrite, republish or resurrect one that does |
|                                                              | Insert demo content of any kind                 |

`SKIP_DB_SYNC=1` skips it. A failure here stops the boot on purpose: serving
with permissions that do not match the deployed code is worse than not serving.

**The seed proper is still not part of the entrypoint, deliberately.**
`npm run db:seed` runs the same sync _and_ creates the super admin — and with
`SEED_SUPER_ADMIN_PASSWORD` set it resets that account's password every time,
which is fine as a deliberate act and would be a serious surprise as a side
effect of a redeploy.

---

## 5. First boot

The deploy has already applied the migrations, synced the platform data and
created a starter homepage, so the site is serving. What is left is an account
to sign in with. Shell into the running container, or run a one-off job on the
same image:

```bash
docker exec -it <container> npm run db:seed
```

The runner image carries `tsx`, the generated Prisma client and the `lib/`
modules `prisma/seed.ts` imports, precisely so this works in the deployed
container rather than only on a developer's machine.

That runs the sync again (harmless) and creates the first super admin. It is
idempotent: re-running it will not duplicate anything. The super admin is
created **only** if `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD`
are set — credentials are never hardcoded. Note that re-running it with those
variables still set **resets that account's password** to whatever they hold.

Then sign in at `/auth/login` and go to `/admin`.

### The starter homepage

`/` renders the CMS page whose slug is `home`, and `home` is a reserved slug, so
it cannot be created from Admin → Website → Pages. The sync creates it on the
first boot that finds none — published, so the front page serves rather than
404ing.

It is a starting point, not a finished page. The hero and the closing call to
action carry placeholder copy to replace; everything between them is the dynamic
bands, which read live records and render nothing at all until you publish
services, case studies, packages, testimonials or posts. Nothing on it asserts
anything about your business.

Edit it like any other page: **Admin → Website → Pages → Home**. The slug being
reserved does not stop you editing the page that already has it — only creating
a second one. If you delete it, the sync will not put it back.

> **Never run `npm run db:seed:demo` against production.** It inserts sample
> services, packages, case studies and blog posts. It marks itself with
> `demo.seededAt` in `SiteSetting` so you can identify it later, but cleaning it
> out of a live database is work you should not have to do.

### Who can edit the website

The page CMS uses its own `pages.*` permissions, deliberately separate from
`content.*` (which is the content _calendar_). Seeded to ADMIN,
MARKETING_MANAGER and CONTENT_MANAGER; `pages.view` is in the read-only
baseline. Editing a page's SEO additionally needs `seo.edit`, and the history
panel needs `audit.view` — so a role can be given metadata control without
content control, or the reverse.

### Draft preview links

A page can carry one unlisted preview link, for showing a draft to someone
without an admin account. The token is 32 CSPRNG bytes and is the entire
credential: anyone with the URL sees the page. It is noindex, absent from the
sitemap, and revoked by rotating or clearing it from the page editor — both
take effect immediately. If your content is sensitive enough that an unlisted
URL is not acceptable, do not issue one; nothing else depends on the feature.

---

## 6. Integrations that need configuration outside the app

Setting the environment variables is half of each of these. The other half is on
the provider, and the application cannot detect that you skipped it.

### Cloudflare R2

Uploads go **from the browser straight to R2** using a presigned URL, so the
bucket must allow it:

- **CORS on the bucket** must permit `PUT` from your site's origin. Without it
  the browser refuses the presigned URL before the request ever reaches
  Cloudflare, and the failure looks like a network error with no server-side
  trace. Nothing in the app can diagnose this for you.
- `R2_PUBLIC_URL` must be the public read origin for the bucket (a custom domain
  or the r2.dev URL), not the S3 API endpoint.

The server verifies what actually landed: it sniffs the leading bytes of the
stored object and deletes it if the type does not match what was presigned.
Object keys are generated, never derived from the filename.

### Razorpay

- **Webhook URL:** `https://your-domain/api/payments/razorpay/webhook`
- **Event to subscribe:** `payment.captured`. It is the only event the handler
  acts on; others are acknowledged and ignored.
- **`RAZORPAY_WEBHOOK_SECRET` must match** the secret configured on that webhook
  in the Razorpay dashboard. A mismatched signature is rejected — it is not
  logged as a payment.

An invoice is marked paid by the **webhook**, reconciled server-side. The
browser's success callback never marks anything paid. If the webhook is not
configured, checkout will appear to work and no invoice will ever settle: this
is the single most common way to deploy this app half-configured.

### SMTP

Every send is logged to `EmailLog` before SMTP is touched, and a failed send
never fails the work that triggered it — capturing a lead succeeds on its own
terms. Check **Settings → Email** in the admin for delivery failures; they are
visible there, not swallowed and not surfaced as an error to the visitor.

`SMTP_SECURE=true` for implicit TLS (port 465); leave it false for STARTTLS
(587).

### AI

`AI_PROVIDER=anthropic` is the only implemented value. Any other value leaves AI
switched off rather than guessed at, so a typo disables the feature visibly
instead of erroring at the point of use.

---

## 7. Running more than one instance

The application is horizontally scalable as it stands. Specifically:

- **Rate limiting is shared.** Windows live in a `RateLimitWindow` row
  incremented by a single `INSERT … ON CONFLICT DO UPDATE`. This used to be an
  in-process `Map`, which was correct for exactly one container: behind two, an
  attacker got the full limit once per instance, so the effective login limit
  was whatever the deployment happened to be scaled to. It now holds across
  instances, and concurrent requests cannot both read the same count and both
  decide they are under the limit.
- **Migrations do not race.** `migrate deploy` takes a Postgres advisory lock.
- **No sticky sessions needed.** Auth is a signed JWT; any instance can serve
  any request.
- **No local state.** No uploads, no cache, no session files on disk.

Two things to keep in mind as you scale:

- **Connection count.** Each instance opens its own `pg` pool through
  `@prisma/adapter-pg`, at node-postgres's default ceiling of 10 connections.
  Multiply that by your instance count before scaling past a handful, and put
  PgBouncer in front of Postgres if it approaches the server's
  `max_connections`.
- **The content cache is per-instance.** `unstable_cache` uses Next's default
  cache handler, which is local to the container, so a publish that busts a tag
  busts it only on the instance that served the action. The others serve their
  own copy until the one-hour TTL expires. That is a staleness window rather
  than a correctness problem, but it is worth knowing before someone reports
  "I published it and it's still not live on refresh". A shared cache handler
  would close it; none is configured.

---

## 8. Operations

### Health and logs

`GET /api/health` — `200 {"status":"ok"}` when the process is up and Postgres
answers, `503` otherwise, with no detail either way.

Logs are structured JSON on stdout (pino) with no transport — the platform
collects them. `LOG_LEVEL` controls verbosity; `info` is the default and the
right production value. Passwords, tokens, API keys, cookies, `authorization`
headers and gateway signatures are redacted at the logger, so raising the level
to `debug` to chase a problem cannot spill a credential into your log
aggregator. Stack traces never reach a user.

### Audit trail

Every privileged mutation writes an `AuditLog` row — actor, action, entity,
before/after, IP, timestamp — readable in the admin. Client IP is taken from
`x-forwarded-for`, so it is only as trustworthy as your proxy: Coolify's proxy
sets it correctly, but if you put another proxy or a CDN in front, make sure it
appends rather than lets a client forge the header.

### Backups

Back up **PostgreSQL**. It holds everything transactional — leads, proposals,
invoices, payments, content, audit history.

```bash
pg_dump --format=custom --file=emporia-$(date +%F).dump "$DATABASE_URL"
```

R2 holds media, and Cloudflare's own durability covers it; enable versioning on
the bucket if you want protection against a bad delete. `RateLimitWindow` is the
one table you can drop from a restore without consequence — it is disposable by
nature.

**Test a restore before you need one.** An untested backup is a hope.

### Redeploy and rollback

Redeploys are ordinary: build, migrate, start. Rollback needs one thought.

**Migrations are forward-only.** There are no down migrations. Rolling the image
back to a previous version is safe if the schema change in between was
backward-compatible — an added nullable column, a new table, a new index. It is
**not** safe if a column was dropped or made non-nullable, because the old code
will meet a schema it was never written against.

For anything destructive, use expand/contract across two deploys: add the new
shape and write to both (deploy 1), then remove the old shape once the previous
image is no longer a rollback target (deploy 2). Between those, rollback is free.

---

## 9. Self-hosted alternative: Docker Compose

`docker-compose.yml` runs Postgres and the app together. It is the local
development stack and the reference for the Coolify setup:

```bash
cp .env.example .env      # fill in DATABASE_URL, AUTH_SECRET, SITE_URL, POSTGRES_PASSWORD
docker compose up -d
```

`POSTGRES_PASSWORD` and `DATABASE_URL` have **no defaults** and Compose refuses
to start without them. A fallback password in a file that doubles as the
production reference is a password that reaches production silently.

---

## 10. Troubleshooting

**Container restart-loops immediately, log lists environment keys.**
Working as designed. Env validation failed at boot; the message names each
missing or invalid key. Fix and redeploy.

**`next start` doesn't serve the app.**
It doesn't work with `output: "standalone"`. The image runs
`node server.js` from the traced standalone bundle, with `.next/static` and
`public` copied next to it. To reproduce a production build locally, follow the
recipe in the README's Commands section.

**Signed in, then immediately signed out.**
The session cookie is `__Secure-`-prefixed and `secure` in production, so it is
dropped over plain HTTP. Confirm TLS is terminating and `SITE_URL` /
`AUTH_URL` match the origin the browser is actually using.

**Uploads fail in the browser with no server-side error.**
R2 bucket CORS. See §6.

**Payments complete at Razorpay but invoices stay unpaid.**
The webhook is not reaching you, or `RAZORPAY_WEBHOOK_SECRET` doesn't match.
Check the webhook's delivery log in the Razorpay dashboard first — a signature
rejection is visible there as a non-2xx response.

**Login rate limiting seems too permissive.**
It shouldn't be, since the window moved to Postgres. If you see it, check that
`x-forwarded-for` carries the real client IP rather than the proxy's.

**A third-party script is silently blocked.**
The CSP in `next.config.ts` allows Razorpay's checkout and nothing else.
Adding an analytics or chat script means adding its origin there — deliberately,
in code review, not by relaxing the policy at the proxy.

**Build fails asking for `DATABASE_URL`.**
A route that reads the database lost its `force-dynamic` and is being
prerendered. Fix the route. Giving the builder a database is how the build stops
being reproducible.

**`npm install prisma` broke the build.**
`prisma@latest` is a release candidate. `prisma` and `@prisma/client` are pinned
to exactly `7.10.0`.

**Container exits on boot with `Cannot find module '<something>'`.**
Almost certainly the entrypoint's `prisma migrate deploy`, not the server. The
Prisma 7 CLI has a large transitive closure and the runner needs all of it; the
image therefore copies the whole `node_modules` from the builder rather than a
hand-picked subset. If you trim that COPY to save space, this is what comes
back. `--omit=dev` has the same effect for a different reason: `prisma`, `tsx`
and `dotenv` are devDependencies.

**Coolify reports the container unhealthy while the app answers fine.**
The probe command cannot run. `curl` is installed in the runner for exactly
this; if you changed the base image or the health check, check the probe
executes at all — a missing binary exits 127, which reads as a failed check.

---

## 11. Known gaps

Stated plainly rather than papered over.

- **The container image has not been built or run in the development
  environment.** No Docker daemon is available there
  (`/var/run/docker.sock` absent), so the `Dockerfile`, `docker-compose.yml` and
  entrypoint are written against the documented behaviour of the tools and
  reviewed, but **the first real build happens on your Coolify server.** Budget
  time for it on the first deploy. Everything else in this repository — schema,
  migrations, seed, auth, RBAC, money arithmetic, isolation, SEO, the production
  Next build itself — is verified against a running build and a real database.
- **There is no scheduler.** Marking invoices overdue, billing retainers and
  sending payment reminders are buttons under Admin → Finance, run on demand.
  Nothing pretends a cron exists. If you want them scheduled, that is a cron
  container or a Coolify scheduled task calling the same service functions — it
  has not been built.
- **Shiprocket is an interface only.** No implementation, no credentials in use.
- **No CDN configuration is included.** The app sets its own cache headers and
  runs correctly behind one; choosing and configuring it is yours.
