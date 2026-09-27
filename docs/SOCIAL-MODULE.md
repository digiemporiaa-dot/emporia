# Client social media module

A multi-client social media capability built **on** Emporia's existing agency
operating system, not beside it. The governing question at every decision below
was the one the brief sets: *does this extend what is already here, or create a
parallel system?*

This document records the audit, the mapping, and each phase as it lands.

---

## 1. Audit — what already exists

Read before designing: `CLAUDE.md`, `docs/ARCHITECTURE.md`, the Prisma schema
(80 models, 47 enums), `lib/services/` (49 services), `lib/automation/`,
`lib/content/`, the admin and portal surfaces, the route handlers, the
validation layer and the RBAC catalogue (118 permissions).

The relevant findings:

| What exists | Shape | Bearing on this module |
|---|---|---|
| `ContentCalendarItem` | `clientId` + `projectId` + `channel` + `stage` + `scheduledFor` + `ownerId` + `mediaId`, with `approvals` | **This is the content item.** `clientId` is already denormalised and written from the project, never from a caller |
| `ContentStage` | `IDEA DRAFT INTERNAL_REVIEW CLIENT_REVIEW APPROVED SCHEDULED PUBLISHED` | Already **exactly** the lifecycle the brief asks for |
| `Approval` / `ApprovalVersion` | Append-only versions, `PENDING CHANGES_REQUESTED APPROVED REJECTED`, already attaches to a content item | The approval workflow is built; it needs no second copy |
| `Campaign` | `clientId`, `platform`, `objective`, `budget`, `startsAt/endsAt`, `owner`, and **`Lead.campaignId` already points at it** | Carries the content campaign — see the decision below |
| `Media` | R2-backed, MIME sniffed from bytes, `type`/`width`/`height`/`alt` | Social creatives reference media rows; no second upload path |
| `UTMTracking` | `visitorId`, source/medium/campaign/term/content, server-side attribution | Link attribution for social posts |
| `Notification`, `Automation`, `AuditLog` | Working engines with their own services | Extended, never reimplemented |
| `lib/security/secret.ts` | AES-256-GCM, key derived from `AUTH_SECRET`, `decryptSecret` returns null rather than throwing | **The store for OAuth tokens.** Built for exactly this |
| `IntegrationSetting` | `provider` + `config` JSON + `isEnabled` | Per-provider app credentials (client id/secret), same as the AI provider uses |
| `lib/payments/` | `configured` flag, provider interface, `UnconfiguredProvider` that throws a typed error | **The template for the social provider adapters** |
| `/api/cron` + `runScheduledPublishing` | Secret-authenticated, refuses to run open, already publishes on a schedule | The scheduler the publishing engine hangs off |
| `lib/ai/` | One `AIService`, provider-swappable, every result a `Draft<T>`, per-task spend budgets | Social drafting extends this; no second AI abstraction |
| Portal | `requirePortalActorPage`, every query scoped by `actor.clientId` from the session | Client-facing social views use exactly this |

---

## 2. Mapping

```
Existing model                → Extension required
  ContentCalendarItem         → + campaignId, + socialPosts[]      (it IS the content item)
  Campaign                    → nothing; SOCIAL_ORGANIC already exists as a platform
  Approval / ApprovalVersion  → nothing; already attaches to a content item
  Media                       → nothing; referenced, never copied
  Client                      → + socialAccounts[]
  AuditLog                    → nothing; new entity types are strings

Existing service              → Reuse / extend
  delivery-content.service    → reuse (items, stages, approvals) + extend for campaign/pillar filters
  notification.service        → reuse
  automation                  → extend with social trigger events
  ai.service                  → extend with social drafting tasks
  media.service               → reuse
  schedule.service / cron     → extend with the publishing sweep
  audit.service               → reuse

New model                     → Reason
  SocialAccount               → a connected platform account per client. Nothing models this
  SocialPost                  → the per-platform version of one content idea. This is the
                                heart of the brief: one idea, different copy per platform.
                                No existing model holds platform-specific copy
  SocialPublication           → one row per publication *attempt*, so a retry has a history
                                and an idempotency key has somewhere to live
  SocialMetricSnapshot        → daily per-post metrics, so trends are computable.
                                CampaignMetric is paid-media shaped (spend, clicks) and
                                keyed to a campaign, not a post

Existing UI                   → Extend
  /admin/clients/[clientId]   → + a Social section
  content calendar            → + platform, campaign and pillar filters
  portal                      → + /portal/social

New UI                        → Reason
  social account management   → OAuth connect / health / sync has no existing screen
  platform version editor     → per-platform copy has no existing editor
```

