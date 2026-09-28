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

---

## 8. Phase 6 — the publishing engine

### Exactly once, and how it is actually guaranteed

The brief's hardest line is "a post must never be published twice". That
guarantee does not come from being careful. It comes from one conditional
update:

```sql
UPDATE "SocialPost" SET status = 'PUBLISHING'
 WHERE id = $1 AND status IN ('SCHEDULED', 'FAILED')
```

Postgres serialises that. Exactly one caller sees a row affected, and only that
caller goes on to call the platform. Two overlapping cron runs, a cron
overlapping a person pressing **Publish now**, two people pressing it at once —
they all contend for one row in one transaction, and all but one lose. No queue,
no lock table, no advisory lock, and no check-then-act window to lose a race in.

`SocialPublication.idempotencyKey` is the second belt, `post:<id>:<attempt>` —
**derived, not random**, which is the whole point of an idempotency key. A
replayed attempt collides on a unique index rather than recording a second
publication that never happened. The attempt number is in the key because a
genuine retry *should* be allowed a new row: a failure and its later success are
two real events and the history is worth keeping.

Two tests fire concurrent publishes and assert the double received exactly one
`POST /posts`. That assertion, not the prose above, is the guarantee.

### Retrying, and the one failure that must never be retried

A failed publish is safe to retry. An **ambiguous** one is not. LinkedIn
accepting a post and returning no id is the real case: the post exists, we
simply do not know its id, and a retry would put a second copy on the client's
feed. `AmbiguousPublishError` exists for exactly that, and the engine treats it
as terminal — no automatic retry, and a message telling a person to go and look.
A human checking one feed is cheap; a duplicate on a client's LinkedIn is not.

Everything else retries up to `MAX_ATTEMPTS`, and rests at `FAILED` rather than
being put back to `SCHEDULED` — a post sitting at scheduled with three failures
behind it reads as fine on every screen. A person may retry past the ceiling:
the ceiling exists to stop a cron hammering a broken platform, not to stop
somebody who has just fixed the problem.

### What it refuses to do

Checked **before** the claim, so a post that cannot go out is never left
stranded in `PUBLISHING`: no account, an account needing reconnection, an
account for the wrong platform, an unconfigured provider, and — the one that
ties the phases together — an idea the client has not approved.

That last check is defence in depth rather than the primary guard. Phase 3 will
not let a version be scheduled unless its idea is approved, and Phase 5 pulls an
item back out of `APPROVED` the moment its copy is edited. So copy that has
drifted from what the client signed off cannot reach here. It is re-checked
anyway, because this is the last gate before something becomes public and
irreversible.

### LinkedIn, for real

`publish` is implemented against the Posts API (`/rest/posts`), not the older
`ugcPosts`. Notes worth keeping:

- The `LinkedIn-Version` header is required, and without it LinkedIn answers
  **426 Upgrade Required**, which does not read like the missing header it is.
  The version is pinned rather than tracking latest, so LinkedIn's breaking
  changes land on our schedule.
- The post id comes back in the `x-restli-id` **header**; the body is empty.
- Images are a three-step dance: register an upload, PUT the bytes, reference
  the returned URN. Uploads happen **before** the post is created, so a broken
  creative cannot produce a text-only post nobody asked for — there is a test
  asserting no `/posts` call is made when the upload fails.
- Hashtags are appended to the end of the copy, which is where LinkedIn expects
  them, rather than being expected inline in the caption.

### UTM tagging

Links are tagged by the service, never by an adapter and never by hand in a
form. Two reasons: attribution has to be consistent or §9's campaign reporting
compares differently-labelled traffic and calls it a trend; and a person typing
`utm_source=linkedin` will eventually type `Linkedin`, which lands as a second
source in every report forever. Campaign names are flattened once
(`Diwali Sale` → `diwali-sale`).

The rule is **only add what is missing**: a link already carrying a `utm_source`
was tagged deliberately by somebody, and overwriting it would discard their
intent. Non-http schemes are left alone rather than decorated.

### The scheduler

`publishDuePosts` hangs off the existing `/api/cron` endpoint rather than
introducing a second scheduler. Pages and social posts are settled
independently, so one batch failing wholesale does not cost the other its run,
and the response reports both. The scheduler acts as a SYSTEM actor with exactly
`social.view` and `social.publish` — the same pattern `schedulerActor` already
uses for pages — so the audit trail records automation rather than a person, and
there is no permission bypass anywhere.

