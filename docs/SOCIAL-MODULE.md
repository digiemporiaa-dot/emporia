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

Phase 3 is content and platform versioning: the editor where one idea becomes
an Instagram post, a LinkedIn post and a Google Business Profile post, each with
its own copy.