### The one decision worth arguing

**A content campaign is a `Campaign`, not a new model.** The brief lists
`SocialCampaign` as a *possible* entity and asks whether `Campaign` covers it.
It does, and reusing it is not a compromise:

- `platform: SOCIAL_ORGANIC` is an accurate value, not a placeholder.
- `budget: 0` is accurate — an organic campaign has no ad spend.
- **`Lead.campaignId` already points at `Campaign`.** Reusing it means §42
  (social post → UTM → lead → opportunity → revenue) works through the
  attribution the CRM already records, instead of needing a second join.

A separate `SocialCampaign` would have bought nothing and cost that chain.

### Deferred on purpose

`SocialBrandProfile`, `SocialContentPillar` and `SocialStrategy` are **not** in
Phase 1. They exist to feed AI drafting and calendar grouping, and creating
tables nothing reads yet is how a schema grows surface it never earns. They land
with Phase 9, where they are consumed.

---

## 3. Phase 1 — data model and service architecture

Schema, provider abstraction, RBAC, the two core services and their tests. No
UI and no real provider adapter: those are Phases 2 onward, and shipping a
screen in front of an integration that does not exist is the thing CLAUDE.md
rule 5 forbids.

### Schema

Migration `20260926190534_social_module_phase1`.

**Extended:** `ContentCalendarItem` gains `campaignId` and `socialPosts[]`;
`Campaign`, `Client`, `Media` and `User` gain back-relations. Nothing was
renamed, moved or removed.

**New — five models, and the reason for each:**

| Model | Why it has to exist |
|---|---|
| `SocialAccount` | A connected platform account per client. Tokens are encrypted columns no service returns |
| `SocialPost` | **The platform version.** One idea's Instagram copy is not its LinkedIn copy, and nothing in the schema could hold that |
| `SocialPostMedia` | Ordered creatives — a carousel is several rows. References `Media`, never copies a file |
| `SocialPublication` | One row per publication *attempt*, carrying the unique idempotency key. This is what makes double-publishing structurally impossible rather than merely unlikely |
| `SocialMetricSnapshot` | A day's metrics per post, **every figure nullable** — no provider reports all of them, and a zero where a platform reports nothing is a fabricated metric |

Isolation is by direct `clientId` column on `SocialAccount`, `SocialPost`,
`SocialPublication` and `SocialMetricSnapshot` — not derived through two joins,
because the filter that has to be right every single time should be one column.

### Provider abstraction

`lib/social/` — the shape `lib/payments` established:

- `types.ts` — `SocialProviderAdapter`: connect, refresh, getAccount, publish,
  getMetrics. Plus **capabilities**, which is the part that matters. These six
  platforms differ, so an adapter *declares* what it supports instead of the
  rest of the system assuming.
- `capabilities.ts` — one table of what each platform's **publishing API**
  actually accepts. Conservative on purpose: Instagram has no clickable caption
  link and no reliable Stories publishing, Google Business Profile has no
  carousel, X reports no metrics on a standard tier. Every "can this provider
  do X" question resolves here, never through a `provider === "INSTAGRAM"`
  branch in a component.
- `unconfigured.ts` — reports capabilities, refuses every call with
  `IntegrationNotConfiguredError`. All six providers resolve to this today, so
  the UI will read "Not configured" rather than appearing to work.
- `scope.ts` — `resolveClientScope`, the single place a requested client turns
  into an allowed one. Staff name a client; a portal user's comes from the
  session and a request naming a different one is refused outright.

### Services