One client's broken account does not stop another client's launch: posts are
worked one at a time and a crash is caught per post.

### Verified in a browser

The success path is covered by 23 database tests running the **real** LinkedIn
adapter against a local wire double — it cannot be exercised in a browser here,
because a genuine post requires a genuine OAuth connection, and faking one is
the thing the brief rules out. What the browser verified is the honest-refusal
path, which is what an operator without a connected account actually meets:

- **Publish now** appears on a scheduled version and reads **Try again** on a
  failed one.
- Pressing it with no connected account produces "No account is connected for
  this version", the post stays `SCHEDULED`, no publication row is written, and
  nothing claims success.
- The attempt history renders: `#1 failed · scheduler · 28 Sept, 11:35 am` with
  the platform's reason under it.
- `/api/cron` answers 401 without the secret and with a wrong one, and returns
  the combined page and social result with the right one.
- No page errors; no horizontal overflow at 1440px or 375px.

One defect found and fixed, the same class as Phase 5's: **Publish now was
enabled with no account connected**, offering a click that could only fail. Now
disabled, with the reason in its tooltip.

Gate: lint, typecheck, **1597 tests across 98 files**, production build — clean.

### Next

Phase 7 is the scheduler's own screen — a queue view of what is due, what
failed, and what is waiting — and the retry and bulk actions that belong with
it.

---

## 9. Phase 7 — the publishing queue

`/admin/social/queue`. Phase 6 made publishing correct; this makes it
**operable**.

### The gap this phase found

Building the screen surfaced a real bug in Phase 6. The claim flips a post to
`PUBLISHING` before calling the platform. If the process dies in between — a
deploy, a container restart, an OOM, all of which happened during this build —
the post stays `PUBLISHING` forever: `publishDuePosts` selects only `SCHEDULED`
and `FAILED` so nothing picks it up, and `publishNow` refuses it because it
looks like it is in flight. Invisible and stuck.

The tempting fix is to time it out and retry. **That is wrong.** We genuinely do
not know whether the platform received the post, and retrying could put a second
copy on a client's feed — the same ambiguity `AmbiguousPublishError` exists for.
So a stranded post is *surfaced, never auto-resolved*: it goes to the top of the
queue, and a person opens the account, looks, and says which it was. Guessing on
their behalf is the one thing that cannot be undone.

That also required a fix in the engine: the claim now stamps `lastAttemptAt` at
the **start** of an attempt, not only on completion. Left as it was, a retry
carried the previous attempt's timestamp and would be called stranded the moment
it began.

### The bands

Ordered by how much a person is needed, which is not the same as ordered by
time:

| Band | Meaning |
|---|---|
| Interrupted | In `PUBLISHING` past the timeout. Blocked on a human. |
| Failed, out of retries | The scheduler has given up. |
| Failed, will retry | Progressing on its own; shown, not actionable. |
| Publishing now | Genuinely in flight. |
| Due | Waiting only for the next scheduler run. |
| Scheduled | Later. |
| Published this week | Confirmation that the thing works. |

Splitting the two failure bands matters: a screen that lumps them together makes
an operator check rows that are already handling themselves.

`STUCK_AFTER_MS` is fifteen minutes, deliberately generous. An image upload to a
slow platform can legitimately take a while, and calling a live publication
stranded while it is still running would invite exactly the duplicate this is
trying to prevent. `resolveStrandedPost` refuses outright if the attempt is
still inside that window.

### Agency-wide, and the scoping that required

This is the one screen in the module where the client is a **filter** rather
than the route. "Is anything broken right now" is not a question you answer one
client at a time.

That needed a second scoping helper. `resolveClientScope` demands a named client;
`resolveScopeFilter` returns a `where` fragment and lets staff leave it unnamed
to span everything. A portal user never can — they get their own client whatever
they ask for. It is written as two explicit branches rather than an optional
filter somebody could forget to apply, and there are tests for both directions,
including that a portal user naming no client still sees only their own.

### Resolving by hand, without fabricating anything

