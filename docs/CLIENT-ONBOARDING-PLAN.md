# Client Onboarding — Plan

**Status: built (2026-10-04).**

A new client signs in to the portal and sees what is left to set up:

```
Welcome to <agency> 👋
Let's get your account ready.
✓ Company details      ○ Website access     ○ Google Analytics
✓ Brand assets         ○ Search Console     ○ Social accounts
○ Business information
Account setup: 70%
```

## What exists today (audit)

- Portal users cannot upload anything; the upload path (`media.service`
  presign → confirm, bytes sniffed, opaque keys) requires `media.upload`.
- `Client` has name, industry, website and a logo. There is nowhere to keep a
  legal name, address, public phone or opening hours.
- `SocialBrandProfile.brandColors` already holds a client's colours.
- Social accounts and Search Console are connected by staff only.
- GA4 is not built (SEO Intelligence Phase 9).

## Decisions

| | Decision |
| - | - |
| Website access | **No passwords.** The client adds the agency's access email as a user on their site and confirms the platform and login URL. Nothing secret is stored. |
| Google | **The client connects Search Console from the portal** (Google sign-in, the Phase 2 connection, same domain and verification checks). **GA4**: the client gives the property ID and confirms access; data arrives in SEO Phase 9. |
| Social | **Staff connect; the client lists their profiles** and sees which are connected. |
| Brand assets | **Portal upload** through the existing verified upload path: JPEG, PNG, WebP, PDF only (no SVG from clients — untrusted XML), plus brand colours. |

## Model (additive)

- `ClientBusinessProfile` — durable facts about the business, reused later by
  Local SEO (NAP): legal name, tax ID, address, public phone and email,
  opening hours, service areas, Google Business Profile link.
- `ClientOnboarding` — the setup itself: website platform, login URL and
  access confirmation; GA4 property ID and confirmation; listed social
  profiles; steps staff marked *not applicable*; when it completed.
- `ClientBrandAsset` — a client's uploaded file (logo, guidelines, other) →
  `Media`, scoped by `clientId`.

## Completion — derived, never ticked

| Step | Complete when |
| - | - |
| Company details | legal name, industry, website, address line, city and country |
| Brand assets | at least one logo and one brand colour |
| Website access | platform chosen and access confirmed |
| Google Analytics | property ID given and access confirmed |
| Search Console | one of the client's websites has a connected Search Console |
| Social accounts | profiles listed and every listed platform has a connected account |
| Business information | public phone, address and opening hours |

Percent = complete ÷ applicable. Only staff can mark a step not applicable.
Reaching 100% the first time notifies the client's account owner.

## Isolation

Every portal read and write is scoped by the session's `clientId`. Uploads
are tied to the uploader and the client; a brand asset is only ever listed
for its own client. The Search Console flow from the portal checks the
property belongs to the signed-in client, in the route and again in the
service; the OAuth state records that it came from the portal, so a portal
state cannot complete a staff flow or another client's.

## As built

- **Portal:** `/portal/onboarding` (one card per step, each saving on its own,
  progress bar, jump links), a welcome checklist on the portal home until
  setup is complete, and an *Account setup* nav item badged with the steps
  left. Forms keep what was typed after a refusal.
- **Services:** `lib/services/onboarding.service.ts`; step rules in
  `lib/onboarding/steps.ts`; validation in `lib/validation/onboarding.ts`.
  Reading never writes (the onboarding row appears on the first save).
- **Uploads:** `presignUpload`/`confirmUpload` — the media library's own
  checks (signed intent bound to the uploader, size, sniffed bytes, opaque
  keys) without the library permission; the portal narrows types to JPEG,
  PNG, WebP and PDF, caps a client at 20 files and 20 uploads per 10
  minutes. The first logo becomes the client's logo; a later one does not
  replace it. Removing a file soft-deletes its media.
- **Search Console from the portal:** `/api/portal/google/connect` resolves
  the client's property from the session (creating it from the website
  given in Company details if there is none), signs `via: "portal"` into
  the state, and the shared callback completes a portal state only for a
  portal user — and the service re-checks the property is that client's.
  The connection core (`*For` functions in `gsc-connection.service`) is
  shared with the staff flow, so the domain and verification checks are
  identical.
- **Staff:** `/admin/clients/[id]/onboarding` (linked from the client page
  with its percentage): steps, everything the client gave, brand files and
  colours, listed social profiles against connected accounts, links to
  connect social and Search Console, *Not needed* per step (`clients.edit`),
  and the agency access email (`settings.edit`, SiteSetting
  `onboarding.accessEmail`) that clients are asked to add to their website
  and Analytics.
- **Completion:** the first time every applicable step is done,
  `completedAt` is stamped, audited, and the account owner gets an in-app
  notification — once.

Not done here, deliberately: GA4 data (SEO Phase 9), connecting social
accounts from the portal (decided against), and storing any password.