`social-account.service.ts` — list, get, connect, disconnect, sync results,
health. **No function returns a token.** The select list has no token column in
it; the decrypted value is reachable only through `credentialsFor`, which
exists for the adapter and is never called from anything that renders. The
audit payload is hand-built rather than derived from the row, so the encrypted
token is not copied into the audit log either.

`social-post.service.ts` — list, get, save, delete, status. Two rules it exists
to hold: `clientId` is copied from the content item and never accepted from a
caller; and a post that is `PUBLISHING` or `PUBLISHED` is not editable, because
its copy is the record of what went out. `PUBLISHING` and `PUBLISHED` are
unreachable from any screen — only the publishing engine may claim a row — and
scheduling refuses content whose item is not `APPROVED`.

### RBAC

Nine permissions, in their own namespace rather than folded into `content.*`:
planning a post and holding a client's live credentials are different powers.
`social.publish` governs publishing now and retrying; scheduling an approved
post is an ordinary edit. Granted to ADMIN (all), MARKETING_MANAGER (all),
PROJECT_MANAGER (through `social.approve`), CONTENT_MANAGER (write, no approve,
no publish, no credentials) and `social.view` in the read-only baseline.

### Tests — 30, all passing

`tests/social-isolation.db.test.ts` (18) — no read returns a token, the stored
value is encrypted, the audit trail is clean, one platform account cannot serve
two clients, a portal user cannot widen scope, posts copy their client from the
item, and **nothing schedules without approval**.

`tests/social-capabilities.test.ts` (12) — the capability table is consulted by
validation: an unsupported format, an unsupported field, a caption that only
overflows once hashtags are counted, and an over-long carousel are each refused
when written rather than at publication.

> A bug the tests caught: the unconfigured adapter's async methods threw
> synchronously, so a `Promise`-typed call escaped the caller's `.catch()`.
> They are `async` now, and every real adapter must behave the same way.

Gate: lint, typecheck, **1461 tests across 89 files**, production build — clean.

### What Phase 1 deliberately does not include

No UI, no OAuth routes, no publishing, no scheduler, no metrics collection, no
real provider adapter. Those are Phases 2–8, each with its own screen and its
own tests. `SocialBrandProfile`, `SocialContentPillar` and `SocialStrategy` land
with Phase 9, where AI drafting consumes them — tables nothing reads are
surface a schema has not earned.

---

## 4. Phase 2 — client social account management

Connecting a client's account: the agency's app credentials, the OAuth round
trip, the accounts screen, and the first real provider adapter.

### The OAuth flow, and what it refuses

```
Admin → Client → Social → Connect
  → /api/social/oauth/<provider>?clientId=…      (authenticate, authorize, sign state, set nonce cookie)
  → the provider's consent screen
  → /api/social/oauth/<provider>/callback         (verify signature + nonce, exchange, read account)
  → connectAccount                                 (encrypt, audit, mark connected)
  → back to the accounts screen with the outcome
```

**The client id is signed into the `state`, never read from the query string.**
The provider returns every client to one callback URL, so the callback has to
learn which client this was for from somewhere — and taking it from a parameter
the browser controls is precisely the failure the whole module is built to
avoid.

**A signature alone is not enough**, because a signed state is still replayable
by whoever obtains it. So the state also carries a nonce, and the same nonce
goes into an httpOnly cookie scoped to `/api/social/oauth`. The callback
requires both. An attacker can forge neither our HMAC nor the victim's cookie,
and a flow left open more than ten minutes is refused as stale.

`tests/social-oauth.test.ts` proves each check fails closed: an edited payload,
an absent cookie, someone else's cookie, an expired flow, and malformed input
all return a reason instead of a connection. The expiry test moves the clock
rather than editing the payload, because an old `issuedAt` cannot be forged
past the signature — a test that claimed to check expiry while actually
checking something else would be worse than none.

### The first adapter: LinkedIn

Chosen to be first because its OAuth is plain OAuth 2.0 and its profile is one
OpenID Connect call, so account connection can be built and *verified* without
the page-token dance Meta requires. Instagram and Facebook follow in their own
phase precisely because they are not this simple.