The stranded dialog offers both answers plainly, with no default and no
recommended one: the system genuinely does not know, and nudging towards either
would be inventing an opinion it has not earned. "It went out" records the post
as published with an optional link; "it did not" puts it back in the queue as a
failure. Either way the open `SocialPublication` row is closed so the history
does not show an attempt that never ended, and the audit payload carries
`resolvedByHand: true` — this state came from a person looking at a platform,
not from the platform, and the record says so.

This is not fake data. Somebody looked.

### Bulk retry

Sequential, not parallel. These all hit third-party APIs, and firing fifty at
once is how an agency gets itself rate limited across every client at the same
moment. Each failure is reported separately rather than the batch collapsing on
the first one.

### Verified in a browser

Seeded one post into each interesting state and worked the screen:

- The header reads `1 interrupted · 2 failed · 1 due · 3 scheduled`, and every
  band renders with its reason and the right action — **Say what happened** on
  the interrupted one, **Retry** on the exhausted one, nothing on the one
  retrying itself, **Publish now** and unschedule on the due one.
- The stranded dialog offers both answers plainly, with no default and nothing
  nudging towards either. Answering "it did not go out" moved the post back to
  failed and the band disappeared.
- "Published this week" hides itself when empty rather than showing an empty
  card.
- The client filter drives the URL (`?clientId=…`), so a view is shareable.
- No page errors; no horizontal overflow at 1440px or 375px.

> **On the gate for this phase.** The Bash tool was unavailable for several
> turns mid-build (a safety-classifier outage affecting every command, including
> `git status`), so four small edits — three type tightenings in
> `queue-board.tsx` and removing a `.catch(() => [])` in `page.tsx` that would
> have swallowed a real query error — were written and reviewed by reading
> before they could be compiled. They were all verified clean once the tool
> returned, before anything was committed.

Gate: lint, typecheck, **1617 tests across 99 files**, production build — clean.

### Next

Phase 8 is analytics: reading metrics back from the platforms that support it,
and the reporting that hangs off them. `SocialMetricSnapshot` has been waiting
since Phase 1, with every metric nullable because absent is not zero.

---

## 10. Phase 8 — analytics

`/admin/clients/[clientId]/social/analytics`, plus a collector on the cron.

### Absent is not zero

The whole phase is organised around one rule, and it is not a stylistic
preference. LinkedIn tells us likes and comments for a member's post and will
**not** tell us impressions, reach or clicks — those need an organisation page
and `r_organization_social`, which this integration does not have. X reports
nothing at all on the tier it targets.

Recording those unknowns as `0` would be inventing data, and it compounds
quietly: a zero flows into a sum, the sum into an average, the average into a
slide a client is shown. So:

- every metric column is nullable, and the adapter returns `null` — not `0` —
  for anything the platform did not say;
- a post the platform reported nothing for gets **no snapshot row at all**,
  because a row of nulls would claim we measured and found nothing;
- every total carries how many posts contributed to it, so a sum over 3 of 4
  posts is never presented as a sum over 4;
- a metric nobody reported totals to `null`, and the screen says **"Not
  reported — no platform gave us this figure"** rather than showing a zero;
- the per-platform table uses a dash, with "a dash means the platform did not
  report that figure. It does not mean zero." printed under it;
- platforms that cannot report are marked *no reporting* rather than appearing
  to have scored nothing.

Returning plausible zeros from `getMetrics` would have been the single easiest
way to put invented numbers in front of a client, and it would have looked
finished.

### Collection

One snapshot per post per day — `@@unique([postId, capturedOn])` makes a second
run in the same day update rather than duplicate, which is right because
engagement is cumulative on every platform here. Collection stops after
`COLLECT_FOR_DAYS` (14): engagement is mostly settled within a fortnight, and
asking about a six-month-old post every night spends the API budget that gets
posts out.

Sequential, like Phase 7's bulk retry and for the same reason. It runs on the
existing `/api/cron` after publishing — a post going out in this run is worth
asking about on the next one, and reading metrics must never delay something
going live. A metrics failure is logged and reported but never makes the
endpoint look like publishing broke.

### The report

Stat tiles and tables, **no charts**. Four headline numbers are a KPI row, not a
grouped bar chart; a ten-metric per-platform breakdown is a table, because ten
series is past the point anyone can tell colours apart — and the brand palette
is navy, red and white, which has no categorical hues to spend anyway.

