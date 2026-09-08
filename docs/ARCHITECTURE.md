# Architecture Plan

**Phase 1 deliverable. No implementation.** This document is the design Phase 2
onwards will build against. It requires approval before any code is written.

Read `CLAUDE.md` first — every rule there constrains what follows. Where this
document makes a choice CLAUDE.md left open, the choice is marked **Decision**
and repeated in §19.

---

## 1. Current architecture vs proposed

**Current: none.** The Phase 0 audit found an empty repository — zero commits,
no `package.json`, no schema, no auth, no routes. There is nothing to migrate,
nothing to preserve, and no legacy constraint on the design. The only files in
the repo are `CLAUDE.md` and `docs/BUILD-PLAN.md`, committed at the end of
Phase 0.

This is a greenfield build, so "migrate, don't bulldoze" (CLAUDE.md §2 rule 10)
has no work to do in Phase 2. It starts applying from Phase 3, where each phase
must avoid breaking the phases before it.

**Proposed** is a single Next.js 15 App Router application, one Postgres
database, three route groups over one shared service layer:

```
                    ┌───────────────────────────────────────┐
   public web ────► │  app/(website)   RSC, cached, SEO      │
   staff      ────► │  app/admin       RSC + client islands  │
   clients    ────► │  app/portal      RSC, clientId-scoped  │
                    └──────────────────┬────────────────────┘
                                       │  server actions / route handlers
                                       │  → zod → authz → service
                    ┌──────────────────▼────────────────────┐
                    │  lib/services    ALL business logic    │
                    └──────────────────┬────────────────────┘
                                       │  prisma
                    ┌──────────────────▼────────────────────┐
                    │  PostgreSQL 16    one database         │
                    └───────────────────────────────────────┘
```

The three surfaces share **services, not components** (CLAUDE.md §5). A portal
page and an admin page that both show an invoice call the same
`invoice.service`, with different actors, and render different components.

---

## 2. Stack pins

Phase 0 found two version traps. These are the pins Phase 2 will use.

| Package | Pin | Why |
|---|---|---|
| `next` | `15.5.25` | CLAUDE.md §3 mandates Next 15. 16.3.4 is stable but out of spec — see §19 D1. |
| `react` / `react-dom` | `19.x` | Required by Next 15. |
| `prisma` / `@prisma/client` | `7.10.0` (both, exact) | **`prisma@latest` is `8.0.0-rc.12`, a release candidate.** A bare install would pull an RC into a production build. Both packages pin to the same stable version. |
| `decimal.js` | `10.6.0` | CLAUDE.md §2 rule 1. |
| `zod` | `4.5.4` | CLAUDE.md §2 rule 4. |
| `next-auth` | `5.0.0-beta.32` | Auth.js v5 is still beta; CLAUDE.md §3 asks for it explicitly. Accepted risk — see §19 D4. |
| `tailwindcss` | `4.3.3` | CSS-first config suits the token system in CLAUDE.md §6. |
| `framer-motion` | latest 12.x | §6 motion. |
| `lucide-react` | latest | §3. |
| `argon2` | latest | Password hashing — see §19 D2. |
| `vitest` | latest 3.x | §18 testing. |

Renovate/Dependabot is out of scope until Phase 17.

---

## 3. Repo layout

Exactly as CLAUDE.md §5 specifies. Additions this plan introduces, and why:

```
lib/
├── money/          # Decimal helpers, rounding policy, tax, serialization
├── actor/          # Actor type + context assembly (session + ip + ua)
├── attribution/    # UTM cookie read/write, first/last touch resolution
├── errors/         # typed AppError hierarchy; never leaks stack traces
└── config/         # env parsing via zod, server-only, fail-fast at boot
```

`lib/config` matters more than it looks: it is the single place env is read,
validated with zod at startup, and marked `server-only`. It is how CLAUDE.md §2
rule 6 ("no secrets client-side") is enforced structurally rather than by
discipline — a `NEXT_PUBLIC_` leak becomes a review-visible change to one file.

---

## 4. Schema conventions

These apply across every model below. They are stated once here rather than
repeated per domain.

### 4.1 Money

Every monetary column is `Decimal @db.Decimal(14, 2)`. Never `Float`, never
`Int` paise. Percentages (tax rate, discount rate) are
`Decimal @db.Decimal(6, 3)`. Currency is an enum column defaulting to `INR`,
stored per-document (invoice, proposal, contract) so historical records keep
their currency.

All arithmetic goes through `lib/money`, never inline. That module owns:

- `add/sub/mul/div` over `Decimal`
- the **rounding policy**: half-up to 2dp, applied once at line-total and once
  at document-total, never at intermediate steps
- `lineTotal(qty, unitPrice, discount)`, `taxOf(base, rate)`, `documentTotals()`
- `toMoneyString(Decimal): string` for the RSC boundary

**Serialization rule.** Prisma returns `Decimal` instances. These are not
serializable across the RSC → client component boundary. Services return
`Decimal`; any value crossing into a `"use client"` component is converted with
`toMoneyString` first. Client components receive strings and never do money
arithmetic. This is a hard rule — a `number` cast anywhere in the money path is
a rejected change.

### 4.2 Identifiers, timestamps, soft delete

- Primary keys: `String @id @default(cuid())`.
- Every model: `createdAt DateTime @default(now())`,
  `updatedAt DateTime @updatedAt`.
- Soft delete on `Lead`, `Client`, `Invoice`, `Media` (CLAUDE.md §7):
  `deletedAt DateTime?`, indexed.

**Soft-delete enforcement.** Scoping lives in the **service layer**, not in a
Prisma client extension. An extension silently rewrites `findMany` but does not
cover raw queries, nested reads, or aggregations, so it produces a false sense
of safety exactly where it fails. Instead each soft-deleted domain exposes its
queries through its service, which applies `deletedAt: null` by default and
requires an explicit `{ includeDeleted: true }` option to see the rest.
Trade-off: it relies on nobody calling Prisma directly from a route — which is
already forbidden by CLAUDE.md §4 layer discipline and is checkable in review.

### 4.3 Indexes

Index every foreign key, every column filtered or sorted in a list view, and
every slug. Named compound indexes where list queries are known:
`@@index([status, createdAt])` on `Lead`, `@@index([clientId, status])` on
`Invoice`, and so on. Unique constraints on all slugs and on
`(serviceId, cityId)` per CLAUDE.md §7.

### 4.4 The `Seo` relation

CLAUDE.md §9 requires one reusable `Seo` relation across eight entity types.
Two ways to do that:

- **Polymorphic** — `Seo.entityType` + `Seo.entityId`. Rejected. It cannot have
  a foreign key, so referential integrity is gone, cascades must be hand-rolled,
  and CLAUDE.md §1 requires every arrow to be a real FK.
- **Owner-holds-FK** — each indexable entity carries
  `seoId String? @unique` + `seo Seo? @relation(...)`. **Chosen.** Real FKs,
  real cascades, trivial `include: { seo: true }`, and one `Seo` table.

The cost is that `Seo` does not know its owner. That is acceptable: ownership
always flows downward from the entity, and no query needs to start at `Seo`.

### 4.5 Audit

Every privileged mutation writes an `AuditLog` row inside the same transaction
as the mutation, so an audit gap cannot outlive a successful write. Services
receive an `Actor` (§9.1) carrying `ip` and `userAgent` and record actor,
action, entity type, entity id, `before`/`after` JSON, IP, and timestamp.

---

## 5. Enums

Given by CLAUDE.md §7 verbatim:

```
LeadStatus     NEW CONTACTED QUALIFIED PROPOSAL NEGOTIATION WON LOST NURTURE
Priority       LOW MEDIUM HIGH URGENT
ProposalStatus DRAFT SENT VIEWED NEGOTIATION ACCEPTED REJECTED
ContractStatus DRAFT SENT SIGNED ACTIVE EXPIRED TERMINATED
ProjectStatus  PLANNING ACTIVE ON_HOLD COMPLETED CANCELLED
ProjectHealth  ON_TRACK AT_RISK DELAYED
InvoiceStatus  DRAFT SENT PARTIALLY_PAID PAID OVERDUE CANCELLED
ContentStage   IDEA DRAFT INTERNAL_REVIEW CLIENT_REVIEW APPROVED SCHEDULED PUBLISHED
PublishStatus  DRAFT PUBLISHED ARCHIVED
```

Added by this plan:

```
UserType            STAFF CLIENT
UserStatus          ACTIVE INVITED SUSPENDED
RoleName            SUPER_ADMIN ADMIN SALES_MANAGER SALES_EXECUTIVE
                    MARKETING_MANAGER CONTENT_MANAGER PROJECT_MANAGER STAFF
Currency            INR USD EUR GBP AED
LeadSourceType      WEBSITE_FORM POPUP PHONE EMAIL REFERRAL ADS SOCIAL
                    WALK_IN IMPORT OTHER
OpportunityStage    DISCOVERY SCOPING PROPOSAL NEGOTIATION WON LOST
PopupTrigger        PAGE_LOAD TIME_DELAY SCROLL_PERCENT EXIT_INTENT BUTTON_CLICK
PopupFrequency      EVERY_VISIT ONCE_PER_SESSION ONCE_PER_DAY ONCE_PER_WEEK
                    ONCE_PER_USER
PopupTargetType     GLOBAL PAGE SERVICE CITY SERVICE_CITY PACKAGE
PopupEventType      IMPRESSION VIEW FORM_START SUBMISSION CONVERSION
VisitorType         NEW RETURNING ANY
DeviceType          DESKTOP TABLET MOBILE ANY
BillingType         ONE_TIME MONTHLY QUARTERLY ANNUAL RETAINER
BillingCycle        MONTHLY QUARTERLY HALF_YEARLY ANNUAL
TaskStatus          TODO IN_PROGRESS BLOCKED IN_REVIEW DONE CANCELLED
MilestoneStatus     PENDING IN_PROGRESS COMPLETED
ApprovalStatus      PENDING CHANGES_REQUESTED APPROVED REJECTED
ContentChannel      INSTAGRAM FACEBOOK LINKEDIN BLOG YOUTUBE EMAIL ADS
CampaignPlatform    GOOGLE_ADS META_ADS LINKEDIN_ADS SEO EMAIL
                    SOCIAL_ORGANIC OTHER
CampaignStatus      DRAFT ACTIVE PAUSED COMPLETED
PaymentStatus       PENDING CAPTURED FAILED REFUNDED PARTIALLY_REFUNDED
PaymentGateway      RAZORPAY BANK_TRANSFER CASH CHEQUE UPI OTHER
RetainerStatus      ACTIVE PAUSED CANCELLED EXPIRED
MediaType           IMAGE VIDEO DOCUMENT
EmailStatus         QUEUED SENT FAILED BOUNCED
EmailTemplateKey    NEW_LEAD LEAD_ASSIGNED FOLLOW_UP STAFF_INVITATION
                    PASSWORD_RESET PROPOSAL_SENT PROPOSAL_ACCEPTED
                    INVOICE_SENT PAYMENT_RECEIVED PAYMENT_REMINDER
                    CLIENT_NOTIFICATION
NotificationChannel IN_APP EMAIL WHATSAPP SMS PUSH
AutomationTriggerType  LEAD_CREATED LEAD_STATUS_CHANGED LEAD_ASSIGNED
                       PROPOSAL_SENT PROPOSAL_ACCEPTED PROPOSAL_REJECTED
                       INVOICE_SENT INVOICE_OVERDUE PAYMENT_RECEIVED
                       PROJECT_CREATED TASK_OVERDUE
AutomationActionType   ASSIGN_LEAD CREATE_LEAD_TASK SEND_EMAIL NOTIFY_USER
                       CREATE_CLIENT CREATE_PROJECT CREATE_PROJECT_TASKS
                       SET_LEAD_STATUS ADD_TAG
RedirectType        PERMANENT_301 FOUND_302 TEMPORARY_307 PERMANENT_308
SchemaType          NONE ORGANIZATION WEBSITE SERVICE LOCAL_BUSINESS
                    ARTICLE FAQ_PAGE
AuditAction         CREATE UPDATE DELETE RESTORE LOGIN LOGIN_FAILED LOGOUT
                    ASSIGN STATUS_CHANGE SEND PUBLISH UNPUBLISH
AttributionTouch    FIRST LAST
```

`NotificationChannel` includes `WHATSAPP SMS PUSH` because Phase 12 asks for
them to be *architected*. The enum values exist; no sender is implemented.
Selecting them raises a typed "channel not configured" error — never a silent
success.

---

## 6. Data model outline

Compact notation: `→` is a foreign key, `⇢` optional FK, `[idx]` marks indexed
columns beyond the implicit FK indexes. Full Prisma syntax lands in Phase 2.

### 6.1 Identity

```
User            id, email @unique, passwordHash, name, avatar⇢Media,
                type UserType, status UserStatus, roleId→Role,
                departmentId⇢Department, clientId⇢Client,
                lastLoginAt, [email, type, roleId, clientId]
Role            id, name RoleName @unique, label, description, isSystem
Permission      id, key @unique ("leads.assign"), resource, action, description
RolePermission  roleId→Role, permissionId→Permission, @@id([roleId,permissionId])
Department      id, name @unique, slug @unique
```

`User.clientId` is the spine of client isolation (§10). Staff have `null`;
portal users carry the client they belong to. `type` makes the distinction
explicit rather than inferred from a null check.

One role per user. Multi-role is not in the spec and adds resolution ambiguity;
extending later is an additive join table. See §19 D5.

### 6.2 CRM

```
Lead        id, name, email, phone, company, message, budget Decimal(14,2)⇢,
            currency, status LeadStatus, priority Priority, score Int,
            sourceId→LeadSource, serviceId⇢Service, cityId⇢City,
            packageId⇢ServicePackage, popupId⇢Popup, campaignId⇢Campaign,
            firstTouchId⇢UTMTracking, lastTouchId⇢UTMTracking,
            assignedToId⇢User, convertedClientId⇢Client, deletedAt⇢,
            [status, createdAt], [assignedToId, status], [sourceId],
            [cityId, serviceId], [deletedAt], [score]
LeadSource      id, name, slug @unique, type LeadSourceType, isActive
LeadActivity    id, leadId→Lead, actorId⇢User, type, summary, meta Json,
                [leadId, createdAt]
LeadNote        id, leadId→Lead, authorId→User, body
LeadTask        id, leadId→Lead, assigneeId→User, title, dueAt,
                status TaskStatus, priority, completedAt, [assigneeId, dueAt]
LeadAssignment  id, leadId→Lead, fromUserId⇢User, toUserId→User, assignedById→User,
                reason, [leadId, createdAt]
Tag             id, name @unique, slug @unique, color
LeadTag         leadId→Lead, tagId→Tag, @@id([leadId, tagId])
```

`LeadAssignment` is a history table, not the current state —
`Lead.assignedToId` is current, `LeadAssignment` is the audit trail of every
handoff. Both exist because Phase 7 requires reassignment history.

### 6.3 Content and local SEO

```
Service         id, slug @unique, name, shortDescription, body Json,
                icon, heroMediaId⇢Media, status PublishStatus,
                order Int, seoId⇢Seo @unique, [status, order]
City            id, slug @unique, name, state, country, latitude, longitude,
                population, isActive, order, seoId⇢Seo @unique, [isActive]
ServiceCityPage id, serviceId→Service, cityId→City, @@unique([serviceId,cityId]),
                localIntro, marketContext, industries Json, positioning,
                ctaHeading, ctaBody, status PublishStatus, publishedAt⇢,
                seoId⇢Seo @unique, [status], [cityId, status]
Page            id, slug @unique, title, status PublishStatus, seoId⇢Seo @unique
PageSection     id, pageId→Page, type, order, content Json, [pageId, order]
BlogPost        id, slug @unique, title, excerpt, body Json, coverId⇢Media,
                authorId→User, categoryId⇢BlogCategory, status PublishStatus,
                publishedAt⇢, readingMinutes, seoId⇢Seo @unique,
                [status, publishedAt]
BlogCategory    id, slug @unique, name, seoId⇢Seo @unique
BlogTag         id, slug @unique, name
BlogPostTag     postId→BlogPost, tagId→BlogTag, @@id([postId, tagId])
CaseStudy       id, slug @unique, title, clientName, summary, body Json,
                serviceId⇢Service, cityId⇢City, coverId⇢Media,
                status PublishStatus, seoId⇢Seo @unique, [status]
CaseStudyMetric id, caseStudyId→CaseStudy, label, value, unit, order
Testimonial     id, authorName, authorRole, company, quote, rating Int,
                avatarId⇢Media, serviceId⇢Service, cityId⇢City,
                status PublishStatus, order
FAQ             id, question, answer, serviceId⇢Service, cityId⇢City,
                serviceCityPageId⇢ServiceCityPage, packageId⇢ServicePackage,
                order, isActive
```

`FAQ` attaches to any of four owners via nullable FKs rather than a
polymorphic pair, for the same integrity reason as §4.4. A check constraint
(added in the Phase 5 migration) requires exactly one owner to be non-null.

`ServiceCityPage` carries the unique-content columns that `canPublish()`
inspects (§13). Its local case studies, testimonials and FAQs come through
relations, not duplicated text.

### 6.4 Commercial

```
ServicePackage  id, slug @unique, name, tagline, serviceId⇢Service,
                price Decimal(14,2), currency, billingType BillingType,
                taxRate Decimal(6,3), isRecommended, status PublishStatus,
                order, seoId⇢Seo @unique, [status, order]
PackageFeature  id, packageId→ServicePackage, label, detail, isIncluded, order
Opportunity     id, leadId⇢Lead, clientId⇢Client, title,
                value Decimal(14,2), currency, stage OpportunityStage,
                probability Int, expectedCloseAt⇢, ownerId→User,
                [stage], [ownerId]
Proposal        id, number @unique, opportunityId⇢Opportunity, leadId⇢Lead,
                clientId⇢Client, title, status ProposalStatus, currency,
                subtotal/discountTotal/taxTotal/total Decimal(14,2),
                validUntil⇢, sentAt⇢, viewedAt⇢, decidedAt⇢,
                version Int, createdById→User, [status], [leadId]
ProposalItem    id, proposalId→Proposal, name, description, quantity Decimal(12,3),
                unitPrice Decimal(14,2), discountRate Decimal(6,3),
                taxRate Decimal(6,3), lineTotal Decimal(14,2), order
ProposalRevision id, proposalId→Proposal, version Int, snapshot Json,
                createdById→User, @@unique([proposalId, version])
Contract        id, number @unique, clientId→Client, proposalId⇢Proposal,
                title, status ContractStatus, value Decimal(14,2), currency,
                startsAt, endsAt⇢, terms, documentId⇢Media,
                signedAt⇢, renewalAt⇢, [status], [clientId]
Client          id, name, slug @unique, industry, website, logoId⇢Media,
                ownerId⇢User, status, convertedFromLeadId⇢Lead,
                deletedAt⇢, [deletedAt], [ownerId]
ClientContact   id, clientId→Client, userId⇢User, name, email, phone,
                designation, isPrimary, [clientId]
```

`ProposalItem.lineTotal` is stored, not computed on read. Money that has been
quoted to a customer must not silently change when the tax logic is edited —
totals are written at save time by `lib/money` and re-verified, never
recalculated for display.

`ProposalRevision.snapshot` stores the full item set as JSON at each version, so
a superseded revision remains readable exactly as sent.

### 6.5 Delivery

