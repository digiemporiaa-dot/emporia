-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('STAFF', 'CLIENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'MARKETING_MANAGER', 'CONTENT_MANAGER', 'PROJECT_MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('INR', 'USD', 'EUR', 'GBP', 'AED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'NURTURE');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('WEBSITE_FORM', 'POPUP', 'PHONE', 'EMAIL', 'REFERRAL', 'ADS', 'SOCIAL', 'WALK_IN', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'NOTE_ADDED', 'TASK_CREATED', 'TASK_COMPLETED', 'EMAIL_SENT', 'CALL_LOGGED', 'MEETING_LOGGED', 'PROPOSAL_SENT', 'SCORE_CHANGED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('DISCOVERY', 'SCOPING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'NEGOTIATION', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'CHURNED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('ON_TRACK', 'AT_RISK', 'DELAYED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ContentStage" AS ENUM ('IDEA', 'DRAFT', 'INTERNAL_REVIEW', 'CLIENT_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ContentChannel" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'BLOG', 'YOUTUBE', 'EMAIL', 'ADS');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'RETAINER');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY', 'BANK_TRANSFER', 'CASH', 'CHEQUE', 'UPI', 'OTHER');

-- CreateEnum
CREATE TYPE "RetainerStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CampaignPlatform" AS ENUM ('GOOGLE_ADS', 'META_ADS', 'LINKEDIN_ADS', 'SEO', 'EMAIL', 'SOCIAL_ORGANIC', 'OTHER');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "PopupTrigger" AS ENUM ('PAGE_LOAD', 'TIME_DELAY', 'SCROLL_PERCENT', 'EXIT_INTENT', 'BUTTON_CLICK');

-- CreateEnum
CREATE TYPE "PopupFrequency" AS ENUM ('EVERY_VISIT', 'ONCE_PER_SESSION', 'ONCE_PER_DAY', 'ONCE_PER_WEEK', 'ONCE_PER_USER');

-- CreateEnum
CREATE TYPE "PopupTargetType" AS ENUM ('GLOBAL', 'PAGE', 'SERVICE', 'CITY', 'SERVICE_CITY', 'PACKAGE');

-- CreateEnum
CREATE TYPE "PopupEventType" AS ENUM ('IMPRESSION', 'VIEW', 'FORM_START', 'SUBMISSION', 'CONVERSION');

-- CreateEnum
CREATE TYPE "VisitorType" AS ENUM ('NEW', 'RETURNING', 'ANY');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('DESKTOP', 'TABLET', 'MOBILE', 'ANY');

-- CreateEnum
CREATE TYPE "AttributionTouch" AS ENUM ('FIRST', 'LAST');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "EmailTemplateKey" AS ENUM ('NEW_LEAD', 'LEAD_ASSIGNED', 'FOLLOW_UP', 'STAFF_INVITATION', 'PASSWORD_RESET', 'PROPOSAL_SENT', 'PROPOSAL_ACCEPTED', 'INVOICE_SENT', 'PAYMENT_RECEIVED', 'PAYMENT_REMINDER', 'CLIENT_NOTIFICATION');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('LEAD_CREATED', 'LEAD_STATUS_CHANGED', 'LEAD_ASSIGNED', 'PROPOSAL_SENT', 'PROPOSAL_ACCEPTED', 'PROPOSAL_REJECTED', 'INVOICE_SENT', 'INVOICE_OVERDUE', 'PAYMENT_RECEIVED', 'PROJECT_CREATED', 'TASK_OVERDUE');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('ASSIGN_LEAD', 'CREATE_LEAD_TASK', 'SEND_EMAIL', 'NOTIFY_USER', 'CREATE_CLIENT', 'CREATE_PROJECT', 'CREATE_PROJECT_TASKS', 'SET_LEAD_STATUS', 'ADD_TAG');

-- CreateEnum
CREATE TYPE "RedirectType" AS ENUM ('PERMANENT_301', 'FOUND_302', 'TEMPORARY_307', 'PERMANENT_308');

-- CreateEnum
CREATE TYPE "SchemaType" AS ENUM ('NONE', 'ORGANIZATION', 'WEBSITE', 'SERVICE', 'LOCAL_BUSINESS', 'ARTICLE', 'FAQ_PAGE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'ASSIGN', 'STATUS_CHANGE', 'SEND', 'PUBLISH', 'UNPUBLISH');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "type" "UserType" NOT NULL DEFAULT 'STAFF',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "clientId" TEXT,
    "avatarId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "inviteToken" TEXT,
    "inviteExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "message" TEXT,
    "budget" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "score" INTEGER NOT NULL DEFAULT 0,
    "sourceId" TEXT NOT NULL,
    "serviceId" TEXT,
    "cityId" TEXT,
    "packageId" TEXT,
    "popupId" TEXT,
    "campaignId" TEXT,
    "firstTouchId" TEXT,
    "lastTouchId" TEXT,
    "landingPath" TEXT,
    "referrer" TEXT,
    "device" "DeviceType",
    "assignedToId" TEXT,
    "convertedClientId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "LeadSourceType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "LeadActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTask" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTag" (
    "leadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "LeadTag_pkey" PRIMARY KEY ("leadId","tagId")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "body" JSONB,
    "icon" TEXT,
    "heroMediaId" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "order" INTEGER NOT NULL DEFAULT 0,
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "population" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCityPage" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "localIntro" TEXT,
    "marketContext" TEXT,
    "industries" JSONB,
    "positioning" TEXT,
    "ctaHeading" TEXT,
    "ctaBody" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCityPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageSection" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" JSONB,
    "coverId" TEXT,
    "authorId" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "readingMinutes" INTEGER NOT NULL DEFAULT 1,
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPostTag" (
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "BlogPostTag_pkey" PRIMARY KEY ("postId","tagId")
);

-- CreateTable
CREATE TABLE "CaseStudy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" JSONB,
    "serviceId" TEXT,
    "cityId" TEXT,
    "coverId" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseStudyMetric" (
    "id" TEXT NOT NULL,
    "caseStudyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaseStudyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "company" TEXT,
    "quote" TEXT NOT NULL,
    "rating" INTEGER,
    "avatarId" TEXT,
    "serviceId" TEXT,
    "cityId" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FAQ" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "serviceId" TEXT,
    "cityId" TEXT,
    "serviceCityPageId" TEXT,
    "packageId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FAQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePackage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "serviceId" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "billingType" "BillingType" NOT NULL DEFAULT 'MONTHLY',
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "order" INTEGER NOT NULL DEFAULT 0,
    "seoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageFeature" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PackageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "title" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "stage" "OpportunityStage" NOT NULL DEFAULT 'DISCOVERY',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "opportunityId" TEXT,
    "leadId" TEXT,
    "clientId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalItem" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalRevision" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "proposalId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "terms" TEXT,
    "documentId" TEXT,
    "signedAt" TIMESTAMP(3),
    "renewalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "logoId" TEXT,
    "ownerId" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "designation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT,
    "managerId" TEXT NOT NULL,
    "contractId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "health" "ProjectHealth" NOT NULL DEFAULT 'ON_TRACK',
    "budget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMP(3),
    "estimateHours" DECIMAL(8,2),
    "milestoneId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "ProjectTaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectComment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCalendarItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "channel" "ContentChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT,
    "stage" "ContentStage" NOT NULL DEFAULT 'IDEA',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCalendarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "contentItemId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalVersion" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mediaId" TEXT,
    "notes" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "feedback" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "platform" "CampaignPlatform" NOT NULL,
    "objective" TEXT,
    "budget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "ownerId" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMetric" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2),
    "source" "MetricSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UTMTracking" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "term" TEXT,
    "content" TEXT,
    "landingPath" TEXT,
    "referrer" TEXT,
    "device" "DeviceType" NOT NULL DEFAULT 'DESKTOP',
    "touch" "AttributionTouch" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UTMTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Popup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "ctaLabel" TEXT,
    "ctaHref" TEXT,
    "formFields" JSONB,
    "trigger" "PopupTrigger" NOT NULL DEFAULT 'TIME_DELAY',
    "triggerValue" INTEGER,
    "frequency" "PopupFrequency" NOT NULL DEFAULT 'ONCE_PER_SESSION',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Popup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PopupTarget" (
    "id" TEXT NOT NULL,
    "popupId" TEXT NOT NULL,
    "type" "PopupTargetType" NOT NULL,
    "path" TEXT,
    "serviceId" TEXT,
    "cityId" TEXT,
    "serviceCityPageId" TEXT,
    "packageId" TEXT,
    "visitorType" "VisitorType" NOT NULL DEFAULT 'ANY',
    "device" "DeviceType" NOT NULL DEFAULT 'ANY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PopupTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PopupAnalytics" (
    "id" TEXT NOT NULL,
    "popupId" TEXT NOT NULL,
    "event" "PopupEventType" NOT NULL,
    "visitorId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "serviceId" TEXT,
    "cityId" TEXT,
    "campaignId" TEXT,
    "utmId" TEXT,
    "leadId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PopupAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "contractId" TEXT,
    "retainerId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'RAZORPAY',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewaySignature" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retainer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "status" "RetainerStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "nextBillingAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Retainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "type" "MediaType" NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT,
    "checksum" TEXT,
    "folderId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaVersion" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "key" "EmailTemplateKey" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT,
    "variables" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "templateKey" "EmailTemplateKey",
    "to" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "providerMessageId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTrigger" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "AutomationTriggerType" NOT NULL,
    "config" JSONB,

    CONSTRAINT "AutomationTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationCondition" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AutomationCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "AutomationActionType" NOT NULL,
    "config" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seo" (
    "id" TEXT NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "canonical" TEXT,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "ogImageId" TEXT,
    "ogImageAlt" TEXT,
    "twitterTitle" TEXT,
    "twitterDescription" TEXT,
    "twitterImageId" TEXT,
    "robotsIndex" BOOLEAN NOT NULL DEFAULT true,
    "robotsFollow" BOOLEAN NOT NULL DEFAULT true,
    "schemaType" "SchemaType" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redirect" (
    "id" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "type" "RedirectType" NOT NULL DEFAULT 'PERMANENT_301',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

-- CreateIndex
CREATE INDEX "User_type_status_idx" ON "User"("type", "status");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "Permission_resource_idx" ON "Permission"("resource");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_key" ON "Permission"("resource", "action");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_slug_key" ON "Department"("slug");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_status_idx" ON "Lead"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "Lead_sourceId_idx" ON "Lead"("sourceId");

-- CreateIndex
CREATE INDEX "Lead_cityId_serviceId_idx" ON "Lead"("cityId", "serviceId");

-- CreateIndex
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");

-- CreateIndex
CREATE INDEX "Lead_popupId_idx" ON "Lead"("popupId");

-- CreateIndex
CREATE INDEX "Lead_packageId_idx" ON "Lead"("packageId");

-- CreateIndex
CREATE INDEX "Lead_convertedClientId_idx" ON "Lead"("convertedClientId");

-- CreateIndex
CREATE INDEX "Lead_firstTouchId_idx" ON "Lead"("firstTouchId");

-- CreateIndex
CREATE INDEX "Lead_lastTouchId_idx" ON "Lead"("lastTouchId");

-- CreateIndex
CREATE INDEX "Lead_deletedAt_idx" ON "Lead"("deletedAt");

-- CreateIndex
CREATE INDEX "Lead_score_idx" ON "Lead"("score");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_slug_key" ON "LeadSource"("slug");

-- CreateIndex
CREATE INDEX "LeadSource_isActive_idx" ON "LeadSource"("isActive");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadActivity_actorId_idx" ON "LeadActivity"("actorId");

-- CreateIndex
CREATE INDEX "LeadNote_leadId_createdAt_idx" ON "LeadNote"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadNote_authorId_idx" ON "LeadNote"("authorId");

-- CreateIndex
CREATE INDEX "LeadTask_assigneeId_dueAt_idx" ON "LeadTask"("assigneeId", "dueAt");

-- CreateIndex
CREATE INDEX "LeadTask_leadId_idx" ON "LeadTask"("leadId");

-- CreateIndex
CREATE INDEX "LeadTask_status_dueAt_idx" ON "LeadTask"("status", "dueAt");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_createdAt_idx" ON "LeadAssignment"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadAssignment_toUserId_idx" ON "LeadAssignment"("toUserId");

-- CreateIndex
CREATE INDEX "LeadAssignment_fromUserId_idx" ON "LeadAssignment"("fromUserId");

-- CreateIndex
CREATE INDEX "LeadAssignment_assignedById_idx" ON "LeadAssignment"("assignedById");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "LeadTag_tagId_idx" ON "LeadTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_slug_key" ON "Service"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Service_seoId_key" ON "Service"("seoId");

-- CreateIndex
CREATE INDEX "Service_status_order_idx" ON "Service"("status", "order");

-- CreateIndex
CREATE INDEX "Service_heroMediaId_idx" ON "Service"("heroMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "City_seoId_key" ON "City"("seoId");

-- CreateIndex
CREATE INDEX "City_isActive_order_idx" ON "City"("isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCityPage_seoId_key" ON "ServiceCityPage"("seoId");

-- CreateIndex
CREATE INDEX "ServiceCityPage_status_idx" ON "ServiceCityPage"("status");

-- CreateIndex
CREATE INDEX "ServiceCityPage_cityId_status_idx" ON "ServiceCityPage"("cityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCityPage_serviceId_cityId_key" ON "ServiceCityPage"("serviceId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Page_seoId_key" ON "Page"("seoId");

-- CreateIndex
CREATE INDEX "Page_status_idx" ON "Page"("status");

-- CreateIndex
CREATE INDEX "PageSection_pageId_order_idx" ON "PageSection"("pageId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_seoId_key" ON "BlogPost"("seoId");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "BlogPost_categoryId_idx" ON "BlogPost"("categoryId");

-- CreateIndex
CREATE INDEX "BlogPost_authorId_idx" ON "BlogPost"("authorId");

-- CreateIndex
CREATE INDEX "BlogPost_coverId_idx" ON "BlogPost"("coverId");

-- CreateIndex
CREATE UNIQUE INDEX "BlogCategory_slug_key" ON "BlogCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BlogCategory_seoId_key" ON "BlogCategory"("seoId");

-- CreateIndex
CREATE UNIQUE INDEX "BlogTag_slug_key" ON "BlogTag"("slug");

-- CreateIndex
CREATE INDEX "BlogPostTag_tagId_idx" ON "BlogPostTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseStudy_slug_key" ON "CaseStudy"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CaseStudy_seoId_key" ON "CaseStudy"("seoId");

-- CreateIndex
CREATE INDEX "CaseStudy_status_idx" ON "CaseStudy"("status");

-- CreateIndex
CREATE INDEX "CaseStudy_serviceId_idx" ON "CaseStudy"("serviceId");

-- CreateIndex
CREATE INDEX "CaseStudy_cityId_idx" ON "CaseStudy"("cityId");

-- CreateIndex
CREATE INDEX "CaseStudy_coverId_idx" ON "CaseStudy"("coverId");

-- CreateIndex
CREATE INDEX "CaseStudyMetric_caseStudyId_order_idx" ON "CaseStudyMetric"("caseStudyId", "order");

-- CreateIndex
CREATE INDEX "Testimonial_status_order_idx" ON "Testimonial"("status", "order");

-- CreateIndex
CREATE INDEX "Testimonial_serviceId_idx" ON "Testimonial"("serviceId");

-- CreateIndex
CREATE INDEX "Testimonial_cityId_idx" ON "Testimonial"("cityId");

-- CreateIndex
CREATE INDEX "Testimonial_avatarId_idx" ON "Testimonial"("avatarId");

-- CreateIndex
CREATE INDEX "FAQ_serviceId_idx" ON "FAQ"("serviceId");

-- CreateIndex
CREATE INDEX "FAQ_cityId_idx" ON "FAQ"("cityId");

-- CreateIndex
CREATE INDEX "FAQ_serviceCityPageId_idx" ON "FAQ"("serviceCityPageId");

-- CreateIndex
CREATE INDEX "FAQ_packageId_idx" ON "FAQ"("packageId");

-- CreateIndex
CREATE INDEX "FAQ_isActive_order_idx" ON "FAQ"("isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePackage_slug_key" ON "ServicePackage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePackage_seoId_key" ON "ServicePackage"("seoId");

-- CreateIndex
CREATE INDEX "ServicePackage_status_order_idx" ON "ServicePackage"("status", "order");

-- CreateIndex
CREATE INDEX "ServicePackage_serviceId_idx" ON "ServicePackage"("serviceId");

-- CreateIndex
CREATE INDEX "PackageFeature_packageId_order_idx" ON "PackageFeature"("packageId", "order");

-- CreateIndex
CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");

-- CreateIndex
CREATE INDEX "Opportunity_leadId_idx" ON "Opportunity"("leadId");

-- CreateIndex
CREATE INDEX "Opportunity_clientId_idx" ON "Opportunity"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_number_key" ON "Proposal"("number");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Proposal_leadId_idx" ON "Proposal"("leadId");

-- CreateIndex
CREATE INDEX "Proposal_clientId_idx" ON "Proposal"("clientId");

-- CreateIndex
CREATE INDEX "Proposal_opportunityId_idx" ON "Proposal"("opportunityId");

-- CreateIndex
CREATE INDEX "Proposal_createdById_idx" ON "Proposal"("createdById");

-- CreateIndex
CREATE INDEX "ProposalItem_proposalId_order_idx" ON "ProposalItem"("proposalId", "order");

-- CreateIndex
CREATE INDEX "ProposalRevision_createdById_idx" ON "ProposalRevision"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalRevision_proposalId_version_key" ON "ProposalRevision"("proposalId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_number_key" ON "Contract"("number");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- CreateIndex
CREATE INDEX "Contract_proposalId_idx" ON "Contract"("proposalId");

-- CreateIndex
CREATE INDEX "Contract_documentId_idx" ON "Contract"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_slug_key" ON "Client"("slug");

-- CreateIndex
CREATE INDEX "Client_deletedAt_idx" ON "Client"("deletedAt");

-- CreateIndex
CREATE INDEX "Client_ownerId_idx" ON "Client"("ownerId");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE INDEX "Client_logoId_idx" ON "Client"("logoId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientContact_userId_key" ON "ClientContact"("userId");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_clientId_status_idx" ON "Project"("clientId", "status");

-- CreateIndex
CREATE INDEX "Project_managerId_idx" ON "Project"("managerId");

-- CreateIndex
CREATE INDEX "Project_serviceId_idx" ON "Project"("serviceId");

-- CreateIndex
CREATE INDEX "Project_contractId_idx" ON "Project"("contractId");

-- CreateIndex
CREATE INDEX "Project_status_health_idx" ON "Project"("status", "health");

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_status_idx" ON "ProjectTask"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_assigneeId_dueAt_idx" ON "ProjectTask"("assigneeId", "dueAt");

-- CreateIndex
CREATE INDEX "ProjectTask_parentId_idx" ON "ProjectTask"("parentId");

-- CreateIndex
CREATE INDEX "ProjectTask_milestoneId_idx" ON "ProjectTask"("milestoneId");

-- CreateIndex
CREATE INDEX "ProjectTaskDependency_dependsOnId_idx" ON "ProjectTaskDependency"("dependsOnId");

-- CreateIndex
CREATE INDEX "ProjectMilestone_projectId_order_idx" ON "ProjectMilestone"("projectId", "order");

-- CreateIndex
CREATE INDEX "ProjectComment_projectId_createdAt_idx" ON "ProjectComment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectComment_taskId_idx" ON "ProjectComment"("taskId");

-- CreateIndex
CREATE INDEX "ProjectComment_authorId_idx" ON "ProjectComment"("authorId");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_startedAt_idx" ON "TimeEntry"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_idx" ON "TimeEntry"("taskId");

-- CreateIndex
CREATE INDEX "ContentCalendarItem_clientId_stage_idx" ON "ContentCalendarItem"("clientId", "stage");

-- CreateIndex
CREATE INDEX "ContentCalendarItem_scheduledFor_idx" ON "ContentCalendarItem"("scheduledFor");

-- CreateIndex
CREATE INDEX "ContentCalendarItem_projectId_idx" ON "ContentCalendarItem"("projectId");

-- CreateIndex
CREATE INDEX "ContentCalendarItem_ownerId_idx" ON "ContentCalendarItem"("ownerId");

-- CreateIndex
CREATE INDEX "ContentCalendarItem_mediaId_idx" ON "ContentCalendarItem"("mediaId");

-- CreateIndex
CREATE INDEX "Approval_clientId_status_idx" ON "Approval"("clientId", "status");

-- CreateIndex
CREATE INDEX "Approval_projectId_idx" ON "Approval"("projectId");

-- CreateIndex
CREATE INDEX "Approval_contentItemId_idx" ON "Approval"("contentItemId");

-- CreateIndex
CREATE INDEX "Approval_requestedById_idx" ON "Approval"("requestedById");

-- CreateIndex
CREATE INDEX "ApprovalVersion_mediaId_idx" ON "ApprovalVersion"("mediaId");

-- CreateIndex
CREATE INDEX "ApprovalVersion_createdById_idx" ON "ApprovalVersion"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalVersion_approvalId_version_key" ON "ApprovalVersion"("approvalId", "version");

-- CreateIndex
CREATE INDEX "Campaign_clientId_status_idx" ON "Campaign"("clientId", "status");

-- CreateIndex
CREATE INDEX "Campaign_ownerId_idx" ON "Campaign"("ownerId");

-- CreateIndex
CREATE INDEX "Campaign_platform_status_idx" ON "Campaign"("platform", "status");

-- CreateIndex
CREATE INDEX "CampaignMetric_date_idx" ON "CampaignMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMetric_campaignId_date_key" ON "CampaignMetric"("campaignId", "date");

-- CreateIndex
CREATE INDEX "UTMTracking_visitorId_occurredAt_idx" ON "UTMTracking"("visitorId", "occurredAt");

-- CreateIndex
CREATE INDEX "UTMTracking_source_medium_idx" ON "UTMTracking"("source", "medium");

-- CreateIndex
CREATE INDEX "UTMTracking_touch_idx" ON "UTMTracking"("touch");

-- CreateIndex
CREATE INDEX "Popup_isActive_priority_idx" ON "Popup"("isActive", "priority");

-- CreateIndex
CREATE INDEX "Popup_mediaId_idx" ON "Popup"("mediaId");

-- CreateIndex
CREATE INDEX "PopupTarget_popupId_idx" ON "PopupTarget"("popupId");

-- CreateIndex
CREATE INDEX "PopupTarget_serviceId_idx" ON "PopupTarget"("serviceId");

-- CreateIndex
CREATE INDEX "PopupTarget_cityId_idx" ON "PopupTarget"("cityId");

-- CreateIndex
CREATE INDEX "PopupTarget_serviceCityPageId_idx" ON "PopupTarget"("serviceCityPageId");

-- CreateIndex
CREATE INDEX "PopupTarget_packageId_idx" ON "PopupTarget"("packageId");

-- CreateIndex
CREATE INDEX "PopupAnalytics_popupId_event_occurredAt_idx" ON "PopupAnalytics"("popupId", "event", "occurredAt");

-- CreateIndex
CREATE INDEX "PopupAnalytics_visitorId_idx" ON "PopupAnalytics"("visitorId");

-- CreateIndex
CREATE INDEX "PopupAnalytics_serviceId_idx" ON "PopupAnalytics"("serviceId");

-- CreateIndex
CREATE INDEX "PopupAnalytics_cityId_idx" ON "PopupAnalytics"("cityId");

-- CreateIndex
CREATE INDEX "PopupAnalytics_campaignId_idx" ON "PopupAnalytics"("campaignId");

-- CreateIndex
CREATE INDEX "PopupAnalytics_utmId_idx" ON "PopupAnalytics"("utmId");

-- CreateIndex
CREATE INDEX "PopupAnalytics_leadId_idx" ON "PopupAnalytics"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_clientId_status_idx" ON "Invoice"("clientId", "status");

-- CreateIndex
CREATE INDEX "Invoice_status_dueAt_idx" ON "Invoice"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");

-- CreateIndex
CREATE INDEX "Invoice_projectId_idx" ON "Invoice"("projectId");

-- CreateIndex
CREATE INDEX "Invoice_contractId_idx" ON "Invoice"("contractId");

-- CreateIndex
CREATE INDEX "Invoice_retainerId_idx" ON "Invoice"("retainerId");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_order_idx" ON "InvoiceItem"("invoiceId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayPaymentId_key" ON "Payment"("gatewayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_clientId_status_idx" ON "Payment"("clientId", "status");

-- CreateIndex
CREATE INDEX "Payment_gatewayOrderId_idx" ON "Payment"("gatewayOrderId");

-- CreateIndex
CREATE INDEX "Retainer_status_nextBillingAt_idx" ON "Retainer"("status", "nextBillingAt");

-- CreateIndex
CREATE INDEX "Retainer_clientId_idx" ON "Retainer"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_key_key" ON "Media"("key");

-- CreateIndex
CREATE INDEX "Media_folderId_idx" ON "Media"("folderId");

-- CreateIndex
CREATE INDEX "Media_type_idx" ON "Media"("type");

-- CreateIndex
CREATE INDEX "Media_deletedAt_idx" ON "Media"("deletedAt");

-- CreateIndex
CREATE INDEX "Media_uploadedById_idx" ON "Media"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFolder_path_key" ON "MediaFolder"("path");

-- CreateIndex
CREATE INDEX "MediaFolder_parentId_idx" ON "MediaFolder"("parentId");

-- CreateIndex
CREATE INDEX "MediaVersion_uploadedById_idx" ON "MediaVersion"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "MediaVersion_mediaId_version_key" ON "MediaVersion"("mediaId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");

-- CreateIndex
CREATE INDEX "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_to_idx" ON "EmailLog"("to");

-- CreateIndex
CREATE INDEX "EmailLog_entityType_entityId_idx" ON "EmailLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Automation_isActive_order_idx" ON "Automation"("isActive", "order");

-- CreateIndex
CREATE INDEX "AutomationTrigger_automationId_idx" ON "AutomationTrigger"("automationId");

-- CreateIndex
CREATE INDEX "AutomationTrigger_type_idx" ON "AutomationTrigger"("type");

-- CreateIndex
CREATE INDEX "AutomationCondition_automationId_order_idx" ON "AutomationCondition"("automationId", "order");

-- CreateIndex
CREATE INDEX "AutomationAction_automationId_order_idx" ON "AutomationAction"("automationId", "order");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Seo_ogImageId_idx" ON "Seo"("ogImageId");

-- CreateIndex
CREATE INDEX "Seo_twitterImageId_idx" ON "Seo"("twitterImageId");

-- CreateIndex
CREATE UNIQUE INDEX "Redirect_fromPath_key" ON "Redirect"("fromPath");

-- CreateIndex
CREATE INDEX "Redirect_isActive_idx" ON "Redirect"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSetting_key_key" ON "SiteSetting"("key");

-- CreateIndex
CREATE INDEX "SiteSetting_group_idx" ON "SiteSetting"("group");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSetting_provider_key" ON "IntegrationSetting"("provider");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_popupId_fkey" FOREIGN KEY ("popupId") REFERENCES "Popup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_firstTouchId_fkey" FOREIGN KEY ("firstTouchId") REFERENCES "UTMTracking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lastTouchId_fkey" FOREIGN KEY ("lastTouchId") REFERENCES "UTMTracking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_heroMediaId_fkey" FOREIGN KEY ("heroMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCityPage" ADD CONSTRAINT "ServiceCityPage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCityPage" ADD CONSTRAINT "ServiceCityPage_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCityPage" ADD CONSTRAINT "ServiceCityPage_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageSection" ADD CONSTRAINT "PageSection_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogCategory" ADD CONSTRAINT "BlogCategory_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "BlogTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStudy" ADD CONSTRAINT "CaseStudy_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStudy" ADD CONSTRAINT "CaseStudy_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStudy" ADD CONSTRAINT "CaseStudy_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStudy" ADD CONSTRAINT "CaseStudy_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStudyMetric" ADD CONSTRAINT "CaseStudyMetric_caseStudyId_fkey" FOREIGN KEY ("caseStudyId") REFERENCES "CaseStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_serviceCityPageId_fkey" FOREIGN KEY ("serviceCityPageId") REFERENCES "ServiceCityPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_seoId_fkey" FOREIGN KEY ("seoId") REFERENCES "Seo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "ProposalRevision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "ProposalRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentCalendarItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalVersion" ADD CONSTRAINT "ApprovalVersion_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalVersion" ADD CONSTRAINT "ApprovalVersion_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalVersion" ADD CONSTRAINT "ApprovalVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Popup" ADD CONSTRAINT "Popup_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupTarget" ADD CONSTRAINT "PopupTarget_popupId_fkey" FOREIGN KEY ("popupId") REFERENCES "Popup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupTarget" ADD CONSTRAINT "PopupTarget_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupTarget" ADD CONSTRAINT "PopupTarget_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupTarget" ADD CONSTRAINT "PopupTarget_serviceCityPageId_fkey" FOREIGN KEY ("serviceCityPageId") REFERENCES "ServiceCityPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupTarget" ADD CONSTRAINT "PopupTarget_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupAnalytics" ADD CONSTRAINT "PopupAnalytics_popupId_fkey" FOREIGN KEY ("popupId") REFERENCES "Popup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupAnalytics" ADD CONSTRAINT "PopupAnalytics_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupAnalytics" ADD CONSTRAINT "PopupAnalytics_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupAnalytics" ADD CONSTRAINT "PopupAnalytics_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupAnalytics" ADD CONSTRAINT "PopupAnalytics_utmId_fkey" FOREIGN KEY ("utmId") REFERENCES "UTMTracking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PopupAnalytics" ADD CONSTRAINT "PopupAnalytics_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_retainerId_fkey" FOREIGN KEY ("retainerId") REFERENCES "Retainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retainer" ADD CONSTRAINT "Retainer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaVersion" ADD CONSTRAINT "MediaVersion_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaVersion" ADD CONSTRAINT "MediaVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrigger" ADD CONSTRAINT "AutomationTrigger_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationCondition" ADD CONSTRAINT "AutomationCondition_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seo" ADD CONSTRAINT "Seo_ogImageId_fkey" FOREIGN KEY ("ogImageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seo" ADD CONSTRAINT "Seo_twitterImageId_fkey" FOREIGN KEY ("twitterImageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
