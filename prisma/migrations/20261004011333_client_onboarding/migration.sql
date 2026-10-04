-- CreateEnum
CREATE TYPE "WebsitePlatform" AS ENUM ('WORDPRESS', 'SHOPIFY', 'WIX', 'SQUARESPACE', 'WEBFLOW', 'CUSTOM', 'OTHER');

-- CreateEnum
CREATE TYPE "BrandAssetKind" AS ENUM ('LOGO', 'GUIDELINES', 'OTHER');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('COMPANY', 'BRAND', 'WEBSITE', 'ANALYTICS', 'SEARCH_CONSOLE', 'SOCIAL', 'BUSINESS');

-- CreateTable
CREATE TABLE "ClientBusinessProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "publicPhone" TEXT,
    "publicEmail" TEXT,
    "hours" JSONB,
    "serviceAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "googleBusinessUrl" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOnboarding" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "websitePlatform" "WebsitePlatform",
    "websiteLoginUrl" TEXT,
    "websiteNotes" TEXT,
    "websiteAccessConfirmedAt" TIMESTAMP(3),
    "ga4PropertyId" TEXT,
    "ga4AccessConfirmedAt" TIMESTAMP(3),
    "socialProfiles" JSONB NOT NULL DEFAULT '[]',
    "notApplicable" "OnboardingStep"[] DEFAULT ARRAY[]::"OnboardingStep"[],
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBrandAsset" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" "BrandAssetKind" NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientBrandAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientBusinessProfile_clientId_key" ON "ClientBusinessProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientBusinessProfile_updatedById_idx" ON "ClientBusinessProfile"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOnboarding_clientId_key" ON "ClientOnboarding"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBrandAsset_mediaId_key" ON "ClientBrandAsset"("mediaId");

-- CreateIndex
CREATE INDEX "ClientBrandAsset_clientId_kind_idx" ON "ClientBrandAsset"("clientId", "kind");

-- CreateIndex
CREATE INDEX "ClientBrandAsset_uploadedById_idx" ON "ClientBrandAsset"("uploadedById");

-- AddForeignKey
ALTER TABLE "ClientBusinessProfile" ADD CONSTRAINT "ClientBusinessProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBusinessProfile" ADD CONSTRAINT "ClientBusinessProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOnboarding" ADD CONSTRAINT "ClientOnboarding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrandAsset" ADD CONSTRAINT "ClientBrandAsset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrandAsset" ADD CONSTRAINT "ClientBrandAsset_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrandAsset" ADD CONSTRAINT "ClientBrandAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
