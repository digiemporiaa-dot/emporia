# Final audit — 26 September 2026

An audit of the whole project against `CLAUDE.md`, run at the close of the
CMS 2.0 plan. Every line below was **executed**, not read: greps over the tree,
queries against the database, and a running server driven in a real browser.

Headline: **the ten non-negotiables hold.** Seven findings were recorded. Five
stand, **two were wrong** (F1 and F7 — both are corrected in place rather than
quietly deleted), four are fixed, and fixing them turned up four further defects
the audit itself had missed. See §11.

---

## 1. Scale

| | |
|---|---|
| Source files (`app`, `lib`, `components`) | 502 |
| Test files / tests | 87 / **1431 passing** |
| Prisma models / enums | 80 / 47 |
| Migrations | 16 |
| Route segments with a `page.tsx` | 129 |
| Permissions in the catalogue | 118 |
| Audit write sites | 164 across 37 services |

Gate at the time of the audit: `eslint` clean, `tsc --noEmit` clean, **1431/1431
tests pass**, production build succeeds, `npm audit --omit=dev` reports 0
vulnerabilities.

---

## 2. The ten non-negotiables

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | Money is `Decimal` | **Pass** | 39 `Decimal` columns; no money field typed `Float`/`Int`; the gateway's minor units convert through `Decimal`, never `Number` |
| 2 | Authorization server-side | **Pass** | 154 server actions across 29 files; the 6 files with no actor call are the five deliberately public ones (login, forgot, reset, invite, contact) plus `signOutAction`. On a running server `/admin`, `/portal` and `/preview-frame` all 307 to login and `/api/export/city` returns 401 |
| 3 | Client data isolation | **Pass** | No client component imports `db`. The single direct read in `app/portal/layout.tsx` is scoped by `actor.clientId` from the session; everything else in the portal goes through services. Covered by `tests/portal-isolation.test.ts` |
| 4 | Zod on every input | **Pass** | Every server action and every route handler that takes a body parses before use. The Razorpay webhook is the one exception and is stricter, not looser: it verifies an HMAC over the raw bytes first, then narrows each field by type |
| 5 | No fakes | **Pass** | Zero `TODO`/`FIXME`/`HACK` markers in `app`, `lib` or `components` (all 22 `TODO` hits are the `TODO` task-status enum). One `Math.random`, used as a React key for an upload row |
| 6 | No secrets client-side | **Pass** | Zero `NEXT_PUBLIC_` variables anywhere. No `process.env` read in any client component. Only `.env.example` is committed, and it holds no values |
| 7 | No thin city pages | **Pass** | `publish()` in `serviceCityPage.service.ts` is the only route to `PUBLISHED` and calls `canPublish` first — enforcement in the service, as §9 demands |
| 8 | Server Components by default | **Pass** | 105 of 267 `.tsx` files carry `"use client"` (39%), and none of them touch the database |
| 9 | Strict TypeScript | **Pass** | `strict` **and** `noUncheckedIndexedAccess`. Exactly one match for `any` in the whole tree, and it is the word "anything" inside a comment |
| 10 | Don't destroy working code | **Pass** | 60 commits, each phase migrating rather than replacing; the homepage is the clearest case — 581 hand-written lines became CMS sections rendering the same markup |

---

## 3. Security

All verified against a running server or by reading the implementation.

- **Passwords** — argon2id, parameters above the OWASP minimum.
- **Sessions** — `httpOnly`, `sameSite: lax`, `secure` in production.
- **Rate limiting** — 16 distinct keys: login by IP *and* by email, password
  reset by both, invite, contact, lead capture, page forms, popup resolve and
  event, media presign, portal password, and a per-task AI spend budget.
- **Razorpay** — signature verified against the **raw** body before anything is
  read; replays are idempotent on the gateway's payment id; failures are terse
  so an attacker learns nothing. A browser-reported success never marks an
  invoice paid.
- **Uploads** — MIME is sniffed from the leading bytes, not trusted from the
  client; keys are generated server-side from random bytes; presigning requires
  auth and is rate limited.