```
Project           id, code @unique, name, clientId→Client, serviceId⇢Service,
                  managerId→User, contractId⇢Contract, status ProjectStatus,
                  health ProjectHealth, budget Decimal(14,2), currency,
                  startsAt, dueAt⇢, completedAt⇢, [clientId, status], [managerId]
ProjectTask       id, projectId→Project, parentId⇢ProjectTask, title, description,
                  assigneeId⇢User, status TaskStatus, priority, dueAt⇢,
                  estimateHours Decimal(8,2)⇢, order,
                  milestoneId⇢ProjectMilestone, [projectId, status], [assigneeId, dueAt]
ProjectTaskDependency  taskId→ProjectTask, dependsOnId→ProjectTask, @@id([taskId,dependsOnId])
ProjectMilestone  id, projectId→Project, title, dueAt, status MilestoneStatus, order
ProjectComment    id, projectId→Project, taskId⇢ProjectTask, authorId→User, body
TimeEntry         id, projectId→Project, taskId⇢ProjectTask, userId→User,
                  minutes Int, note, startedAt, [userId, startedAt], [projectId]
ContentCalendarItem id, projectId→Project, clientId→Client, channel ContentChannel,
                  title, brief, stage ContentStage, scheduledFor⇢, publishedAt⇢,
                  ownerId⇢User, mediaId⇢Media, [clientId, stage], [scheduledFor]
Approval          id, clientId→Client, projectId⇢Project,
                  contentItemId⇢ContentCalendarItem, title,
                  status ApprovalStatus, currentVersion Int,
                  requestedById→User, decidedById⇢User, decidedAt⇢,
                  [clientId, status]
ApprovalVersion   id, approvalId→Approval, version Int, mediaId⇢Media, notes,
                  status ApprovalStatus, feedback, @@unique([approvalId, version])
```

`Approval.clientId` is denormalised from the project deliberately: it is the
column portal isolation filters on, and it must not depend on a join being
written correctly at every call site.

### 6.6 Marketing

```
Campaign        id, name, clientId⇢Client, platform CampaignPlatform,
                objective, budget Decimal(14,2), currency, ownerId→User,
                status CampaignStatus, startsAt, endsAt⇢, [clientId, status]
CampaignMetric  id, campaignId→Campaign, date, impressions Int, clicks Int,
                conversions Int, spend Decimal(14,2), revenue Decimal(14,2)⇢,
                source ("MANUAL" | "IMPORT"), @@unique([campaignId, date])
UTMTracking     id, visitorId, source, medium, campaign, term, content,
                landingPath, referrer, device DeviceType, touch AttributionTouch,
                occurredAt, [visitorId, occurredAt], [source, medium]
Popup           id, name, title, body, ctaLabel, ctaHref, formFields Json,
                trigger PopupTrigger, triggerValue Int⇢, frequency PopupFrequency,
                priority Int, isActive, startsAt⇢, endsAt⇢, mediaId⇢Media,
                [isActive, priority]
PopupTarget     id, popupId→Popup, type PopupTargetType, path⇢,
                serviceId⇢Service, cityId⇢City, packageId⇢ServicePackage,
                visitorType VisitorType, device DeviceType, [popupId]
PopupAnalytics  id, popupId→Popup, event PopupEventType, visitorId, path,
                serviceId⇢Service, cityId⇢City, campaignId⇢Campaign,
                utmId⇢UTMTracking, leadId⇢Lead, occurredAt,
                [popupId, event, occurredAt]
```

`CampaignMetric.source` records whether a number was typed by staff or imported.
Nothing writes a metric any other way — CLAUDE.md §2 rule 5 and §16 forbid
fabricated campaign numbers, and this column makes provenance auditable rather
than assumed.

### 6.7 Finance

```
Invoice      id, number @unique, clientId→Client, projectId⇢Project,
             contractId⇢Contract, retainerId⇢Retainer, status InvoiceStatus,
             currency, issuedAt, dueAt, subtotal/discountTotal/taxTotal/total/
             paidTotal/dueTotal Decimal(14,2), notes, deletedAt⇢,
             [clientId, status], [status, dueAt], [deletedAt]
InvoiceItem  id, invoiceId→Invoice, name, description, quantity Decimal(12,3),
             unitPrice Decimal(14,2), discountRate Decimal(6,3),
             taxRate Decimal(6,3), lineTotal Decimal(14,2), order
Payment      id, invoiceId→Invoice, clientId→Client, amount Decimal(14,2),
             currency, gateway PaymentGateway, status PaymentStatus,
             gatewayOrderId⇢, gatewayPaymentId⇢ @unique, gatewaySignature⇢,
             idempotencyKey @unique, rawPayload Json, receivedAt,
             [invoiceId], [clientId, status]
Retainer     id, clientId→Client, name, amount Decimal(14,2), currency,
             cycle BillingCycle, status RetainerStatus, startsAt,
             nextBillingAt, endsAt⇢, [status, nextBillingAt]
```

`Payment.gatewayPaymentId @unique` and `idempotencyKey @unique` are how a
replayed Razorpay webhook fails to double-credit (Phase 13 exit criterion) —
enforced by the database, not by application logic that could race.

`Invoice.dueTotal` is stored and recomputed on every payment inside the same
transaction, so overdue queries are a plain indexed scan rather than an
aggregate over `Payment`.

Three implementation rules that are easy to get wrong and are pinned by tests:

- **Numbering** (`lib/finance/numbering.ts`). `INV-YYYY-NNNN`, allocated inside
  the transaction that writes the row. The next value is the **numeric** max of
  the year's counters, taken with `split_part`. Sorting the numbers as strings
  agrees with numeric order only while the counter has four digits: once
  `INV-YYYY-10000` exists, `…-9999` still sorts highest and every later invoice
  collides on the unique constraint forever.
- **Crediting.** Only `handleWebhook` and `recordManualPayment` move
  `paidTotal`. `/api/payments/verify` checks the browser's checkout signature so
  the page can say something true, and deliberately credits nothing — a callback
  can be forged, and a genuine one is lost when the payer closes the tab.
- **Cancellation reasons** go to the audit log, not to `Invoice.notes`. Notes
  are printed on the client's invoice, so writing a reason there would destroy
  what someone wrote.

### 6.8 Platform

```
Media             id, key @unique (opaque R2 object key), url, filename,
                  mimeType, size Int, type MediaType, width⇢, height⇢,
                  alt, folderId⇢MediaFolder, uploadedById→User,
                  checksum, deletedAt⇢, [folderId], [type], [deletedAt]
MediaFolder       id, name, parentId⇢MediaFolder, path @unique
MediaVersion      id, mediaId→Media, version Int, key, size, uploadedById→User,
                  @@unique([mediaId, version])
EmailTemplate     id, key EmailTemplateKey @unique, subject, html, text,
                  variables Json, isActive
EmailLog          id, templateKey⇢, to, cc⇢, subject, status EmailStatus,
                  error⇢, providerMessageId⇢, entityType⇢, entityId⇢,
                  sentAt⇢, [status, createdAt]
Notification      id, userId→User, channel NotificationChannel, title, body,
                  href⇢, readAt⇢, entityType⇢, entityId⇢, [userId, readAt]
Automation        id, name, description, isActive, order
AutomationTrigger id, automationId→Automation, type AutomationTriggerType, config Json
AutomationCondition id, automationId→Automation, field, operator, value Json, order
AutomationAction  id, automationId→Automation, type AutomationActionType,
                  config Json, order
AuditLog          id, actorId⇢User, action AuditAction, entityType, entityId,
                  before Json⇢, after Json⇢, ip, userAgent, createdAt,
                  [entityType, entityId], [actorId, createdAt]
Seo               id, metaTitle, metaDescription, canonical, ogTitle,
                  ogDescription, ogImageId⇢Media, ogImageAlt,
                  twitterTitle, twitterDescription, twitterImageId⇢Media,
                  robotsIndex Boolean, robotsFollow Boolean, schemaType SchemaType
Redirect          id, fromPath @unique, toPath, type RedirectType, isActive,
                  hits Int, lastHitAt⇢, [isActive]
SiteSetting       id, key @unique, value Json, group
IntegrationSetting id, provider @unique, config Json (non-secret only), isEnabled
```

**`IntegrationSetting` holds no secrets.** Keys live in env, read only through
`lib/config`. This table stores non-sensitive configuration — sender name,
bucket public URL, default currency — so an admin can change behaviour without
a deploy while credentials stay server-side (CLAUDE.md §2 rule 6).

---

## 7. Route map

### 7.1 `app/(website)` — public

```
/                                     home
/about  /contact  /careers            static-ish, DB-backed sections
/privacy-policy  /terms-and-conditions
/services                             index
/services/[serviceSlug]               service detail
/services/[serviceSlug]/[citySlug]    service × city (Phase 5)
/cities  /cities/[citySlug]           city index + detail
/packages  /packages/[packageSlug]    package index + detail
/case-studies  /case-studies/[slug]
/blog  /blog/[slug]  /blog/category/[slug]
/[...landingPage]                     CMS landing pages + redirect fallback
```

> **Noted in Phase 8.** Internal links to any of these dynamic routes must be
> written as template literals — `` href={`/services/${slug}`} ``. `next/link`
> given an object href formats it literally under the App Router, so
> `{ pathname: "/services/[serviceSlug]", query: { serviceSlug: slug } }`
> renders `/services/[serviceSlug]?serviceSlug=seo`. Phases 3 to 7 used the
> object form throughout; every internal link to a dynamic page was therefore
> pointing at a URL that does not exist, and internal linking — a stated SEO
> requirement — was silently broken until Phase 8 converted them all. Crawling
> the site by following its own links, rather than visiting known URLs, is what
> caught it.

`[...landingPage]` is the last-resort match and does double duty: it resolves a
CMS landing page, and failing that consults the `Redirect` table before
returning 404. See §12.4 — this is why no Prisma call is needed in middleware.

### 7.2 `app/admin` — staff