"Engagement" ranks the top posts and appears nowhere else. It is a sum of
whatever happened to be reported, so it is comparable between two posts on the
same platform and not across platforms that count different things — the screen
says exactly that. Posts with no figures are left out of the ranking rather than
ranked zero.

### A structural fix on the way

The report is a client component and needs the metric keys and labels, but they
were sitting in a `server-only` service — which failed the build by dragging the
database into the browser bundle. They moved to `lib/social/metrics.ts`:
constants both sides need are not service internals. Same lesson as the label
consolidation in Phase 4.

### Verified in a browser

With four published posts and figures for three of them:

- Impressions and Clicks read **"Not reported — no platform gave us this
  figure"**; Likes and Comments show real totals with *from 3 of 4 posts* under
  each.
- The coverage note reads "1 of 4 posts have no figures yet."
- The platform table shows dashes with the disclaimer, and the ranking lists
  only posts that actually reported something.
- The period control drives the URL (`?range=7d`).
- No page errors; no horizontal overflow at 1440px or 375px.

Gate: lint, typecheck, **1639 tests across 100 files**, production build — clean.

### Next

Phase 9 is AI content assistance — drafting captions per platform, through the
existing `AIService`, as drafts that are always editable and never auto-posted,
and never permitted to invent a metric.

---

## 11. Phase 9 — AI caption drafting

One new task on the existing `AIService`: `draftSocialPost`. No second AI path,
no direct provider call, no new abstraction — it joins the same budget table,
the same audit trail, the same `Draft<T>` wrapper and the same `AIDraft` frame
every other assist uses.

### It cannot publish, and it cannot invent

Two hard rules from the brief, and both are structural rather than hoped for.

**Always a draft.** The action returns the caption to the browser and writes
nothing. The editor puts it in the form and a person still presses save. A test
asserts that drafting creates zero `SocialPost` rows.

**No invented numbers.** The system prompt opens with it, before anything about
tone, so a model truncating its context keeps the rule that matters: no metrics,
percentages, rankings, awards, prices, timescales or claims of results — and no
invented offers, discounts, deadlines or guarantees, which is the same failure
wearing a different hat. If the brief has no number, the caption has none. A
test pins that ordering, and the screen says the same thing to the operator in
plain words.

Drafting from an *empty* idea is refused outright. A caption written from
nothing is not assistance, it is invention with a progress spinner.

### The capability table, again

The prompt is built from `CAPABILITIES`, so the model is told the platform's
real character limit and asked only for the fields that platform accepts. The
parse then enforces it rather than trusting it: a caption over the limit is
truncated (over-length is unusable, and keeping it pushes the failure to
7:30pm), hashtags are dropped for a platform that has none, and a headline is
dropped where there is no headline field.

Hashtags are normalised exactly as the editor normalises typed ones, so `#Festive`
from the model and `Festive` from a person cannot become two different tags.

### Verified in a browser

The control appears on each version with its own steer field, states the
no-invention rule to the operator, and is hidden entirely when AI is not
configured rather than offering a button that fails. No page errors, no
overflow.

Gate: lint, typecheck, **1652 tests across 101 files**, production build — clean.

### Next

Phase 10 is automation and notifications: telling people when something needs
them, using the automation engine that already exists.

---

## 12. Phase 10 — notifications and automation

Two mechanisms, deliberately kept apart, because they answer different
questions.

**Notifications** are for facts that always need a person, however the agency
has configured things: a post failed, the client answered. These are not rules.
An agency that had to *build a rule* to find out its client had rejected a post
would find out too late.

**Automation triggers** are for what an agency wants to decide for itself —
email the account manager, tag the client, create a task. Those belong in the
rules engine that already exists, which now has three social triggers in its
vocabulary: `SOCIAL_POST_PUBLISHED`, `SOCIAL_POST_FAILED` and
`SOCIAL_APPROVAL_DECIDED`.

### What gets a notification, and what does not

| Event | Notified | Why |
|---|---|---|
| Post failed | Owner, project manager, whoever requested approval | Somebody must know, and the queue link is in the message |
| Client approved or asked for changes | Owner and requester | The most expensive silence in the workflow — it blocks everything downstream |
| Post published | **Nobody** | Good news is not an interruption. Automation can act on it; a person is not pinged. |

