-- CreateEnum
CREATE TYPE "SeoReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "SeoProperty" ADD COLUMN     "cwvCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SeoCrawlHistory" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "pagesFetched" INTEGER NOT NULL,
    "indexablePages" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "warning" INTEGER NOT NULL,
    "notice" INTEGER NOT NULL,

    CONSTRAINT "SeoCrawlHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoReport" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "SeoReportStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "notes" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CwvSnapshot" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "formFactor" TEXT NOT NULL,
    "periodEnd" DATE NOT NULL,
    "lcp" INTEGER,
    "inp" INTEGER,
    "fcp" INTEGER,
    "ttfb" INTEGER,
    "cls" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CwvSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoCrawlHistory_runId_key" ON "SeoCrawlHistory"("runId");

-- CreateIndex
CREATE INDEX "SeoCrawlHistory_propertyId_finishedAt_idx" ON "SeoCrawlHistory"("propertyId", "finishedAt");

-- CreateIndex
CREATE INDEX "SeoReport_status_publishedAt_idx" ON "SeoReport"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "SeoReport_generatedById_idx" ON "SeoReport"("generatedById");

-- CreateIndex
CREATE INDEX "SeoReport_publishedById_idx" ON "SeoReport"("publishedById");

-- CreateIndex
CREATE UNIQUE INDEX "SeoReport_propertyId_month_key" ON "SeoReport"("propertyId", "month");

-- CreateIndex
CREATE INDEX "CwvSnapshot_propertyId_periodEnd_idx" ON "CwvSnapshot"("propertyId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "CwvSnapshot_propertyId_url_formFactor_periodEnd_key" ON "CwvSnapshot"("propertyId", "url", "formFactor", "periodEnd");

-- AddForeignKey
ALTER TABLE "SeoCrawlHistory" ADD CONSTRAINT "SeoCrawlHistory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoReport" ADD CONSTRAINT "SeoReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoReport" ADD CONSTRAINT "SeoReport_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoReport" ADD CONSTRAINT "SeoReport_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CwvSnapshot" ADD CONSTRAINT "CwvSnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the crawls still kept get their history rows, so charts start
-- with what is already known. md5 of the run id makes a stable row id.
INSERT INTO "SeoCrawlHistory" ("id", "propertyId", "runId", "finishedAt", "pagesFetched", "indexablePages", "critical", "warning", "notice")
SELECT
  'h' || substr(md5(r."id"), 1, 24),
  r."propertyId",
  r."id",
  r."finishedAt",
  r."pagesFetched",
  (SELECT count(*)::int FROM "CrawlPage" p WHERE p."runId" = r."id" AND p."indexable" = true),
  COALESCE((r."summary"->>'CRITICAL')::int, 0),
  COALESCE((r."summary"->>'WARNING')::int, 0),
  COALESCE((r."summary"->>'NOTICE')::int, 0)
FROM "CrawlRun" r
WHERE r."status" = 'SUCCEEDED' AND r."finishedAt" IS NOT NULL
ON CONFLICT ("runId") DO NOTHING;