```
/admin                          dashboard
/admin/leads  /admin/leads/[id]  /admin/leads/pipeline
/admin/opportunities  /admin/proposals/[id]  /admin/contracts/[id]
/admin/clients/[id]
/admin/projects/[id]            + /tasks /calendar /approvals
/admin/content/{pages,blog,case-studies,testimonials,faqs}
/admin/catalog/{services,cities,service-cities,packages}
/admin/marketing/{campaigns,popups,utm}
/admin/finance/{invoices,payments,retainers}
/admin/media
/admin/automation  /admin/email-templates
/admin/settings/{site,seo,redirects,integrations,users,roles}
```

### 7.3 `app/portal` — client

```
/portal                         dashboard
/portal/projects/[id]  /portal/tasks
/portal/campaigns  /portal/reports
/portal/files  /portal/approvals/[id]
/portal/proposals/[id]  /portal/contracts/[id]
/portal/invoices/[id]  /portal/payments
/portal/messages  /portal/profile
```

Every one of these resolves its record by `(id, clientId)` where `clientId`
comes from the session — never `(id)` alone. See §10.

### 7.4 `app/auth` and `app/api`

```
/auth/login  /auth/forgot-password  /auth/reset-password/[token]
/auth/invite/[token]

/api/auth/[...nextauth]         Auth.js
/api/popups/resolve             POST, server-side popup targeting (§14)
/api/leads/capture              POST, public form + popup submissions
/api/uploads/presign            POST, authenticated presigned R2 URL
/api/uploads/complete           POST, confirm + persist Media
/api/webhooks/razorpay          POST, signature-verified
/api/cron/{overdue-invoices,retainer-renewals,digest}
/sitemap.xml  /robots.txt       Next metadata routes
```

Route handlers exist only for webhooks, uploads, cron and sitemap/robots
(CLAUDE.md §3) — plus the two POST endpoints above, which are public,
unauthenticated, rate-limited entry points where a server action's implicit CSRF
model does not fit. Everything else in admin and portal is a server action.

---

## 8. Service layer

One module per domain in `lib/services`. Each exports functions taking
`(actor: Actor, input: ValidatedInput)` and returning domain objects.

| Module | Owns |
|---|---|
| `auth` | login, password reset, invitations, session assembly |
| `user`, `role` | staff CRUD, role/permission administration |
| `lead` | lead CRUD, status transitions, conversion to client |
| `leadScoring` | **the single scoring implementation** (budget, service, city, source, engagement) |
| `leadAssignment` | assign/reassign + history + permission checks |
| `leadActivity` | timeline writes; every domain event funnels here |
| `catalog` | services, cities, packages |
| `serviceCityPage` | local pages + **`canPublish()`** |
| `content` | pages, sections, blog, case studies, testimonials, FAQs |
| `opportunity`, `proposal`, `contract`, `client` | sales pipeline |
| `project`, `projectTask`, `milestone`, `timeEntry` | delivery |
| `contentCalendar`, `approval` | content workflow + client sign-off |
| `campaign`, `attribution` | campaigns, metrics, UTM touch resolution |
| `popup` | **server-side targeting resolution**, analytics events |
| `invoice`, `payment`, `retainer` | finance; all totals via `lib/money` |
| `media` | R2 presign, server-side validation, folders, versions |
| `email`, `notification` | templated sends, logging, in-app notices |
| `automation` | trigger → condition → action evaluation |
| `seo`, `redirect`, `sitemap` | metadata resolution, redirect loop detection |
| `analytics` | dashboard aggregations (§15) |
| `audit` | `withAudit()` transaction wrapper |
| `setting` | site + integration settings |

**Shared logic exists once** (CLAUDE.md §4): lead scoring in `leadScoring`,
proposal and invoice arithmetic in `lib/money`, SEO fallbacks in `seo`, popup
targeting in `popup`. A second implementation of any of these is a rejected
change.

**Services never read the session.** They receive an `Actor` and re-check
ownership themselves. This keeps them testable without a request context and
means an automation or cron job runs the same code path as a UI action, with a
system actor.

---

## 9. Auth and RBAC

### 9.1 The `Actor`

```ts
type Actor = {
  userId: string
  type: "STAFF" | "CLIENT" | "SYSTEM"
  roleName: RoleName | null
  clientId: string | null      // non-null for portal users
  permissions: ReadonlySet<string>
  ip: string
  userAgent: string
}
```

Assembled once per request in `lib/actor` from the Auth.js session plus request
headers, then passed explicitly down through actions into services. `SYSTEM` is
the actor used by cron and automation, and it is audited like any other.

### 9.2 Session

Auth.js v5, credentials provider, staff email + password hashed with argon2id.
Cookies `httpOnly`, `secure`, `sameSite: "lax"`. The JWT carries `userId`,
`type`, `roleId` and `clientId` — **identity only, never permissions**.

Permissions are resolved from the database per request, not baked into the
token. CLAUDE.md §8 requires permissions to change without a deploy; a JWT
carrying a permission set would keep granting a revoked permission until the
token expired. To keep that cheap:

- `React.cache()` dedupes the lookup within a single request
- a process-level `Map<roleId, Set<string>>` with a short TTL absorbs the rest,
  invalidated explicitly whenever `RolePermission` is written

### 9.3 Permission checks

```ts
await requirePermission(actor, "leads.assign")   // throws Forbidden
await requireOwnership(actor, clientId)          // throws Forbidden
```

`SUPER_ADMIN` bypasses `requirePermission` and **nothing else does** — including
`requireOwnership`, which has no bypass at all. Both throw typed errors that the
error boundary renders as a clean 403; no stack trace reaches a user
(CLAUDE.md §11).

Permission keys follow `resource.action`. The full seed set is defined in
Phase 2 and mapped to the eight roles in the database.

**Row-level scoping.** `leads.view` grants the list; `leads.view.team` widens it.
`lead.service` resolves this in one place:

```
SUPER_ADMIN                  → all leads
has leads.view.team          → all leads
has leads.view               → where assignedToId = actor.userId
otherwise                    → Forbidden
```

This is the Phase 7 exit criterion (a sales executive cannot see another rep's
leads) and it is a service-layer `where` clause, never a UI filter.

---

## 10. Client isolation

CLAUDE.md §2 rule 3 is the single most testable requirement in the build, so it
gets structural enforcement rather than careful coding.

1. `clientId` **only ever** comes from `actor.clientId`, which comes from the
   session. No portal server action accepts a `clientId` parameter — the zod
   schemas physically do not have the field, so a crafted request cannot supply
   one.
2. Every portal read is `where: { id, clientId: actor.clientId }`. Resolving by
   `id` alone and checking ownership afterwards is forbidden: it leaks existence
   through timing and through error-message differences. A wrong-client id
   returns the same `notFound()` as a nonexistent one.
3. Denormalised `clientId` on `Approval`, `Payment` and `ContentCalendarItem`
   means isolation never depends on a correctly-written join.
4. Nested reads are scoped at the root. Loading a project's tasks goes through
   the client-scoped project, never `projectTask.findMany({ where: { projectId } })`
   with a caller-supplied `projectId`.
5. Portal services live behind a `PortalActor` type that makes `clientId`
   non-nullable, so a staff actor cannot be passed into a portal query by
   accident — the type system rejects it.

Phase 10's exit criterion is a test suite that walks every portal route with a
second client's ids and asserts 404/403 on all of them.

> **Built in Phase 10.** All five rules hold as written, and
> `tests/portal-isolation.test.ts` builds two complete client accounts and calls
> every portal read with the other client's ids. Two things were decided while
> building it. First, the portal deliberately shows less than it could: a
> project's budget, its time entries, its internal comments and its assignees
> are not in the portal payload at all, and content below `CLIENT_REVIEW` and
> proposals still in `DRAFT` are filtered out — isolation is about other
> clients, but a client should also not see the agency's own workings. Second,
> portal accounts get a `CLIENT_USER` role holding **zero** permissions: the
> portal is gated by `type === "CLIENT"` plus the session's `clientId`, never by
> the staff permission catalogue, so a portal account cannot reach an admin
> route even if it somehow arrived at one.

---

## 11. CMS and CRM data flow

The spine from CLAUDE.md §1, as real foreign keys:

```
 visitor lands
   │  UTM cookie written (first touch preserved, last touch updated)
   ▼
 ServiceCityPage / Service / City / ServicePackage      ← CMS content
   │
   ├─ inline CTA form ─┐
   └─ Popup (server-resolved) ─┐
                               ▼
              POST /api/leads/capture
                zod → rate limit → attribution read (server-side cookie)
                               ▼
   Lead ──→ LeadSource, Service, City, Popup, Campaign,
            UTMTracking(first), UTMTracking(last)
     │
     ├─ leadScoring.score()  → Lead.score
     ├─ automation: LEAD_CREATED → assign, task, email, notify
     ├─ LeadAssignment + LeadActivity written
     ▼
   Opportunity ──→ Proposal ──→ ProposalItem / ProposalRevision
                       │ ACCEPTED
                       ▼
                    Contract ──→ Client  (Lead.convertedClientId set)
                                   │
                     ┌─────────────┼──────────────┐
                     ▼             ▼              ▼
                  Project       Campaign      Retainer
                     │             │              │
              ContentCalendarItem  CampaignMetric │
                     │                            │
                  Approval ──→ ApprovalVersion    │
                     │                            │
                     └────────► Invoice ◄─────────┘
                                   │
                                Payment
```

Two properties this guarantees, both of which Phase 14's dashboard depends on:
every lead can name the page, popup, campaign and UTM touch that produced it;
and every rupee of revenue can be traced back through invoice → project →
client → proposal → lead → source → city → service.

---

## 12. SEO architecture

### 12.1 Metadata resolution

One builder, `lib/seo/buildMetadata.ts`, used by every `generateMetadata`. No
template computes its own fallbacks.

```
title        entity.seo.metaTitle
          → generated from entity (name + city + site name)
          → SiteSetting.defaultMetaTitle
description  entity.seo.metaDescription → entity summary → site default
canonical    entity.seo.canonical (admin override)
          → derived from the public URL   ← always correct by default
og:image     entity.seo.ogImage → service/city ogImage → global ogImage
og:image:alt entity.seo.ogImageAlt → media.alt → title
robots       entity.seo.robotsIndex/Follow, forced noindex for
             non-publishable ServiceCityPages (§13)
```