`tests/social-linkedin.test.ts` runs the **real adapter** — real URL building,
form encoding, parsing, error mapping — against a local wire-level stand-in, the
same approach `lib/ai/anthropic.ts` is tested with. Only the host moves. It
covers the round trip, a refresh response that omits its refresh token (kept
rather than dropped, which would force a needless reconnect), a rejected token
becoming a "reconnect" instruction, rate limiting, and that **the provider's
response body never reaches the message** — a failed token exchange can echo
the request, and that request carries the client secret.

`publish` and `getMetrics` belong to Phases 6 and 8 and **say so** rather than
returning a plausible nothing.

### Credentials, in two layers

- **App credentials** (the client id and secret the platform issues to the
  agency) live in `IntegrationSetting`, the row shape the AI provider already
  uses, with the secret encrypted. The settings screen reads a **mask** and
  never decrypts; a blank secret field means "keep the stored one", because the
  form shows a mask and submitting it unchanged must not wipe the credential.
- **Account tokens** (per client connection) are encrypted columns no service
  returns, as Phase 1 established.

The screen shows the exact redirect URI to register, because a mismatch there is
the single most common reason an OAuth flow fails.

### Three states, not one dead button

A provider is *not available yet* (no adapter written), *not configured* (no
credentials entered) or *ready*. These have different fixes, and the accounts
screen and the settings screen both say which one applies rather than showing a
button that cannot work.

### Verified in a browser

Settings and accounts screens render and are usable at 375px with no overflow.
Credentials saved through the real form, stored encrypted, shown masked, and
**not present in the page**. With LinkedIn configured, the connect button
appears and `/api/social/oauth/linkedin` answers:

```
307 → https://www.linkedin.com/oauth/v2/authorization
        ?response_type=code&client_id=…&redirect_uri=…&state=<signed>&scope=openid+profile+email+w_member_social
set-cookie: emporia.social.oauth=…; Path=/api/social/oauth; Max-Age=600; HttpOnly; Secure; SameSite=lax
```

No client secret in the redirect. Unconfigured, the same route answers 503 with
what to do about it; a forged callback answers 400 and writes nothing.

Gate: lint, typecheck, **1483 tests across 91 files**, production build — clean.

### Next

Phase 3 is content and platform versioning.

---

## 5. Phase 3 — content and platform versioning

One idea, a version per platform, each written against that platform's own
rules. This is the screen the module exists for.

### An idea is still a `ContentCalendarItem`

`social-content.service.ts` adds the *view* social work needs — one idea with
all of its platform versions beside it, scoped to a client, filterable by
campaign — and nothing else. Writing an item still goes through
`delivery-content.service`, which owns the stage machine. There is no second
content system, and a test asserts the created row is the ordinary calendar row
with the ordinary stage.

`ContentCalendarItem` gained `campaignId` in Phase 1 and the form now sets it.
A campaign belonging to another client is refused — otherwise this client's work
lands under someone else's reporting.

### The capability table drives the editor

The editor has **no `provider === "INSTAGRAM"` branch anywhere**. The capability
table is handed to the client and decides which fields render, which formats the
picker lists, and what the caption counter counts down from. Add a platform to
the table and the editor supports it.

Seen side by side on one idea:

| | Instagram | LinkedIn |
|---|---|---|
| Caption limit | 2,200 | 3,000 |
| Link field | **absent** — a caption link is not clickable | present |
| Call to action | absent | present |
| First comment | present | present |

Hashtags count towards the caption limit, because that is how the platforms
count them. An editor should not find out at 7:30pm that a caption which looked
fine does not fit.

### What the editor will not let happen

- A version that has gone out is not editable — its copy is the record of what
  was published, and the provider would not change the live post anyway.
- `PUBLISHING` and `PUBLISHED` are unreachable from any screen. Only the
  publishing engine may claim a row.
- Scheduling refuses an idea the client has not approved.
- A new version lives in form state until its first save, so a half-written
  caption is not a row somebody has to clean up.

### Tests — 14 more

