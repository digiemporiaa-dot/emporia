-- CreateEnum
CREATE TYPE "SeoCrawlFrequency" AS ENUM ('MANUAL', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrawlPageState" AS ENUM ('QUEUED', 'FETCHED', 'BLOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "CrawlPageSource" AS ENUM ('START', 'LINK', 'SITEMAP');

-- CreateEnum
CREATE TYPE "CrawlIssueSeverity" AS ENUM ('CRITICAL', 'WARNING', 'NOTICE');

-- AlterTable
ALTER TABLE "SeoProperty" ADD COLUMN     "crawlFrequency" "SeoCrawlFrequency" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "crawlMaxPages" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "lastCrawledAt" TIMESTAMP(3),
ADD COLUMN     "nextCrawlAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "trigger" "SeoSyncTrigger" NOT NULL,
    "status" "CrawlStatus" NOT NULL DEFAULT 'RUNNING',
    "startUrl" TEXT NOT NULL,
    "maxPages" INTEGER NOT NULL,
    "robotsFound" BOOLEAN,
    "robotsTxt" TEXT,
    "sitemapUrls" INTEGER NOT NULL DEFAULT 0,
    "sitemaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "limitReached" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "lockedUntil" TIMESTAMP(3),
    "error" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CrawlRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlPage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "source" "CrawlPageSource" NOT NULL,
    "state" "CrawlPageState" NOT NULL DEFAULT 'QUEUED',
    "statusCode" INTEGER,
    "redirectTo" TEXT,
    "contentType" TEXT,
    "responseMs" INTEGER,
    "bytes" INTEGER,
    "canonical" TEXT,
    "metaRobots" TEXT,
    "xRobotsTag" TEXT,
    "title" TEXT,
    "description" TEXT,
    "h1" TEXT,
    "h1Count" INTEGER,
    "h2Count" INTEGER,
    "wordCount" INTEGER,
    "contentHash" TEXT,
    "lang" TEXT,
    "hreflang" JSONB,
    "schemaTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageCount" INTEGER,
    "imagesMissingAlt" INTEGER,
    "externalLinks" INTEGER,
    "inSitemap" BOOLEAN NOT NULL DEFAULT false,
    "indexable" BOOLEAN,
    "inlinks" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3),

    CONSTRAINT "CrawlPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlLink" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromPageId" TEXT NOT NULL,
    "toUrl" TEXT NOT NULL,
    "toPageId" TEXT,
    "anchor" TEXT,
    "nofollow" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CrawlLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlIssue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pageId" TEXT,
    "rule" TEXT NOT NULL,
    "severity" "CrawlIssueSeverity" NOT NULL,
    "detail" JSONB,

    CONSTRAINT "CrawlIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlInspection" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "verdict" TEXT,
    "coverageState" TEXT,
    "indexingState" TEXT,
    "robotsTxtState" TEXT,
    "pageFetchState" TEXT,
    "googleCanonical" TEXT,
    "userCanonical" TEXT,
    "lastCrawlTime" TIMESTAMP(3),
    "crawledAs" TEXT,
    "sitemaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrlInspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrawlRun_propertyId_startedAt_idx" ON "CrawlRun"("propertyId", "startedAt");

-- CreateIndex
CREATE INDEX "CrawlRun_status_lockedUntil_idx" ON "CrawlRun"("status", "lockedUntil");

-- CreateIndex
CREATE INDEX "CrawlRun_startedById_idx" ON "CrawlRun"("startedById");

-- CreateIndex
CREATE INDEX "CrawlPage_runId_state_idx" ON "CrawlPage"("runId", "state");

-- CreateIndex
CREATE INDEX "CrawlPage_runId_statusCode_idx" ON "CrawlPage"("runId", "statusCode");

-- CreateIndex
CREATE INDEX "CrawlPage_runId_contentHash_idx" ON "CrawlPage"("runId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlPage_runId_url_key" ON "CrawlPage"("runId", "url");

-- CreateIndex
CREATE INDEX "CrawlLink_runId_toUrl_idx" ON "CrawlLink"("runId", "toUrl");

-- CreateIndex
CREATE INDEX "CrawlLink_toPageId_idx" ON "CrawlLink"("toPageId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlLink_fromPageId_toUrl_key" ON "CrawlLink"("fromPageId", "toUrl");

-- CreateIndex
CREATE INDEX "CrawlIssue_runId_rule_idx" ON "CrawlIssue"("runId", "rule");

-- CreateIndex
CREATE INDEX "CrawlIssue_runId_severity_idx" ON "CrawlIssue"("runId", "severity");

-- CreateIndex
CREATE INDEX "CrawlIssue_pageId_idx" ON "CrawlIssue"("pageId");

-- CreateIndex
CREATE INDEX "UrlInspection_propertyId_inspectedAt_idx" ON "UrlInspection"("propertyId", "inspectedAt");

-- CreateIndex
CREATE INDEX "UrlInspection_propertyId_coverageState_idx" ON "UrlInspection"("propertyId", "coverageState");

-- CreateIndex
CREATE UNIQUE INDEX "UrlInspection_propertyId_url_key" ON "UrlInspection"("propertyId", "url");

-- CreateIndex
CREATE INDEX "SeoProperty_isActive_nextCrawlAt_idx" ON "SeoProperty"("isActive", "nextCrawlAt");

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlPage" ADD CONSTRAINT "CrawlPage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlLink" ADD CONSTRAINT "CrawlLink_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlLink" ADD CONSTRAINT "CrawlLink_fromPageId_fkey" FOREIGN KEY ("fromPageId") REFERENCES "CrawlPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlLink" ADD CONSTRAINT "CrawlLink_toPageId_fkey" FOREIGN KEY ("toPageId") REFERENCES "CrawlPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlIssue" ADD CONSTRAINT "CrawlIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlIssue" ADD CONSTRAINT "CrawlIssue_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CrawlPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlInspection" ADD CONSTRAINT "UrlInspection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