- **Errors** — no stack trace reaches a user; `AppError` carries a
  `publicMessage` and the logger keeps the rest.
- **Audit** — 164 write sites across 37 services, each in the same transaction
  as the mutation it records.
- **Permission drift** — the catalogue in code and the `Permission` table agree
  exactly: 118 each, no difference in either direction.

---

## 4. Data model (§7)

Every entity the specification names is present — all 65 checked, none missing.
The nine key enums match their specified values exactly.

- 191 `@@index` declarations, 194 relations, 154 explicit `onDelete` rules.
- 12 unique slug columns; `@@unique([serviceId, cityId])` present as required.
- Soft delete on exactly the models the spec names — `Lead`, `Client`,
  `Invoice`, `Media` — plus `Page` and `ReusableSection`.

---

## 5. Design system (§6)

- Brand tokens defined once in `app/globals.css`; the red and navy ramps are
  both derived from the two brand hexes.
- Every Tailwind colour used outside the token names is a **red** shade that is
  itself defined as a brand-derived token (`--color-red-50` … `--color-red-700`).
  No blue, green, purple or other palette colour appears anywhere.
- Raw hex appears 6 times: three are default values for the page builder's
  colour pickers, one is the PWA `themeColor`, one is in a comment.
- Forbidden patterns: **0** gradients, **0** glow/blob shadows, 1 `animate-pulse`.
  `backdrop-blur` appears 6 times — all on sticky headers, the consent banner and
  an opt-in "glass" card style, none of it the heavy glassmorphism §6 rules out.

---

## 6. SEO (§9)

- `sitemap.xml` and `robots.txt` both served; the sitemap carried 35 entries on
  demo data and leaked **zero** `/admin`, `/portal`, `/auth` or `/api` URLs.
  Robots disallows all four independently.
- 21 `generateMetadata` implementations, 17 JSON-LD emitters, `BreadcrumbList`
  present.
- Redirects are database-managed with loop detection at write time.
- One SEO form, shared by the page builder and every catalog screen, guarded by
  `tests/seo-form-parity.test.ts` against a fork reappearing.

---

## 7. Runtime behaviour

A real browser over a production build, across all three surfaces.

| Surface | Pages | Status | Horizontal overflow @375px | Console errors |
|---|---|---|---|---|
| Public site | 8 | all 200 | **0px** | 1 (favicon — see F3) |
| Admin | 8 | all 200 | **0px** | 0 |
| Client portal | 8 | all 200 | **0px** | 0 |

40 page loads at both 1440px and 375px. §12's "zero horizontal overflow at any
width" holds everywhere tested.

Bundle: 102 kB shared baseline; public pages 150–172 kB; the heaviest route is
the page builder at 189 kB, which is a dense editor and reasonable.

---

## 8. Findings

Nothing here is a correctness or security defect. Listed worst first.

### F1 — ~~No `loading.tsx` anywhere~~ — **this finding was wrong**
0 of 129 segments have one, and that is **deliberate and correct**. A
segment-level loading boundary also wraps that segment's children, and Next
streams the shell before the child runs — so `notFound()` in a detail route
answers a dead URL with 200 and a skeleton instead of a 404. It is recorded in
`docs/ARCHITECTURE.md` 17.2, restated in `app/(website)/not-found.tsx`, and
again in the shared `TableSkeleton`. The audit counted files without reading
why they were absent.

The real gap is narrower: the documented substitute — an explicit `<Suspense>`
with a skeleton inside the page — was used on **2 pages out of 103**, so every
other list screen showed nothing at all while its query ran. Fixed for the
filtered list screens; see §11.

### F2 — The portal has no error boundary *(quality bar, §12)* — **fixed**
`app/portal` has neither `error.tsx` nor `not-found.tsx`, so a client-facing
failure falls through to the root boundary and shows a client the generic page.
`app/(website)` likewise has no `error.tsx`. Present: `app/error.tsx`,
`app/admin/error.tsx`, `app/admin/website/error.tsx` and four `not-found.tsx`.