`tests/social-content.db.test.ts`: the idea is an ordinary calendar row; the
client comes from the project and not the caller; another client's campaign is
refused; the pickers only offer this client's projects and campaigns; one idea
holds genuinely different copy per platform (and Instagram's link field is null
because it is not offered); the campaign filter works and another client's
campaign matches nothing; copy a platform would reject is refused when written;
an unapproved idea will not schedule; a published version's copy is locked.

### Verified in a browser

Created an idea, added an Instagram version and a LinkedIn version on it, and
saw the two forms differ exactly as the table says — 2,200 against 3,000, no
link field on Instagram, a call to action only on LinkedIn. Hashtags typed as
`#diwali #festive` stored as `diwali festive`. Saved, listed, no page errors, no
overflow at 375px.

> **Not a bug, but worth writing down.** Several homepage 404s during this
> phase's verification came from a stale `next-server` holding port 3000 while
> each new `npm start` failed with `EADDRINUSE` — so the responses being read
> were an older build's. Kill by PID and confirm the port is free before
> concluding anything from a served page.

Gate: lint, typecheck, **1497 tests across 92 files**, production build — clean.

### Next

Phase 4 is the calendar: month, week and list views over these versions, with
the platform, campaign and status filters the brief asks for.

---

## 6. Phase 4 — the content calendar

`/admin/clients/[clientId]/social/calendar`, a fourth tab beside Content and
Accounts.

### The calendar is over versions, not ideas

One idea — "Festive living room refresh" — is a single row in the content list
and **two cards** on the calendar: the Instagram reel on the 5th at 7pm and the
LinkedIn post on the 6th at 10am. They are two things that have to be ready at
two different times, and a calendar that collapsed them into one row would hide
exactly the fact a planner opens a calendar to see.

That decision drives everything else in the phase, including the rule below.

### The rule that made a service necessary

A version may carry its own `scheduledFor`, or leave it unset and take the
idea's target date. So "when does this go out" is
`post.scheduledFor ?? contentItem.scheduledFor`, and the fallback has to hold in
the **query** as well as in the result — otherwise every version that inherits
its date silently vanishes from the month it belongs to. Hence the OR in
`calendarPosts`:

```ts
OR: [
  { scheduledFor: window },
  { scheduledFor: null, contentItem: { scheduledFor: window } },
],
```

and `inherited: true` on the card, so the UI can say *from idea* rather than
implying somebody chose that time. `tests/social-calendar.db.test.ts` pins both
arms, including the case where an idea-level filter is applied at the same time
— the case that breaks if the two relation filters are merged into one.

### Timezones, and why the grid is not "local"

This is the part that is quietly wrong in most calendars. A post is stored as an
instant; a cell is a *day*; which day an instant lands on depends entirely on
the zone you ask in. 01:00 IST on the 6th is still the 5th in UTC, so a grid
built in UTC files that post a day early — every time, for everyone.

Two ways out: render in the reader's own zone, which means rendering on the
client and living with a server/browser disagreement at hydration; or pick one
zone, render on the server, and say on screen which zone it is. **This takes the
second.** The grid is deterministic, two people opening the same link see the
same thing, the page stays a Server Component, and the header reads
*times shown in GMT+5:30*.

`lib/social/calendar.ts` is therefore pure and parameterised by an IANA zone
rather than reaching for the runtime's. It holds the grid arithmetic (on a
midday-UTC proxy, so adding days cannot trip over a DST transition), day
bucketing via `Intl`, and `startOfZonedDay`, which converts a calendar day back
to an instant by measuring and correcting its own guess — twice, because the
correction can itself cross a DST boundary. 20 unit tests cover it, including
New York on both sides of the November switch and a round-trip of all 31 days
of a month.

`CALENDAR_TIME_ZONE` is one constant. When clients in other markets need their
own it becomes a column on `Client`; every function already takes the zone as
an argument, so that change is a thread, not a rewrite.

### Four views

| View | Range | Card |
|---|---|---|
| Month | Six rows, always — a grid that changes height makes the page jump | Compact |
| Week | Mon–Sun | Compact |
| Day | One day | Full |
| List | The month proper, days with nothing omitted | Full |

The month and week views deliberately show a **compact** card — platform code,
time, title. The full card with its creative thumbnail needs width a seventh of
the grid does not have; the first browser pass had it in the week view and it
wrapped into unreadable fragments.

