-- CreateEnum
CREATE TYPE "SeoDataSource" AS ENUM ('SEARCH_CONSOLE', 'ANALYTICS');

-- CreateEnum
CREATE TYPE "SeoAuthMethod" AS ENUM ('OAUTH', 'SERVICE_ACCOUNT');

-- CreateEnum
CREATE TYPE "SeoConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SeoSyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SeoSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "SeoConnection" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "source" "SeoDataSource" NOT NULL,
    "method" "SeoAuthMethod" NOT NULL,
    "status" "SeoConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accountEmail" TEXT,
    "externalId" TEXT,
    "permissionLevel" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "syncLockedUntil" TIMESTAMP(3),
    "backfilledFrom" DATE,
    "dataThrough" DATE,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoSyncRun" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "source" "SeoDataSource" NOT NULL,
    "trigger" "SeoSyncTrigger" NOT NULL,
    "status" "SeoSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "rangeFrom" DATE,
    "rangeTo" DATE,
    "daysWritten" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SeoSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscDailyTotal" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "device" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscDailyTotal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscQueryDaily" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscQueryDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscPageDaily" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscPageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoConnection_source_status_lastSyncedAt_idx" ON "SeoConnection"("source", "status", "lastSyncedAt");

-- CreateIndex
CREATE INDEX "SeoConnection_connectedById_idx" ON "SeoConnection"("connectedById");

-- CreateIndex
CREATE UNIQUE INDEX "SeoConnection_propertyId_source_key" ON "SeoConnection"("propertyId", "source");

-- CreateIndex
CREATE INDEX "SeoSyncRun_propertyId_source_startedAt_idx" ON "SeoSyncRun"("propertyId", "source", "startedAt");

-- CreateIndex
CREATE INDEX "GscDailyTotal_propertyId_date_idx" ON "GscDailyTotal"("propertyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GscDailyTotal_propertyId_date_device_country_key" ON "GscDailyTotal"("propertyId", "date", "device", "country");

-- CreateIndex
CREATE INDEX "GscQueryDaily_propertyId_query_idx" ON "GscQueryDaily"("propertyId", "query");

-- CreateIndex
CREATE UNIQUE INDEX "GscQueryDaily_propertyId_date_query_key" ON "GscQueryDaily"("propertyId", "date", "query");

-- CreateIndex
CREATE INDEX "GscPageDaily_propertyId_page_idx" ON "GscPageDaily"("propertyId", "page");

-- CreateIndex
CREATE UNIQUE INDEX "GscPageDaily_propertyId_date_page_key" ON "GscPageDaily"("propertyId", "date", "page");

-- AddForeignKey
ALTER TABLE "SeoConnection" ADD CONSTRAINT "SeoConnection_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoConnection" ADD CONSTRAINT "SeoConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoSyncRun" ADD CONSTRAINT "SeoSyncRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscDailyTotal" ADD CONSTRAINT "GscDailyTotal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscQueryDaily" ADD CONSTRAINT "GscQueryDaily_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscPageDaily" ADD CONSTRAINT "GscPageDaily_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
