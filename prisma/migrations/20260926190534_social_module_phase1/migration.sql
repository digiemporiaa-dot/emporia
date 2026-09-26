-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'YOUTUBE', 'X', 'GOOGLE_BUSINESS_PROFILE');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SocialPostType" AS ENUM ('SINGLE_IMAGE', 'CAROUSEL', 'VIDEO', 'REEL', 'STORY', 'TEXT', 'LINK', 'YOUTUBE_VIDEO', 'YOUTUBE_SHORT', 'GBP_POST');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ContentCalendarItem" ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "profileUrl" TEXT,
    "avatarId" TEXT,
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountId" TEXT,
    "provider" "SocialProvider" NOT NULL,
    "type" "SocialPostType" NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "caption" TEXT,
    "headline" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "callToAction" TEXT,
    "firstComment" TEXT,
    "linkUrl" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostMedia" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "thumbnailId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPublication" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMetricSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "capturedOn" DATE NOT NULL,
    "reach" INTEGER,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "videoViews" INTEGER,
    "watchTimeSeconds" INTEGER,
    "profileVisits" INTEGER,
    "followersGained" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_clientId_status_idx" ON "SocialAccount"("clientId", "status");

-- CreateIndex
CREATE INDEX "SocialAccount_provider_status_idx" ON "SocialAccount"("provider", "status");

-- CreateIndex
CREATE INDEX "SocialAccount_avatarId_idx" ON "SocialAccount"("avatarId");

-- CreateIndex
CREATE INDEX "SocialAccount_connectedById_idx" ON "SocialAccount"("connectedById");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_provider_externalId_key" ON "SocialAccount"("provider", "externalId");

-- CreateIndex
CREATE INDEX "SocialPost_clientId_status_idx" ON "SocialPost"("clientId", "status");

-- CreateIndex
CREATE INDEX "SocialPost_contentItemId_idx" ON "SocialPost"("contentItemId");

-- CreateIndex
CREATE INDEX "SocialPost_accountId_idx" ON "SocialPost"("accountId");

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledFor_idx" ON "SocialPost"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "SocialPost_provider_publishedAt_idx" ON "SocialPost"("provider", "publishedAt");

-- CreateIndex
CREATE INDEX "SocialPostMedia_mediaId_idx" ON "SocialPostMedia"("mediaId");

-- CreateIndex
CREATE INDEX "SocialPostMedia_thumbnailId_idx" ON "SocialPostMedia"("thumbnailId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostMedia_postId_order_key" ON "SocialPostMedia"("postId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPublication_idempotencyKey_key" ON "SocialPublication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SocialPublication_postId_attempt_idx" ON "SocialPublication"("postId", "attempt");

-- CreateIndex
CREATE INDEX "SocialPublication_clientId_status_idx" ON "SocialPublication"("clientId", "status");

-- CreateIndex
CREATE INDEX "SocialPublication_status_attemptedAt_idx" ON "SocialPublication"("status", "attemptedAt");

-- CreateIndex
CREATE INDEX "SocialPublication_triggeredById_idx" ON "SocialPublication"("triggeredById");

-- CreateIndex
CREATE INDEX "SocialMetricSnapshot_clientId_capturedOn_idx" ON "SocialMetricSnapshot"("clientId", "capturedOn");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMetricSnapshot_postId_capturedOn_key" ON "SocialMetricSnapshot"("postId", "capturedOn");

-- CreateIndex
CREATE INDEX "ContentCalendarItem_campaignId_idx" ON "ContentCalendarItem"("campaignId");

-- AddForeignKey
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentCalendarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostMedia" ADD CONSTRAINT "SocialPostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostMedia" ADD CONSTRAINT "SocialPostMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostMedia" ADD CONSTRAINT "SocialPostMedia_thumbnailId_fkey" FOREIGN KEY ("thumbnailId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPublication" ADD CONSTRAINT "SocialPublication_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPublication" ADD CONSTRAINT "SocialPublication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPublication" ADD CONSTRAINT "SocialPublication_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMetricSnapshot" ADD CONSTRAINT "SocialMetricSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMetricSnapshot" ADD CONSTRAINT "SocialMetricSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