Month and list page by month but do not share a range: the month grid draws
borrowed days from the neighbouring months, so its query has to cover all 42
cells or a card is missing from a cell that is plainly visible. The list spans
the month only. Both are asserted.

All calendar state — view, period, every filter — lives in the query string, so
a planner can send somebody a link to exactly what they are looking at. Every
field falls back rather than failing: `?view=grid` shows the month.

### Filters

Platform, format, stage, status, campaign, project, owner. Platform and format
are narrowed to what the client's connected accounts can actually carry, so the
list holds no dead options. Client is not a filter — it is the route.

### Consolidation done on the way

`STAGE_LABEL` was a verbatim duplicate of `CONTENT_STAGE_LABEL`, and `STAGE_TONE`
existed in two files that **disagreed**: internal review was navy on one screen
and amber on the other, approved green in one place and navy in the next. Now
one `CONTENT_STAGE_TONE` beside the label map it belongs with. `POST_TYPE_LABEL`,
`POST_STATUS_LABEL`, `POST_STATUS_TONE` and `PROVIDER_SHORT` likewise moved into
`lib/social/capabilities.ts`, removing a component that imported a tone map from
a sibling page component.

### Demo data, without a fake integration

`seedSocialContent` adds five ideas and seven versions to Northwind Studio,
anchored to the current month so the calendar is never empty. It creates **no**
`SocialAccount` rows and nothing is `SCHEDULED`: an account exists only after a
real OAuth handshake, and a seeded row with an invented token is precisely the
fake integration the brief rules out. The accounts tab still says *not
connected*, which is true.

### Verified in a browser

All four views at 1440px and the month view at 375px: no page errors, no
horizontal page overflow. Two defects found this way and fixed:

- **Two versions of one idea were indistinguishable.** The 18th carried an
  Instagram and an X post, both at 11:00, and the compact card showed neither
  platform — two identical rows. The compact card now leads with `IG` / `X`.
- **The undated panel ignored the filters.** Filtering the calendar to LinkedIn
  left an Instagram card sitting in *Written, not scheduled* below it, which
  reads as the filter not having taken. `unscheduledPosts` now takes the same
  filters as the grid — while keeping its own `scheduledFor: null` clause, which
  a test pins, since letting an idea-level filter overwrite it would pull dated
  work into the panel.

The week view was also rebuilt from full to compact cards after the first pass
showed them wrapping.

Gate: lint, typecheck, **1535 tests across 94 files**, production build — clean.

### Next

Phase 5 is approval and the client portal: routing a version to the client for
sign-off, and the portal side of it, scoped by session rather than by any
`clientId` the browser sends.

---

## 7. Phase 5 — client approval

### There was already an approval system

`Approval`, `ApprovalVersion`, `requestApproval`, the admin approval screens,
the portal list and the portal decision form all existed — and `Approval`
already had a `contentItemId`. So this phase writes **the same rows**, and the
question was only what those rows could not yet carry.

Two things, as it turned out, and both were integrity problems rather than
missing screens.

### What "approved" was actually worth

`decideApproval` read `contentItemId` and never used it. A client could approve
a post and the content item would sit at `CLIENT_REVIEW` forever — the calendar,
the content list and the portal each telling a different story about whose desk
the work was on, and approved work unable to be scheduled because its stage
never moved. The decision now moves the stage in the same transaction:
approved → `APPROVED`, changes requested → `DRAFT`. It consults
`canTransitionContent` first, so a decision on a stale approval cannot drag an
item that has since moved on backwards.

Worse: nothing recorded **what** was approved. A creative approval was one file
and a note, so pointing at the live row was fine. A social approval is several
platform versions whose captions stay editable, and pointing at those degrades
"the client approved this" into "the client approved something that used to be
here" the first time a caption is tweaked after sign-off.

Three defences now, and they are deliberately layered:

1. **A snapshot.** `ApprovalVersion.snapshot` holds a frozen copy of the
   versions as sent — validated by `socialSnapshotSchema` on write, parsed on
   read, falling back to null for the ordinary creative approvals that have
   none. The portal renders the snapshot, never the live posts.
