-- CreateEnum
CREATE TYPE "SeoProtocol" AS ENUM ('HTTPS', 'HTTP');

-- AlterTable
ALTER TABLE "City" ADD COLUMN     "countryId" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultLanguage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoProperty" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "domain" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "protocol" "SeoProtocol" NOT NULL DEFAULT 'HTTPS',
    "verifiedAt" TIMESTAMP(3),
    "gscSiteUrl" TEXT,
    "ga4PropertyId" TEXT,
    "defaultCountryId" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoProperty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE INDEX "SeoProperty_clientId_isActive_idx" ON "SeoProperty"("clientId", "isActive");

-- CreateIndex
CREATE INDEX "SeoProperty_projectId_idx" ON "SeoProperty"("projectId");

-- CreateIndex
CREATE INDEX "SeoProperty_defaultCountryId_idx" ON "SeoProperty"("defaultCountryId");

-- CreateIndex
CREATE INDEX "SeoProperty_createdById_idx" ON "SeoProperty"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "SeoProperty_clientId_domain_key" ON "SeoProperty"("clientId", "domain");

-- CreateIndex
CREATE INDEX "City_countryId_idx" ON "City"("countryId");

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoProperty" ADD CONSTRAINT "SeoProperty_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoProperty" ADD CONSTRAINT "SeoProperty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoProperty" ADD CONSTRAINT "SeoProperty_defaultCountryId_fkey" FOREIGN KEY ("defaultCountryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoProperty" ADD CONSTRAINT "SeoProperty_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