### 12.2 Structured data

`lib/seo/schema.ts` emits JSON-LD **only where the page genuinely contains that
content** (CLAUDE.md §9):

| Schema | Emitted when |
|---|---|
| `Organization`, `WebSite` | root layout, once |
| `BreadcrumbList` | any page with a breadcrumb trail |
| `Service` | service and service-city pages |
| `LocalBusiness` | city and service-city pages, with real city data |
| `Article` | blog posts |
| `FAQPage` | **only if the page renders ≥1 FAQ** |

An empty FAQ list emits no `FAQPage` node. This is enforced in the emitter, so
it cannot be got wrong per-template.

### 12.3 Sitemap and robots

`app/sitemap.ts` queries each publishable entity for `status = PUBLISHED`
(and, for `ServiceCityPage`, `canPublish()` passing) and emits nothing else.
`/admin`, `/portal`, `/auth`, `/api` and every draft are excluded by
construction rather than by a disallow list — they are simply never queried.
`app/robots.ts` disallows those four prefixes and points at the sitemap.

### 12.4 Redirects without middleware

Managed in the DB (`Redirect`), 301/302/307/308, activatable.

The obvious implementation — look up every request in middleware — is rejected.
Next middleware runs on the edge runtime where Prisma cannot run, and forcing it
to Node runtime adds a DB round trip to *every* asset request.

Instead, redirects resolve in the `[...landingPage]` catch-all, which only runs
for paths no real route matched — precisely the old URLs a redirect exists for:

```
[...landingPage] → CMS landing page?  → render
                 → active Redirect?   → redirect(type)
                 → notFound()
```

**Loop detection runs at write time**, not at request time: saving a redirect
walks the chain from `toPath` and rejects the save if it returns to `fromPath`
or exceeds a hop limit. A bad redirect never reaches production data.

> **Added in Phase 2.** A `middleware.ts` does now exist, but it does no
> database work and does not handle redirects — it only checks for a valid
> session JWT on `/admin` and `/portal`. It was needed for the HTTP status
> code: `app/loading.tsx` makes Next stream the shell immediately, so a
> `redirect()` from a layout arrives after the 200 is already on the wire and
> has to be delivered in-band. A browser follows it either way, but the request
> reads as a successful 200 to anything that is not a browser. Checking the
> token on the edge produces a real 307 before rendering starts. The
> reasoning above still holds for redirects: no Prisma on the edge.

> **Noted in Phase 4.** The redirect table stores 301/302/307/308 as the spec
> asks, but Next's `redirect()` and `permanentRedirect()` emit only **307 and
> 308** and cannot be made to emit 301 or 302. A redirect saved as 301 is
> therefore served as 308, and 302 as 307 — the method-preserving equivalents,
> which search engines treat identically (permanent vs temporary). Serving an
> exact 301 would require resolving redirects in middleware, which cannot reach
> Prisma on the edge. `resolveRedirect` returns both `intendedStatus` and
> `servedStatus` so the difference is visible rather than silent, and an admin
> UI should present the choice as permanent vs temporary.

---

## 13. Local SEO and `canPublish()`

`Service × City` is generated from the database. No hand-written city pages
(CLAUDE.md §9).

`serviceCityPage.canPublish(page)` returns `{ ok: boolean, reasons: string[] }`
and is the **only** gate to `PUBLISHED`. It is called by the publish action, by
the sitemap query and by `generateMetadata` (to force `noindex`), so a thin page
cannot become indexable through any path.

Proposed thresholds — **these are business rules and need your sign-off**
(§19 D6):

| Requirement | Threshold |
|---|---|
| `localIntro` | ≥ 120 words, unique across pages for the same service |
| `marketContext` | ≥ 100 words |
| `industries` | ≥ 3 entries |
| local FAQs | ≥ 3 attached |
| local proof | ≥ 1 case study **or** testimonial for that city or service |
| `positioning`, `ctaHeading`, `ctaBody` | non-empty |
| SEO | `metaTitle` + `metaDescription` present and not equal to another page's |

The uniqueness checks are what actually stop templated mass-publishing: a page
whose intro is another city's intro with the name swapped fails on the
cross-page uniqueness comparison, not on word count.

Internal linking is derived from relations — a service-city page links to its
service, its city, sibling cities for the same service, related services in that
city, and case studies matching either. No site-wide link dumps.

---

## 14. Popups, lead capture and attribution

### 14.1 Server-side targeting

`POST /api/popups/resolve` receives page context (path, and where applicable
`serviceId`, `cityId`, `packageId`). The server derives everything else itself:

- **device** from the `User-Agent` header
- **visitor type** from a first-party `visitorId` cookie (new vs returning)
- **frequency state** from an `httpOnly` `popup_state` cookie holding
  `{ popupId: lastShownAt }`

Because frequency state is read server-side, the whole decision — targeting,
scheduling window, frequency cap, priority — happens on the server, and the
response contains **at most one popup**. A client that never receives a popup
payload cannot display it. This is what CLAUDE.md §10 asks for; a design where
the client filters a list of popups would leak every campaign to anyone reading
the network tab.

Ties break on `Popup.priority`, then most recently updated.

### 14.2 Attribution capture

On first request, the server sets `visitorId` and writes a `UTMTracking` row for
the **first touch**; subsequent visits with new UTM parameters write a **last
touch** row. Both are keyed by `visitorId`.

On submission, `/api/leads/capture` reads attribution from the **server-side
cookie and headers**, never from the request body. A client cannot forge its own
attribution, and a form that forgets to include a hidden field still records
correctly.

Recorded per lead where available: UTM source/medium/campaign/term/content,
landing path, referrer, device, popup, service, city, package, campaign.

### 14.3 Analytics events

`PopupAnalytics` records `IMPRESSION → VIEW → FORM_START → SUBMISSION →
CONVERSION`, each carrying popup, path, service, city, campaign and UTM, so
popup performance is queryable inside CRM analytics rather than in a separate
silo.

### 14.4 Accessibility

Focus trap, `Esc` to close, focus restored to the trigger, `role="dialog"`,
`aria-modal="true"`, labelled close control, and no popup at all under
`prefers-reduced-motion` beyond an instant fade.


---

## 14A. Tracking, pixels and consent

### 14A.1 One loader, one answer

Every tracking script on the public site is loaded by
`components/website/tracking/manager.tsx` and nowhere else. "Which pixels run
on this page" is therefore a question answered by reading one file, not by
grepping every route. A provider loads only when all four of these hold:

1. **configured** — an ID is stored;
2. **enabled** — its toggle is on. `publicTrackingConfig` omits the ID of a
   disabled provider entirely, so the browser is never handed something it is
   expected to ignore;
3. **permitted** — consent allows its category;
4. **not already loaded** — `loaders.ts` keeps a module-level registry, so a
   re-render or a client-side navigation cannot initialise a pixel twice.
   Double initialisation doubles page views and conversions, which corrupts the
   numbers a campaign is judged on.

Tag Manager owns what is configured inside it: when a GTM container is on, GA4
and Google Ads are **not** also loaded directly. That is the classic way to
double every conversion.

### 14A.2 Storage

Settings live in `IntegrationSetting`, one row per provider — the existing
provider / `isEnabled` / `config` model, extended rather than duplicated
(CLAUDE.md §2 rule 10). `PROVIDERS` in `tracking.service` is the list; adding a
provider means adding a key there.

Two reads, deliberately different functions rather than one with a flag:

| function | caller | permission | token |
|---|---|---|---|
| `getTrackingSettings` | admin | `settings.view` | masked |
| `publicTrackingConfig` | public site | none, cached | never selected |

`publicTrackingConfig` cannot leak the Conversions API token because it never
fetches it. That is the defence: a mistake in a component cannot expose what the
query did not select.

### 14A.3 The Conversions API token

A bearer credential — anyone holding it can post conversions to the ad account.
It is:

- validated and saved by its **own** action and its **own** form, so it is never
  a hidden field re-posted when someone edits an unrelated toggle;
- encrypted at rest with AES-256-GCM (`lib/tracking/secret.ts`), keyed by a
  SHA-256 of `AUTH_SECRET` — a value that is already required, already
  server-only, and already the thing whose rotation invalidates sessions;
- shown to an admin only as a mask (last four characters);
- absent from every audit row, every log line and every public payload.

Rotating `AUTH_SECRET` makes a stored token undecryptable. `decryptSecret`
returns null rather than throwing, and the admin says so and asks for it again.

### 14A.4 Consent

Three modes — `IMPLIED`, `OPT_OUT`, `OPT_IN` — differing entirely in what
happens *before* a visitor answers. `lib/tracking/consent.ts` is pure and free
of both React and the database, so the rule that decides whether a pixel may
fire is unit tested directly.

The decision is stored in the `emporia_consent` cookie. It is deliberately not
httpOnly: the manager has to read it before any request reaches the server. It
holds a version, two booleans and a timestamp — no personal information.

Changing the consent mode or the banner wording bumps the stored version, and a
decision recorded against an older version no longer counts: the visitor agreed
to something else, so they are asked again.

GTM loads under every mode, because a container is not itself a tag. What it may
then do is decided by Google Consent Mode: `applyGoogleConsent` sends `default`
before the container arrives and `update` whenever the visitor changes their
mind. Every other provider is gated by `PROVIDER_CATEGORY`, one list that
answers "what does rejecting marketing actually stop?".

### 14A.5 Server-side events

`lib/tracking/capi.ts` sends the server copy of a conversion to Meta. It exists
because the browser copy is increasingly lost, and because a payment is
confirmed by a webhook that no browser is present for.

Deduplication is what makes running both safe. Meta collapses two events sharing
`event_name` and `event_id`, so each conversion is counted once. The ids are
never generated per copy:

| conversion | id | browser copy |
|---|---|---|
| `Lead` | a UUID minted by the form, sent to the server in the same request | `fbq('track','Lead',…,{eventID})` |
| `Purchase` | `purchase:<gateway payment id>`, derived | none — the portal loads no tracking |

Because the purchase id is derived, a retried webhook sends the same id and Meta
records one purchase rather than two.

Server-side sending is still tracking, so the routes that do it check consent
first — moving the same data through a different pipe is not a way around a
visitor who said no. Personal data is SHA-256 hashed before it leaves the
process, the token goes in the request body rather than the URL, and every
failure is swallowed: a conversion that cannot be reported must never fail the
payment or the lead that caused it.

### 14A.6 Content-Security-Policy

The policy in `next.config.ts` names the script, connect and frame origins each
provider needs, grouped by provider. Listing an origin only permits it — nothing
loads until a setting is saved and enabled — so the whole set ships together
rather than the policy being edited per launch. Without this every tag would
fail silently.

---

## 15. Analytics

`analytics.service` answers the Phase 14 questions with SQL aggregates —
never by loading tables into the browser (CLAUDE.md §12):

- counts: leads, qualified, won, conversion rate, active clients/projects,
  tasks due/overdue
- money (all `Decimal`): pipeline value, revenue, outstanding, ad spend
- breakdowns by source, city, service, popup, campaign, staff
- revenue by service and by city

Every panel renders an explicit **empty state** when a query returns nothing.
No placeholder numbers, no sample series, no "demo" chart data.

Three rules decide what the numbers mean, and each is pinned by a test:

- **Revenue attribution.** A client's received money is attributed to the *one*
  lead that converted it — the earliest, when several did. Attributing to every
  converting lead would count the same money once per duplicate enquiry.
  `breakdowns` and `revenueByDimension` share the rule, so the two screens
  cannot disagree.
- **Withheld, not hidden.** `analytics.view` and finance permission are
  separate: a marketing manager holds the first and not the second. The service
  returns `revenue: null` for such an actor and the page omits the column
  entirely — the figures never reach the browser, so this is authorization, not
  a hidden element.
- **Null is not zero.** A rate over no leads, a CPC over no clicks, and revenue
  nobody recorded are all `null` and render as "—" or "not measured". Rendering
  `0` would assert a measurement that was never taken (CLAUDE.md §2 rule 5).

Lead figures compose `visibilityFilter` from the CRM, so an actor who may see
only their own leads gets analytics over their own leads rather than a
team-wide total they are not entitled to.

**Where metrics come from.** `lib/reporting` defines the provider boundary
(Google Ads, Meta Ads, GA4, Search Console) and **implements none of them** —
every entry is an unconfigured provider that throws. Until one is implemented,
a `CampaignMetric` row can only be created two ways, both recorded in
`MetricSource`: `MANUAL`, typed in a day at a time, or `IMPORT`, parsed from a
CSV the user exported from the platform. Import validates every row through the
same Zod schema as manual entry and reports each rejected line by number rather
than writing it as zeroes.

---

## 15A. Automation

`trigger → conditions → actions`, with every part a database row rather than
code. A rule is built, tried and switched on in admin; nothing is deployed.

**Where rules run.** `runAutomations` is called *after* the mutation it reacts
to has committed, and it never throws to its caller. An automation must not be
the reason a lead fails to be captured or a proposal fails to be accepted, and a
broken rule is logged and skipped rather than propagated.

**Facts.** Each trigger assembles a flat `Facts` object by reading the record
fresh from the database at fire time — not from what the caller happened to pass
— so a rule judges the record as it now stands. Money arrives as a
fixed-precision string and comparisons go through Decimal, making
"budget is over 500000" exact. `TRIGGER_FACTS` declares what each trigger
provides, and the editor builds its condition dropdown from it, so a condition
cannot be written against a fact that will not be there.

**Wired triggers only.** `WIRED_TRIGGERS` lists the triggers something in the
codebase actually raises. `TASK_OVERDUE` exists in the schema enum and is
deliberately absent: nothing fires it, because there is no scheduler, and
offering it would let someone build a rule that silently never runs.

**Actions check before they act.** Each handler inspects the world first and
returns a sentence describing what it did — including "nothing, because…".
That is what the run log shows. Consequences of this:

- `CREATE_CLIENT` on `PROPOSAL_ACCEPTED` reports that the client already exists.
  Creating it is a transactional part of accepting, not something a rule may or
  may not do; making a second one is the alternative.
- `ASSIGN_LEAD` defaults to `onlyIfUnassigned`, because capture already
  round-robins a new lead and a rule should fill the gap rather than fight
  the CRM.
- `SET_LEAD_STATUS` refuses `WON`. Winning creates a Client through the sales
  flow; reaching it by the side door would leave a won lead with nothing
  behind it.
- `CREATE_PROJECT_TASKS` refuses a project that already has tasks, so a repeat
  firing cannot duplicate a checklist someone is halfway through.

**Stored configs are re-validated at fire time** against the same discriminated
union that validated them on save. A rule written before a config shape changed
fails visibly in the run log instead of reaching a handler that cannot read it.

**Audit is the record.** Every action that changes something writes its own
`AuditLog` row under an actor of type `SYSTEM` — which persists as
`actorId: null`, because no user did it — and each rule run writes one more row
naming the trigger, the subject and every action's outcome. The admin run log is
a read of those rows rather than a second log that could drift from them.

---

## 16. Integration boundaries

Each external system sits behind an interface in `lib/`, with one real provider
implementation and **no fake fallback**:

| Interface | Provider | Phase |
|---|---|---|
| `StorageService` | Cloudflare R2 (S3 presigned) | 11 |
| `EmailService` | SMTP (nodemailer) | 12 |
| `PaymentService` | Razorpay | 13 |
| `ReportingProvider` | Google Ads, Meta Ads, GA4, Search Console — **interfaces only, no implementation** | 14 |
| `AIProvider` | Anthropic (`claude-opus-5`), provider-swappable | 16 |
| `ShippingService` | Shiprocket — **interface only, no implementation** | — |

**Unconfigured behaviour.** When required env is missing, the provider is not
constructed and calls throw a typed `IntegrationNotConfiguredError`. The app
boots, admin shows the integration as disabled, and the operation fails
visibly. It never returns a fake success — CLAUDE.md §2 rule 5.

Specific guarantees:

- **Uploads** — presign requires auth + `media.upload`; the server validates
  size caps, sniffs magic bytes (never trusting extension or client MIME), and
  generates an opaque object key. Phase 11's exit criterion is a spoofed
  extension being rejected.
- **Payments** — Razorpay webhook signature verified before any parsing;
  idempotency by `gatewayPaymentId`/`idempotencyKey` unique constraints; invoice
  status reconciled server-side. A client-side success callback never marks an
  invoice paid.
- **AI** — output always marked AI-generated, always editable, and barred from
  writing `CampaignMetric` rows.

---

## 16A. AI

One provider abstraction (`lib/ai`), six assists (`lib/services/ai.service`),
and a single rule that shapes both: **the model proposes, a person disposes.**

**Nothing is written.** Every assist returns a draft. There is no code path by
which the model writes to the database — a person reads the suggestion, edits
it, and saves it through the ordinary service for that record, which applies
that record's ordinary validation and audit. The lead assessment sits *beside*
the rules-engine score and never replaces it.

**Figures come from the database, and go back to the screen from there.** Each
prompt is handed the facts it may use and is instructed never to produce another
number. Two structural consequences:

- The proposal drafter is given the line *names* and not the line *prices*, so
  a drafted paragraph cannot contradict the priced total on the same page.
- `analyzeCRM` returns the figures it was given alongside the prose, and the
  page renders those, not numbers parsed out of a sentence. Revenue is only in
  the facts when the actor holds `invoices.view`, so the analytics permission
  split (§15) survives into the commentary.

**Empty state beats invented insight.** `analyzeCRM` refuses a period with no
leads rather than asking for commentary on nothing.

**The thin-page rule reaches the draft.** The SEO assist returns the model's own
verdict on whether it had enough to be specific about the city, and the editor
shows a warning when it did not — a draft must not be the reason someone tries
to publish what `canPublish()` (§13) exists to refuse.

**Marked, always.** Every suggestion renders inside one `AIDraft` component that
carries the label, the model id, and the sentence saying nothing was saved. A
new assist cannot forget the marker because it cannot render without it.

**Audited.** Every call records task, model, subject and token usage under
`AIDraft` in the audit trail — the spend is accountable even though nothing was
saved.

**Unconfigured is a first-class state.** With no `AI_API_KEY` the provider is
`UnconfiguredAI`, which throws a typed error; the screens read
`isAIConfigured()` and render no assist buttons at all, with a line saying why.
An `AI_PROVIDER` naming a vendor that is not implemented is treated as
unconfigured rather than guessed at.

---

## 17. Docker, deployment and environments

Deploy target is Coolify, per CLAUDE.md §3. Three concerns: the image, local
development, and what runs at deploy time.

> This section is the *reasoning*. The operator's procedure — variables, Coolify
> steps, first boot, provider configuration, scaling, backups, rollback and
> troubleshooting — is [DEPLOYMENT.md](./DEPLOYMENT.md).

### 17.1 Image

Multi-stage build on **`node:22-bookworm-slim`**, not Alpine. Both `argon2` and
Prisma's query engine ship glibc prebuilds; on musl they either rebuild from
source or need a matching binary target, which turns a routine install into a
recurring build failure. The size difference does not justify that.

```
deps     → npm ci (cached on package-lock.json alone)
builder  → prisma generate → next build   (output: "standalone")
runner   → slim, non-root `nextjs` user, curl for the health probe,
           the full node_modules with .next/standalone laid on top,
           plus .next/static, public/, prisma/, generated/, lib/
```

- `next.config.ts` sets `output: "standalone"` so the server itself carries only
  the traced dependencies.
- Runs as a non-root user, `EXPOSE 3000`, `NODE_ENV=production`.

