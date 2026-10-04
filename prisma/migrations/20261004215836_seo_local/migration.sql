-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SeoOpportunitySource" ADD VALUE 'LOCAL';
ALTER TYPE "SeoOpportunitySource" ADD VALUE 'NAP';
ALTER TYPE "SeoOpportunitySource" ADD VALUE 'REVIEWS';
ALTER TYPE "SeoOpportunitySource" ADD VALUE 'INTERNATIONAL';

-- AlterTable
ALTER TABLE "CrawlPage" ADD COLUMN     "localBusiness" JSONB,
ADD COLUMN     "phones" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SeoLocalService" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "terms" TEXT[],
    "cmsServiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoLocalService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoLocalCity" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoLocalCity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoLocalPage" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "localServiceId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoLocalPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GbpListing" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "title" TEXT,
    "address" JSONB,
    "phone" TEXT,
    "website" TEXT,
    "averageRating" DOUBLE PRECISION,
    "totalReviewCount" INTEGER,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "complete" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GbpListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GbpReview" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "replyComment" TEXT,
    "repliedAt" TIMESTAMP(3),

    CONSTRAINT "GbpReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoLocalService_cmsServiceId_idx" ON "SeoLocalService"("cmsServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SeoLocalService_propertyId_name_key" ON "SeoLocalService"("propertyId", "name");

-- CreateIndex
CREATE INDEX "SeoLocalCity_cityId_idx" ON "SeoLocalCity"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "SeoLocalCity_propertyId_cityId_key" ON "SeoLocalCity"("propertyId", "cityId");

-- CreateIndex
CREATE INDEX "SeoLocalPage_propertyId_idx" ON "SeoLocalPage"("propertyId");

-- CreateIndex
CREATE INDEX "SeoLocalPage_cityId_idx" ON "SeoLocalPage"("cityId");

-- CreateIndex
CREATE INDEX "SeoLocalPage_updatedById_idx" ON "SeoLocalPage"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "SeoLocalPage_localServiceId_cityId_key" ON "SeoLocalPage"("localServiceId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "GbpListing_socialAccountId_key" ON "GbpListing"("socialAccountId");

-- CreateIndex
CREATE INDEX "GbpListing_lastAttemptAt_idx" ON "GbpListing"("lastAttemptAt");

-- CreateIndex
CREATE INDEX "GbpReview_socialAccountId_createdAt_idx" ON "GbpReview"("socialAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GbpReview_socialAccountId_externalId_key" ON "GbpReview"("socialAccountId", "externalId");

-- AddForeignKey
ALTER TABLE "SeoLocalService" ADD CONSTRAINT "SeoLocalService_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoLocalService" ADD CONSTRAINT "SeoLocalService_cmsServiceId_fkey" FOREIGN KEY ("cmsServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoLocalCity" ADD CONSTRAINT "SeoLocalCity_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoLocalCity" ADD CONSTRAINT "SeoLocalCity_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoLocalPage" ADD CONSTRAINT "SeoLocalPage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoLocalPage" ADD CONSTRAINT "SeoLocalPage_localServiceId_fkey" FOREIGN KEY ("localServiceId") REFERENCES "SeoLocalService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoLocalPage" ADD CONSTRAINT "SeoLocalPage_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoLocalPage" ADD CONSTRAINT "SeoLocalPage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GbpListing" ADD CONSTRAINT "GbpListing_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GbpReview" ADD CONSTRAINT "GbpReview_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
