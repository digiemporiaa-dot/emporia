-- CreateEnum
CREATE TYPE "SeoOpportunitySource" AS ENUM ('KEYWORDS', 'CONTENT', 'TECHNICAL', 'INDEXATION', 'LINKS', 'CHANGES');

-- CreateEnum
CREATE TYPE "SeoOpportunityStatus" AS ENUM ('OPEN', 'TASK_CREATED', 'DONE', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SeoSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SeoEffort" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "SeoProperty" ADD COLUMN     "lastDetectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SeoThreshold" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoOpportunity" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "SeoOpportunitySource" NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "query" TEXT,
    "evidence" JSONB NOT NULL,
    "impact" INTEGER NOT NULL,
    "impactUnit" TEXT NOT NULL DEFAULT 'clicks',
    "severity" "SeoSeverity" NOT NULL,
    "effort" "SeoEffort" NOT NULL,
    "status" "SeoOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "dismissReason" TEXT,
    "dismissedImpact" INTEGER,
    "assigneeId" TEXT,
    "projectTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoChangeEvent" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "periodEnd" DATE NOT NULL,
    "severity" "SeoSeverity" NOT NULL,
    "direction" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "range" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoThreshold_propertyId_key_idx" ON "SeoThreshold"("propertyId", "key");

-- CreateIndex
CREATE INDEX "SeoThreshold_updatedById_idx" ON "SeoThreshold"("updatedById");

-- CreateIndex
CREATE INDEX "SeoOpportunity_propertyId_status_severity_idx" ON "SeoOpportunity"("propertyId", "status", "severity");

-- CreateIndex
CREATE INDEX "SeoOpportunity_status_severity_impact_idx" ON "SeoOpportunity"("status", "severity", "impact");

-- CreateIndex
CREATE INDEX "SeoOpportunity_assigneeId_idx" ON "SeoOpportunity"("assigneeId");

-- CreateIndex
CREATE INDEX "SeoOpportunity_projectTaskId_idx" ON "SeoOpportunity"("projectTaskId");

-- CreateIndex
CREATE INDEX "SeoOpportunity_dismissedById_idx" ON "SeoOpportunity"("dismissedById");

-- CreateIndex
CREATE UNIQUE INDEX "SeoOpportunity_propertyId_fingerprint_key" ON "SeoOpportunity"("propertyId", "fingerprint");

-- CreateIndex
CREATE INDEX "SeoChangeEvent_propertyId_detectedAt_idx" ON "SeoChangeEvent"("propertyId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeoChangeEvent_propertyId_key_periodEnd_key" ON "SeoChangeEvent"("propertyId", "key", "periodEnd");

-- AddForeignKey
ALTER TABLE "SeoThreshold" ADD CONSTRAINT "SeoThreshold_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoThreshold" ADD CONSTRAINT "SeoThreshold_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoOpportunity" ADD CONSTRAINT "SeoOpportunity_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoOpportunity" ADD CONSTRAINT "SeoOpportunity_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoOpportunity" ADD CONSTRAINT "SeoOpportunity_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoOpportunity" ADD CONSTRAINT "SeoOpportunity_projectTaskId_fkey" FOREIGN KEY ("projectTaskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoChangeEvent" ADD CONSTRAINT "SeoChangeEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