### F3 — No favicon, app icon or manifest — **fixed**
There is no `public/` directory and no `icon`/`apple-icon`/`favicon` route. Every
page load 404s on `/favicon.ico`, which is the one console error in the sweep
above.

### F4 — The demo seed creates no client and no portal user — **fixed**
`db:seed:demo` covers the website, catalog and CRM but produces zero `Client`
rows, so the portal's 13 screens cannot be opened without hand-building a
fixture — which is what this audit had to do. The portal is covered at the
service layer by `tests/portal-isolation.test.ts`, but nothing makes it easy to
look at.

### F5 — ~~Shiprocket is absent entirely~~ — **closed as documented**
§3 calls for a "Shiprocket-ready interface only". There is no `lib/shipping`,
and no file anywhere mentions Shiprocket — yet `.env.example` and the env schema
both declare `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD`. The keys promise
something that does not exist.


**Resolved during social Phase 12, by documenting rather than building.** The
keys stay — CLAUDE.md 3 says shipping is architected for, and 14 says
`.env.example` carries every key — but both the example file and the env schema
now say plainly that nothing reads them and that setting them does not enable
shipping. The finding was never that the keys existed; it was that they looked
like a working integration. They no longer do.

### F6 — ~~`DATABASE_URL` and `TEST_DATABASE_URL` point at the same database~~ — **closed**
In this environment's `.env` both were `emporia_test`. `tests/global-setup.ts`
states in its own comment that a separate database means "a test run can never
touch development data" — which was untrue. Local configuration, not shipped
code, but it is how development data gets destroyed.

**And it did.** During social Phase 5 the homepage began returning 404: the test
suite had deleted the `home` CMS page row out from under the dev server, which
was reading the same database. Roughly an hour went into diagnosing it as a
caching problem before the shared database turned out to be the cause — the
second time that symptom has sent an investigation the wrong way (see F7).

Dev now has its own `emporia_dev`, migrated and seeded, and `.env` points there.
Two further things surfaced while closing it, both worth knowing:

- **`next build` bakes `.env` into the standalone bundle.** Changing
  `DATABASE_URL` does nothing until you rebuild; the server goes on serving the
  old database while `.env` says otherwise.
- **The standalone runner's cache is `.next/standalone/.next/cache`**, not
  `.next/cache`. Advice to clear the latter — including in this repo's own
  docs — clears a directory that does not exist under `npm start`.

### F7 — ~~Cached pages go stale after an out-of-band write~~ — **misdiagnosed**
The evidence given for this was wrong. The homepage 404 that prompted it was
not a caching problem at all: the whole audit was run against `npm run start`,
which is `next start`, which **does not work with `output: "standalone"`** — and
does not fail cleanly. The server comes up, serves most of the site, and answers
404 on some routes. Next prints the warning on every boot and it scrolled past
unread. Served the supported way, `/` returns 200 every time.

Both the README and `docs/DEPLOYMENT.md` §9 already said so. The audit did not
read them and diagnosed the symptom instead — the cache clears that appeared to
fix it were coincidence.

Two real things came out of it, and both are now done:

- **`npm start` no longer serves a subtly broken app.** It runs
  `scripts/start-standalone.mjs`, which does what the Dockerfile does — copies
  the static assets next to the traced server and runs it. `npm run start:next`
  remains for the unsupported command.
- **Out-of-band writes genuinely are not revalidated**, which is true
  independently of the above: tags are busted by the services, so a seed script
  or a manual `psql` fix leaves running instances serving what they cached. That
  is a staleness window, not a 404 machine. Documented in
  `docs/DEPLOYMENT.md` §7 and printed by `db:seed:demo`.

---

## 9. Still owed by the operator

Unchanged since Phase 6, and the one thing that stops a shipped feature working:
**`CRON_SECRET` (≥24 characters) and a scheduled task hitting `/api/cron`** must
be configured in Coolify. Without them `/api/cron` returns 503 by design — it
refuses to run open rather than publish on an unauthenticated request — and
scheduled publishing never fires. See `docs/DEPLOYMENT.md` §4 step 8.

---

## 10. Dependencies

0 vulnerabilities. Majors deliberately behind, all safe to defer:

| Package | Current | Latest | Note |
|---|---|---|---|
| `next` | 15.5.25 | 16.3.6 | Major; Next 16 upgrade is its own piece of work |
| `prisma` / `@prisma/client` | 7.10.0 | 8.0.0-rc | Latest is a release candidate |
| `typescript` | 5.9.3 | 7.0.2 | Major |
| `vitest` | 4.1.11 | 5.0.2 | Major |
| `eslint` | 9.39.5 | 10.11.0 | Major; `eslint-config-next` is pinned to Next 15 |
| `next-auth` | 5.0.0-beta.32 | — | "Latest" reads 4.24.15; v5 is still beta and is the correct line for App Router |

---

## 11. What the fixes changed, and what they uncovered

F2, F3 and F4 are fixed; F1 is fixed as restated above. F6 was closed during
social Phase 5, after it destroyed development data exactly as predicted. Both F5 and F6 are now closed. F7 is documented rather than left to be rediscovered.

**F1 — loading states.** `TableSkeleton` moved to `components/admin/` and the
`<Suspense>` pattern was applied to the three filtered list screens that lacked
it: leads, invoices and projects. Each now streams its rows while the filter bar
above stays mounted and interactive, which is the point of the pattern rather
than the shimmer. The invoices header stopped waiting on the row query
altogether: its "outstanding across every unpaid invoice" figure was being read
from the filtered call, and now comes from `financeSummary`, which is what that
sentence actually describes. The content calendar was left alone deliberately —
it is a board, not a paginated table, and its header counts the items it would
be streaming, so retrofitting the pattern means redesigning the header.

**F2 — boundaries.** `app/portal/error.tsx`, `app/portal/not-found.tsx` and
`app/(website)/error.tsx`. The portal's 404 says "not available to you" rather
than "does not exist", because another client's project and a mistyped id reach
it by the same path and the wording must not tell them apart.

**F3 — icons.** `app/icon.tsx` and `app/apple-icon.tsx` draw the mark from the
two brand colours through `ImageResponse`, so it cannot drift from the design
system the way a checked-in `.ico` does, and `app/manifest.ts` takes its name
and description from site settings.

**F4 — the demo client.** `db:seed:demo` now creates Northwind Studio with a
portal user, a project with tasks and milestones, two invoices (one paid, one
part-paid) with their payments, a pending approval and a message thread — enough
to open every portal screen. The command prints the sign-in at the end.

### Four defects the fixes uncovered

None of these were visible to the audit, and all three came from putting real
data in front of real code.

1. **Two demo services carried icons that do not exist** — `pen` and `chart`,
   where the curated set has `pen-tool` and `bar-chart`. The renderer only knows
   `ICON_NAMES`, so both services drew no icon on the public site, and the
   service schema refuses the value, so neither could be re-imported from its
   own export. Found by the Phase 15 round-trip test the moment the table held
   more than a bare fixture. The values are corrected and the seed now asserts
   every icon against `ICON_NAMES` — writing straight through Prisma was the one
   path that bypassed both checks. The importer's message also names the
   offending value now; "Choose an icon from the list" is useless beside a
   spreadsheet cell.

2. **The seeded portal user could not sign in.** `User.status` defaults to
   `INVITED` and authentication requires `ACTIVE`. The row looked correct in the
   table and failed at the login form — the kind of thing only actually signing
   in finds.

3. **`npm start` served a subtly broken app.** `next start` does not work with
   `output: "standalone"` — some routes answer 404 while the rest of the site
   works. It is documented in two places and warned about on every boot, and it
   still cost this audit a false finding (F7). `npm start` now runs the build
   the way the image does.

4. **Three tests depended on an empty database.** They failed as soon as demo
   data existed: a hard-coded reserved slug collided with the seeded `careers`
   page, and two absolute money totals counted the demo invoices. All three now
   measure what their own fixture contributes — the reserved-slug test claims
   whichever slug is free, and the analytics test asserts the delta against a
   baseline read before the fixture is built. This is F6 biting: with a shared
   database the suite has to be written for one.