Recipients are deduplicated, because in a small team the owner is often also the
project manager and two identical notifications read as a bug. A test pins that.

### Announcements cannot undo what they announce

Every function here runs **outside** the transaction and swallows its own
errors. By the time `announcePublished` is called the post is already on a
client's feed; letting a failed notification roll that back would make the
database disagree with the world. A test calls each one with an id that does not
exist and asserts it resolves rather than throws.

### What the rules can and cannot see

Social facts are read fresh at fire time like every other fact block, so a rule
judges the post as it now stands: platform, format, title, campaign, account,
attempts, client name, plus the failure reason or the client's decision where
those apply.

The caption is deliberately **not** a condition field. A rule matching on post
copy is a content filter dressed as automation, and captions are long. There is
a test asserting it stays absent.

### Verified in a browser

The rule editor at `/admin/automation/new` offers all three social triggers by
name — "A social post goes out", "A social post fails to publish", "A client
decides on social content" — so a rule built on them fires against something
real rather than an enum value nothing raises. No page errors, no overflow.

Gate: lint, typecheck, **1663 tests across 102 files**, production build — clean.

### Next

Phase 11 is reports: the client-facing view of everything phases 8 and 9
measured.

---

## 13. Phase 11 — the client's report

`/portal/social`. The client's own view of what went out and what it did.

### One set of numbers, not two

The agency's report and the client's report share `lib/social/report.ts` — the
totals, the "measured" test and the engagement sum all live there, and both
services call them. That is not tidiness. An agency looking at one number while
its client looks at a different one for the same week is worse than neither
screen existing, and the way that happens is two aggregations drifting apart
over a year of small edits. A test asserts the two surfaces return identical
totals for the same data.

They differ only in authorization, and that difference is the point: staff pass
a permission check and may name a client; a portal user is scoped by their
session and the browser never names a client at all.

### What a client is not shown

Only **published** posts. Drafts are not theirs to see, and a post that failed
to publish is the agency's problem to fix rather than the client's to discover
in a report. Both are tested.

"Absent is not zero" holds on this side too, and matters more here: a client
shown a zero they did not earn is being misled just as surely as one shown an
invented figure. A metric no platform reported reads *"Not reported — the
platform does not share this figure with us"*, an unmeasured post reads *"Not
reported"* rather than scoring zero, and a standing note explains that a missing
figure means unreported, not nil.

A genuinely measured zero survives as a zero — there is a test for that too,
because collapsing the two would be the same mistake in the other direction.

### Verified in a browser

Signed in as the demo client: the nav carries Social, the headline tiles show
real totals with *across 3 of 4 posts* and "Not reported" where nothing came
back, the explanation is present, and the published list shows per-post
interactions or "Not reported". No page errors, no overflow at 1280px or 375px.

> **A testing trap worth recording.** Six database tests in this phase reported
> as *skipped*, which reads like "no database configured" — the same shape as a
> deliberately skipped suite. They were not skipped: a `beforeAll` was throwing,
> and Vitest reports a failed suite hook that way. The cause was mine —
> `Project.code` is capped at 20 characters and the test suffix was 19, so
> `${SUFFIX}-A` and `${SUFFIX}-B` truncated to the same code and the second
> client's project collided. Worth knowing twice over: skipped can mean broken,
> and a truncated unique key fails as a collision rather than as a truncation.

Gate: lint, typecheck, **1673 tests across 103 files**, production build — clean.

### Next

Phase 12 is hardening: a pass over the whole module for the things twelve
phases of building tend to leave behind.

---

## 14. Phase 12 — hardening

A pass over the finished module rather than a feature.

### The sweep

Four things were checked across every social service, mechanically rather than
by memory:

- **Tokens.** No `accessToken` or `refreshToken` is selected anywhere outside
  `credentialsFor`, which remains the only decryption path. Clean.
- **Scoping.** No `clientId` from input reaches a query without going through
  `resolveClientScope` or `resolveScopeFilter`. The one apparent hit was
  `social-settings`, where `clientId` is an OAuth *app* id, not a `Client` id —
  a naming collision, not a leak.
- **Validation.** Every server action Zod-parses before it does anything.
- **Guards.** Six exported functions have no permission check. All six are
  correct — the two scheduler entries have no actor and are reachable only
  through the cron secret, and the four internal helpers are consequences of
  already-authorised work — but "correct because of where it is called from" is
  exactly the property that rots. Each now says so in its own doc comment, so
  the next person to import one reads why before they do.

