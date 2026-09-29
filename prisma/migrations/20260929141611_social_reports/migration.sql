-- CreateEnum
CREATE TYPE "SocialReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "SocialReport" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "SocialReportStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "notes" TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialReport_clientId_status_idx" ON "SocialReport"("clientId", "status");

-- CreateIndex
CREATE INDEX "SocialReport_generatedById_idx" ON "SocialReport"("generatedById");

-- CreateIndex
CREATE INDEX "SocialReport_publishedById_idx" ON "SocialReport"("publishedById");

-- CreateIndex
CREATE UNIQUE INDEX "SocialReport_clientId_month_key" ON "SocialReport"("clientId", "month");

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialReport" ADD CONSTRAINT "SocialReport_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