2. **A lock.** A version cannot be edited while its item is at `CLIENT_REVIEW`.
   Editing underneath a reviewer means they approve something they never saw.
3. **A reopen.** Editing a version *after* sign-off moves the item back to
   `INTERNAL_REVIEW`. Otherwise "approved" survives the approval being made
   untrue, and the item could be scheduled and published carrying words nobody
   agreed to. The approval row keeps its history — it *was* approved, and that
   happened; what moves is the item.

### Withdrawing

The lock needs an escape hatch, or spotting a typo after sending leaves a choice
between editing underneath a reviewer and waiting for a decision on copy you
already know is wrong. `WITHDRAWN` is a new `ApprovalStatus`: not `PENDING`,
which would leave the portal asking for a decision on something no longer
offered, and not `REJECTED`, which is the client's word and not the agency's to
put in their mouth. The version stays on the record — withdrawing is an event,
not an erasure.

### Refusing to send rubbish

`requestSocialApproval` checks readiness before it will send: at least one
version, each with words or a creative, and a creative wherever the **format**
demands one — a reel is a video wherever it is posted, so
`TYPES_REQUIRING_MEDIA` keys off the post type rather than the platform. The
client's attention is the scarcest thing in the loop and an empty carousel
spends a round of it.

A second round reuses the same approval rather than opening a new one, so the
client sees one thread with its history instead of a fresh item in their list
every time something is re-sent. Each round keeps its own snapshot.

### What the client sees

`components/portal/social-versions.tsx` renders the snapshot: platform, format,
account name, scheduled time, creatives, caption, hashtags, mentions, link,
call to action, first comment. No post ids, no account ids, no internal status —
and a token could not reach it even if one were asked for, because the snapshot
has no field to carry one. A test asserts the serialised snapshot contains none
of `accessToken`, `refreshToken`, `token`, `accountId` or `clientId`.

### Consolidation done on the way

`Record<ApprovalStatus, …>` label and tone maps existed **ten times** across
four approval screens and the content item page. Adding `WITHDRAWN` broke all
ten at compile time, which is exactly what an exhaustive map is for; they are
now one `APPROVAL_STATUS_LABEL` / `APPROVAL_STATUS_TONE` pair in
`lib/projects/lifecycle.ts`.

### Verified in a browser

Signed in as staff, sent a LinkedIn version to the client with a note; signed in
to the portal as the client, saw the platform version rendered with its caption,
approved it; returned to admin and saw the stage read `APPROVED`. Confirmed in
the database: item `APPROVED`, approval `APPROVED`. No page errors on either
surface, no horizontal overflow at 1440px or 375px.

Three things the browser found:

- **The send button was clickable when the stage forbade it.** The panel already
  printed "content at idea cannot be sent for review" underneath, then let the
  click through to an error. Now disabled, with the reason and what to do about
  it.
- **The readiness check fired for real**, refusing an Instagram reel with no
  creative — which is also why the demo seed's reels and carousels cannot be
  sent: they genuinely have no creative attached.
- **The editor stayed locked and unlocked correctly** around the round trip.

> **Two environment traps worth recording**, both of which cost time here.
>
> `DATABASE_URL` and `TEST_DATABASE_URL` both pointed at `emporia_test`
> locally — audit finding **F6** — so running the suite deleted the dev
> homepage row and `/` began 404ing. `tests/global-setup.ts` promises a
> *separate* database; locally it had none. Dev now has its own `emporia_dev`.
> **F6 is closed.**
>
> And `next build` bakes `.env` into the standalone bundle, so changing
> `DATABASE_URL` does nothing until you rebuild — the server went on serving the
> old database while `.env` said otherwise. Related: the standalone runner's
> cache lives at `.next/standalone/.next/cache`, not `.next/cache`, so the
> advice in §5 to clear `.next/cache` clears a directory that does not exist.

Gate: lint, typecheck, **1552 tests across 95 files**, production build — clean.

### Next

Phase 6 is the publishing engine: taking an approved, scheduled version and
actually putting it on the platform, exactly once.