> **Revised in Phase 2.** This section originally called for
> `binaryTargets = ["native", "debian-openssl-3.0.x"]`. That is obsolete:
> Prisma 7 compiles queries in-process and connects through a driver adapter
> (`@prisma/adapter-pg`), so the image contains **no query-engine binary and no
> OpenSSL dependency to match**. The generated client is TypeScript, emitted to
> `generated/` at build time and gitignored. bookworm-slim is still the right
> base, but now only because `argon2` ships glibc prebuilds.
- `.dockerignore` excludes `node_modules`, `.next`, `.git`, `.env*`, `docs`,
  test output — both for build speed and so a stray `.env` can never enter an
  image layer.

> **Revised after the first production deploy.** The runner used to copy exactly
> three folders out of `node_modules` — `prisma`, `@prisma`, `dotenv` — on the
> theory that the standalone trace covered everything else. It does, for the
> *server*. It does not for the **Prisma 7 CLI** the entrypoint runs, whose
> transitive closure is around 130 packages, `effect` among them. None were in
> the image, so `prisma migrate deploy` died on `Cannot find module 'effect'`
> before `server.js` was ever reached, and every container crash-looped on boot.
>
> `npm ci --omit=dev` is not the fix: `prisma`, `tsx` and `dotenv` are all
> devDependencies, so pruning dev is precisely what removes the CLI. The runner
> now copies the **whole** `/app/node_modules` from the builder and lays the
> standalone output on top of it — order matters, so that Next's traced
> `node_modules` overlays the full tree rather than being overwritten by it, and
> `server.js` still lands at `/app/server.js`.
>
> The same copy is what makes `npm run db:seed` — how the first super admin is
> created — runnable inside the deployed container. Beyond `tsx`, the seed needs
> `generated/` (the Prisma 7 client generator emits TypeScript; the server
> bundle has it compiled in, `tsx` needs the source), `lib/` for the two modules
> `prisma/seed.ts` imports, and `tsconfig.json` to resolve their `@/*` alias.
>
> The cost is image size: roughly 2 GB rather than a few hundred megabytes. That
> is the deliberate trade — a runner that can migrate and seed itself beats a
> small one that crash-loops. If it ever needs to come down, the honest lever is
> a fourth stage that runs `npm ci` for the CLI's closure alone, not another
> guess at which folders the CLI touches.
>
> `curl` is installed in the runner for the same class of reason: the base image
> has neither `curl` nor `wget`, so an HTTP health check — which is what Coolify
> runs — had nothing to execute with and every container reported unhealthy
> while serving fine (docs/DEPLOYMENT.md §4).

### 17.1b The page CMS

Pages are assembled from **sections**, each a row in `PageSection` holding a
`type` and a JSON `content`. Two families share that table:

- **Builder blocks** (`lib/content/blocks.ts`) — fourteen general-purpose types
  an editor can add, edit and reorder. Each owns a zod schema, a label and a set
  of valid defaults.
- **Bespoke bands** (`lib/content/sections.ts`) — `hero`, `positioning`,
  `industries`, `roles`, `legal`. Hand-composed for the homepage, About, Careers
  and the legal pages. They still render and are deliberately *not* offered in
  the builder, which also refuses to edit one.

`SECTION_SCHEMAS` is the union of both, and `parseSections` validates every row
before render, dropping any that does not match its own schema. Bad CMS data
degrades one band, never the page.

**Content is parsed, not trusted.** A section save validates against that
block's schema and stores the *parsed* value, so unknown keys are stripped and a
row can never hold a shape the renderer has not agreed to.

**Rich text is markdown-lite**, not HTML: `**bold**`, `*italic*`, `[text](/path)`,
parsed to React elements by `lib/content/inline.ts`. Nothing in this path reaches
`dangerouslySetInnerHTML`, so there is no sanitiser to keep current and no
stored-XSS surface. External and `javascript:` links render as plain text.

**Images are referenced by `mediaId` alone** and resolved in one batched query
per page (`lib/content/media.ts`), so a replaced or re-described image is correct
everywhere it appears instead of leaving stale URLs in section JSON.

**Reusable sections** are authored once and placed on many pages. The
relationship is a reference: `PageSection.reusableSectionId` plus a snapshot of
the resolved type and content on the row itself. The snapshot means the public
query needs no join, and that a reusable section which is later unpublished or
deleted leaves every placement rendering its last known good state rather than
blanking a band on eleven pages. Saving a *published* one rewrites every
placement in the same transaction; saving a draft does not, so work in progress
never reaches live pages. Deleting one detaches its placements. Unlinking a
single placement makes it an ordinary section, which is how a one-off variation
is made without forking or editing for everyone.

`isGlobal` marks a site-standard band: it sorts first when placing one. Automatic
placement — a global section the site inserts on every page without an editor
adding it — is **not** implemented; the flag is the foundation for it.

**Headings.** Builder blocks cap at `h2` so the document outline survives, and
`PageSections` renders the page title as the `h1` when no section provides one.
`hero` and `legal` provide their own, so the hand-composed pages are untouched.

> **No `loading.tsx` above a route that calls `notFound()`.** This is 17.2's
> trap in a second place: a segment loading boundary also wraps that segment's
> children, and Next streams the shell before the child runs — so a dead
> `/admin/website/pages/<id>` answered **200** with a skeleton instead of 404.
> The admin list skeletons are rendered through an explicit `<Suspense>` inside
> the list page instead, which keeps the loading state and the status code.

### 17.1c SEO across entities

CLAUDE.md 9 requires every indexable entity to carry the full SEO set through
one reusable `Seo` relation. The relation was there from the start; what was
missing was anywhere to edit most of it. Cities had no SEO fields at all,
packages and service-city pages had a meta title and description and nothing
else — so their social cards and indexability were unmanageable.

`lib/services/seo.service.ts` serves every entity carrying the relation, and
`components/admin/seo-fields.tsx` is the single definition of the form, shared
by the page CMS and the catalog screens so they cannot drift into offering
different halves of the same record.

Two properties are deliberate:

- **The entity name is a closed whitelist**, switched rather than indexed. It
  arrives from a form field, and `db[whatever]` would let a caller reach any
  table in the schema.
- **SEO is gated on `seo.edit`, not the entity's own edit permission.** Tuning
  metadata and rewriting a package's price are different responsibilities, and
  the catalogue already separated them.

The meta fields were removed from the entity forms when the panel was added.
Two forms on one screen writing the same column silently revert each other, and
an entity save by someone without `seo.edit` would otherwise wipe metadata they
were never allowed to touch. The entity services now create an empty `Seo` row
on create and never write to it again.

Services, case studies, blog posts and blog categories carry the relation but
have no admin CRUD at all — they are seed-only, so there is no screen to hang a
panel on. They get one when they get a module.

### 17.2 The build-time database problem

This is the one genuinely awkward interaction between Next and containers, and
it needs a decision now because it shapes every SEO route.

`generateStaticParams` runs at **build time**. If service, city and blog routes
use it, `next build` needs a reachable `DATABASE_URL` — which means the CI
builder needs production database access, and the image goes stale as content is
added.

**Proposal:** do not use `generateStaticParams` for DB-driven routes. Render
them dynamically with ISR (`export const revalidate = 3600`) plus on-demand
`revalidatePath`/`revalidateTag` fired from the CMS when content is published.
The build stays hermetic — no DB needed — the first request after a deploy
renders and caches, and publishing content updates the live site within seconds
instead of requiring a rebuild.

Cost: the first hit on a cold path is a dynamic render. For a marketing site
behind a CDN that is a fair trade, and it is the only option that keeps builds
reproducible. See §19 D7.

> **Revised in Phase 3.** Avoiding `generateStaticParams` turned out not to be
> sufficient. A *static* route (`/`, `/about`, `/services`) that reads the
> database is prerendered at build time regardless, so the first website pages
> broke the hermetic build immediately — verified by building with no `.env`.
>
> The working shape is: public routes that read the database are
> `export const dynamic = "force-dynamic"`, and the **data** is cached with
> `unstable_cache` and tags (`lib/content/queries.ts`). The build needs no
> database, the data layer still caches for an hour, and publishing content can
> bust a tag immediately instead of waiting out a TTL. Dynamic routes
> (`[slug]`) keep ordinary ISR.
>
> Two constraints follow. Cached queries must return serialisable values — a
> Prisma `Decimal` would come back as its internal representation, so money is
> converted to a fixed 2dp string at that boundary and dates to ISO strings.
> And there must be **no `loading.tsx` above the public routes**: a loading
> boundary makes Next stream the shell before `notFound()` runs, which answers
> a dead URL with 200 and a skeleton — a real SEO defect, since Phase 4 depends
> on correct status codes.

### 17.3 `docker-compose.yml`

For local development and as the Coolify reference:

```
services:
  db:    postgres:16-alpine
         healthcheck: pg_isready
         volume: pgdata:/var/lib/postgresql/data
  app:   build: .
         depends_on: db (condition: service_healthy)
         env_file: .env
         ports: 3000:3000
         healthcheck: GET /api/health
volumes: pgdata
```

No application volume. The app server filesystem is never permanent storage
(CLAUDE.md §3) — uploads go to R2, and the container is disposable.

`/api/health` is a small addition to the route-handler allowlist in CLAUDE.md §3:
it checks process liveness and a `SELECT 1`, returns no detail on failure, and
exists because both Compose and Coolify need a readiness signal.

### 17.4 Migrations at deploy

The container entrypoint runs `prisma migrate deploy` before starting the
server. `migrate deploy` applies committed migrations only — it never generates
or resets — and Prisma takes a Postgres advisory lock, so multiple instances
starting together do not race.

Seeding is **not** part of the entrypoint. `npm run db:seed` stays a manual
command so a redeploy can never overwrite live data with demo records.

### 17.5 Environments and secrets

`.env.example` carries every key from CLAUDE.md §14 with **no values, ever**.
Real values are injected by Coolify at runtime.