### A wide isolation test to go with the deep one

Phase 1 left `social-isolation.db.test.ts`, which proves isolation and
credential safety deeply for accounts. `social-isolation-sweep.db.test.ts` goes
wide instead: it walks **every** social read that takes a client — content,
calendar, queue, approvals, analytics, publications, the portal report — and
asserts that a portal user of client B is refused or returned nothing, both when
naming client A explicitly and, the quieter failure, when naming nobody at all.

The portal user in that test holds **every** social permission a staff member
could. Permissions must not be what keeps them out; the scope must be.

There is a deliberate control test: staff *can* still see the client they asked
for. Without it the whole file would pass on a module that shows nobody
anything.

### Rate limiting the human

The scheduler had `MAX_ATTEMPTS` to stop it hammering a broken platform. A
person pressing **Publish now** had nothing, and a bulk retry across a bad
account is the same load from the platform's side. Being rate limited by
LinkedIn costs every client, not just the one being retried. Manual publishing
is now capped at 30 a minute per user, through the same Postgres-backed limiter
the login endpoint uses.

### Audit finding F5, closed

`SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD` were declared in `.env.example` and
the env schema with nothing reading them. Closed by documenting rather than
building: the keys stay, because CLAUDE.md §3 says shipping is architected for
and §14 says the example file carries every key, but both places now say plainly
that nothing reads them and that setting them does not enable shipping. The
finding was never that the keys existed — it was that they looked like a working
integration.

> **A mistake worth recording.** Writing the sweep, I created it as
> `social-isolation.db.test.ts` — a filename Phase 1 had already used — and
> overwrote 18 existing tests covering account isolation and credential safety.
> Nothing failed: the suite went green at 1661, and green is what a
> careless reader would have accepted. It was caught only by noticing the total
> had *fallen* from 1673 while six tests had just been added. The file was
> restored from git and the sweep renamed. Two lessons: check whether a file
> exists before writing it, and treat a falling test count as a failure even
> when every remaining test passes.

Gate: lint, typecheck, **1679 tests across 104 files**, production build — clean.

### The module, finished

Twelve phases. What exists now: per-client social accounts connected by real
OAuth, content with a version per platform written against that platform's own
rules, a calendar, client approval with a frozen snapshot of what was approved,
a publishing engine that cannot publish twice, an operable queue, analytics that
say "not reported" rather than zero, AI drafting that cannot invent a number or
publish anything, notifications and automation triggers, and a client-facing
report that shares its arithmetic with the agency's.

What deliberately does not exist: adapters for Instagram, Facebook, YouTube, X
and Google Business Profile. LinkedIn is implemented end to end; the rest report
their capabilities honestly and refuse every call, because a half-written
adapter that silently no-ops is worse than a screen that says *not configured*.
Each is a phase of its own when someone wants it.

---

## 15. After the module: a review, and what it found

With all twelve phases merged and 1679 tests green, the whole module's diff
(77 files, ~11,000 lines) was put through an independent code review. It found
ten real defects the tests had not. Each was confirmed against the code — two
by writing a failing test first — before being fixed.

The uncomfortable lesson is in the first one: the module's most important rule
was broken, and a test claiming to guard it was passing.

### The two ways a post could still go out twice

**An ambiguous failure was retried by the next cron run.** `AmbiguousPublishError`
existed precisely for "the platform may have this post", and the engine did
return `willRetry: false` for it — but nothing *stored* that. The row said
`FAILED` with one attempt, and the next run selected it, claimed it and posted
again. The Phase 6 test only checked the return value, so it passed while the
behaviour was wrong. A new test asserts the thing that matters: the second run
makes zero `POST /posts` calls. It failed before the fix.

**A timeout on the create call counted as an ordinary failure.** If LinkedIn
accepted a post and the reply was lost — the textbook ambiguous case on a
non-idempotent request — the engine retried it. Now a network failure or a
**504** on that one call is ambiguous; a 500, which means nothing was created,
still retries. A test double that accepts the post and never answers proves it.

The fix is one new column, `SocialPost.ambiguous`, and one consistent rule: an
ambiguous post is treated exactly like a stranded one. It is excluded from the
scheduler, from bulk retry, and from **Publish now** — even for a person, even
from the editor. It sits in the queue's **Needs checking** band until someone
looks at the platform and records what happened. The flag is part of the claim's
`WHERE`, not just a check above it, so a flag set concurrently still stops the
claim.

### Copy the client never approved

- Editing copy un-approved an idea only at `APPROVED`. At `SCHEDULED` — also
  approved, and legally reachable — the copy stayed freely editable right up to
  publication. Both stages now un-approve, and the idea's scheduled versions
  drop back to draft so the calendar stops promising they are about to go out.
- `PUBLISHED` was in the stages the engine would publish from. The only thing
  that could license was a version added *after* publication, which the client
  had never seen. Removed.
- The staff approval screens bypassed every Phase 5 invariant. A staff **New
  version** on social content created a notes-only version with no snapshot and
  left the item outside client review, so its copy stayed editable while the
  client "reviewed" it — now refused, pointing at the social page. A staff
  **Approved** decision left the item stuck at `CLIENT_REVIEW`, where nothing
  could edit, re-send or withdraw it — it now moves the stage through the same
  `stageAfterDecision` rule the portal uses, moved into `lib/projects/lifecycle`
  so both paths share it. The service's decision type no longer admits
  `WITHDRAWN`, which it had silently started accepting when that status was
  added.

### The engine

- **Stranded by a stale attempt number.** The attempt was computed from a row
  read before the claim. A person's retry failing in between bumped the count,
  the scheduler's attempt then collided on the idempotency key, and the code
  returned without releasing its claim — leaving the post stuck in
  `PUBLISHING`. The claim now increments the count atomically, and a failed
  insert hands the claim back, since nothing has been sent yet.
- **Tokens were never refreshed.** Nothing called `refresh()`. A LinkedIn token
  reached its sixty-day end and every post failed "reconnect the account" while
  the accounts screen said healthy. `usableCredentials` now refreshes within a
  day of expiry, and a revoked token — typed as `CredentialsRejectedError`
  rather than matched by message — marks the account `NEEDS_RECONNECT` through
  the existing `recordSyncResult`, from both the publisher and the nightly
  metrics collector. Such a post is not retried: three attempts with a revoked
  token buy three failures.

### Data and honesty

- **Editing from the delivery calendar wiped an item's campaign.** That form has
  no campaign field; `undefined || null` turned "not mentioned" into "cleared".
  It also never checked a campaign belonged to the client, so a crafted request
  could file one client's content into another's campaign reporting.
- **LinkedIn declared fields it silently dropped.** `callToAction` and
  `mentions` are gone from its capabilities — member posts have no button, and a
  typed name is not a mention LinkedIn will link. `firstComment` was real enough
  to build: it is now posted under the share once it is live, and a failed
  comment is a *warning* on a published post, never a failure — failing a live
  post would invite the retry that duplicates it.
- **Reports silently truncated.** The portal summed the newest 200 posts, the
  admin report the newest 500, and both presented the result as the period's
  total. Both now aggregate everything up to a 10,000-post cap, and say so on
  screen if the cap is ever hit. A test with 205 posts proves the old portal cap
  is gone.

### Smaller things found along the way

- The queue's counts and **Retry all** ignored the platform filter. Bulk retry
  now carries it, never touches an ambiguous post, stops cleanly at the
  publishing rate limit and reports what it left for later, and its toast says
  what actually happened instead of "Retried every failure".
- A broken post notified its owner on every retry. Now once when it first
  fails, and again when it stops retrying on its own.
- The client-decision notification linked to the delivery calendar's page, which
  shows neither the versions nor the approval panel.
- Resolving an uncertain post as "it went out" never marked its idea published
  when it was the last version.
- The editor offered **Try again** on an ambiguous post; it now explains the
  state and points at the queue.

### Verified

Test count rose from 1679 to **1706** — exactly the 27 added, none lost. In a
browser: the ambiguous post sits under **Needs checking** with its reason,
**Retry all** counts only the safe failure, the editor explains the state and
offers no retry on it, and resolving it moves it back into the retry band. The
band title was shortened after the first screenshot showed it wrapping and
pushing its count onto a line of its own.

Gate: lint, typecheck, **1706 tests across 104 files**, production build — clean.