One trap worth stating explicitly: Next inlines `NEXT_PUBLIC_*` variables at
**build** time, so anything public must be present when the image is built, and
anything secret must never carry that prefix. `lib/config` parses env with zod
and fails fast at boot with a clear list of what is missing — a missing
`AUTH_SECRET` should stop the container, not surface as a confusing runtime
error later.

### 17.6 What cannot be verified yet

Phase 0 found **no Docker daemon in this environment** (`/var/run/docker.sock`
absent). Phase 2 can author the `Dockerfile`, `docker-compose.yml` and
`.dockerignore` correctly, but cannot build or run them here. Phase 2 will
therefore run against the native PostgreSQL 16 already available on localhost —
schema, migrations, seed and every application concern are fully verifiable;
only the container build is not. It will be reported as **unverified** until it
can be built on a machine with a daemon, and Phase 17 owns proving it.

---

## 17A. Hardening findings

The Phase 17 sweep and what it changed. Recorded because each one is a rule the
codebase now depends on, not a one-off edit.

**Contrast (AA).** `--color-ink-subtle` was `#6f818b`, measuring 3.59-4.05:1 on
our surfaces — under the 4.5:1 AA needs for normal text, everywhere it was used.
Darkened to `#5c6d77`. The brand red is unchanged and mandatory (§6) for fills,
accents and large type, but at 11px on a tinted surface it measures 4.25-4.31:1,
so `--color-brand-red-text: #c01a2e` exists for small text and is what the
`Eyebrow` and `Badge` primitives use. No red in the system clears AA as small
text on navy — dark panels use `navy-300`.

Measured with axe-core across 17 pages under `prefers-reduced-motion: reduce`.
That setting matters to the measurement, not just to users: the scroll-reveal
animations otherwise leave elements mid-fade when axe samples them, and it
reports the blended colour. A "failure" naming a foreground the stylesheet never
contains is that artefact, not a defect.

**Error messages.** `AppError.message` is the *internal* message when a subclass
supplies one; `publicMessage` is the one meant for a user. Four route handlers
returned `error.message`, leaking the internal text. Route handlers return
`error.publicMessage`; server actions already went through `toActionFailure`,
which was always correct.

**Security headers** are set in `next.config.ts` rather than left to the reverse
proxy, because a header the app depends on should not be a setting someone can
forget in a different system: CSP (Razorpay's checkout script and frame are the
only third-party grants; no `unsafe-eval`), `X-Frame-Options`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`, HSTS.

**Paging.** `lib/paging` is the single definition of the bounds, and every admin
list goes through it. Six lists — proposals, contracts, opportunities,
campaigns, retainers, popups — previously read whole tables, which §12 forbids
once the agency has a few years of history.

**Password reset** (`lib/services/password-reset.service`) closes a gap the
schema and the email template had been carrying since Phase 2. Three properties
make it safe to expose unauthenticated:

- The response is identical whether or not the address exists, including when
  rate limited — a different answer for a real address is an enumeration oracle.
- Only a SHA-256 of the token is stored, so a leaked backup hands over no live
  links. The plaintext exists only in the email.
- The token is cleared in the same `updateMany` that sets the password, matched
  on the token again, so a race loses rather than resetting twice.

**Session revocation.** `currentActor` takes **only the user id** from the JWT
and reads status, role and `clientId` from the database on every request. This
was not always so: it previously trusted the token for all three, and because
sessions are eight-hour JWTs that meant a suspended account kept working, a
demotion did not apply, and a revoked portal user kept reading their old
client's data — all until the token expired. Reproduced before the fix (a
suspended admin session still served `/admin/leads`) and after (bounced to the
login page). The cost is one indexed lookup, deduped per request by `cache()`.

**Login timing.** The "no such user" branch runs a throwaway argon2 verification
so it costs what a real account costs. Without it the uniform error message is
undone by the response time, which answers "is this address registered?" one
request at a time.

**Rate limiting is shared.** `checkRateLimit` writes to Postgres, not process
memory. The increment is one `INSERT … ON CONFLICT DO UPDATE` that also resets
an expired window in the same statement, so neither a second instance nor two
concurrent requests can slip past the limit. Proved two ways: twenty concurrent
calls against a limit of five let exactly five through, and seven real logins
against one address produced five attempts and two refusals from a single
shared row.

**Dependencies carry no known advisories.** `npm audit` reports zero. nodemailer
moved to 10.x (the `raw`-option advisory was never reachable — our `sendMail`
passes only addresses, subject and bodies — but the dependency should still be
current), and `overrides` pin patched `postcss`, `mysql2` and `deepmerge-ts`
under the toolchain that ships them. The overrides exist so the pins in §2
survive: `npm audit fix --force` would have installed Next 16 and *downgraded*
Prisma to 6.

**Not verified here.** The Docker image build could not be run: the sandbox has
the Docker CLI but no daemon. The Dockerfile and compose file were reviewed
statically instead.

---

## 18. Testing strategy

Vitest, with a **real Postgres test database** on the native server (no
testcontainers — that needs the absent Docker daemon). Each suite runs inside a
transaction that rolls back, so tests share one schema without interfering.

Per CLAUDE.md §12, coverage targets:

| Area | What is asserted |
|---|---|
| auth | password hashing, session shape, failed-login handling |
| RBAC | every role × every permission; `SUPER_ADMIN` bypass; own-vs-team lead scoping |
| leads | creation with attribution, assignment, status transitions, scoring |
| money | proposal and invoice totals to the paisa, rounding at boundaries, tax and discount interaction |
| payments | signature verification, **replayed webhook does not double-credit** |
| media | permission gating, spoofed-extension rejection |
| **client isolation** | every portal route probed with a foreign client's ids |
| popups | targeting resolution, frequency caps, priority ties |
| SEO | metadata fallback chain, canonical generation, `canPublish()` |
| sitemap/robots/redirects | no drafts or private URLs; loop detection rejects cycles |

The isolation and money suites are the two that must never be allowed to go
yellow — they encode the requirements whose violation CLAUDE.md §2 says rejects
the work outright.

---

## 19. Risks, unknowns and decisions needed

### Decisions I need from you

| # | Decision | My recommendation |
|---|---|---|
| **D1** | Next.js 15.5.25 (per spec) or 16.3.4 (current stable)? | **15.5.25.** Follow the spec. 16 is young and nothing here needs it. |
| **D2** | argon2 or bcrypt? | **argon2id.** Better resistance; `argon2` has glibc prebuilds, which §17.1 already accounts for. |
| **D3** | Is the missing Docker daemon acceptable — files authored now, built and verified in Phase 17? | **Yes**, given native Postgres covers everything else. |
| **D4** | Auth.js v5 is still beta (`5.0.0-beta.32`). Accept, or use a stable alternative? | **Accept.** CLAUDE.md §3 names it, and the credentials + JWT path is its most stable surface. |
| **D5** | One role per user, or multiple? | **One.** Extending to many is additive later; multi-role now adds resolution ambiguity for no stated requirement. |
| **D6** | Are the `canPublish()` thresholds in §13 the right bar? | They are my proposal, not a spec value — this is a **business rule** and CLAUDE.md §15 rule 6 says ask rather than guess. |
| **D7** | ISR + on-demand revalidation instead of `generateStaticParams` (§17.2)? | **Yes.** It is the only option that keeps container builds hermetic. |
| **D8** | Currency: INR only, or multi-currency from the start? | Schema supports multi (`Currency` enum per document); **default and seed INR**. No FX conversion is planned — flag if you need it. |
| **D9** | Rate limiting store — in-process, or Redis? | **Resolved: Postgres.** In-process was correct for one container and wrong behind two — an attacker got the limit once per instance. The window is now a `RateLimitWindow` row incremented by a single `INSERT … ON CONFLICT DO UPDATE`, so the limit holds across instances and concurrent requests cannot both pass it. Postgres was already a hard dependency; Redis would have been new infrastructure for the same guarantee. |

### Risks

- **Auth.js v5 beta** may ship breaking changes mid-build. Mitigated by pinning
  exactly and keeping session assembly behind `lib/actor`, so a provider change
  touches one module.
- **Prisma `latest` is an RC.** Anyone running a bare `npm install prisma` will
  silently upgrade to 8.0.0-rc. Mitigated by exact pins and a lockfile; worth a
  note in the README.
- **Decimal serialization** across the RSC boundary is the most likely place for
  rule 1 to be violated accidentally. Mitigated by §4.1's string conversion rule
  and money tests.
- **Scope.** Seventeen phases is a large build; the risk is quiet scope creep
  inside a phase. Mitigated by the phase reports and by closing each phase on a
  green typecheck, lint, test and build.
- **No credentials for R2, SMTP, Razorpay or AI.** Those phases will deliver
  interfaces and unit tests but cannot prove an end-to-end send, upload or
  payment. Flagged now so it is not a surprise at Phase 11–13.

### Out of scope until asked

Customer phone OTP and WhatsApp auth (architected only, CLAUDE.md §3);
Shiprocket implementation; e-signature; live ad-platform integrations
(adapter interfaces only, Phase 14).

---

## 20. Phase 2 entry criteria

On approval of this plan, Phase 2 delivers:

1. Next 15 + TypeScript strict + Tailwind scaffold, `lib/config` env validation
2. Full Prisma schema, initial migration, client singleton, seed skeleton
3. Auth.js credentials, argon2id hashing, sessions
4. RBAC: roles, permissions, `requirePermission` / `requireOwnership`, `Actor`
5. Design tokens (colour, type, spacing, radius, shadow, motion) as CSS variables
6. Base UI primitives: button, input, select, dialog, table, toast, card
7. Admin shell with navigation, layout and server-side auth guard
8. `loading.tsx` / `error.tsx` / `not-found.tsx` conventions
9. Structured logging + audit log service
10. `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `/api/health`
    — authored, **build unverified** per §17.6

**Done when** a seeded super admin logs in, reaches an empty admin dashboard,
and a non-permitted role is rejected server-side — with typecheck, lint, tests
and build all passing.
