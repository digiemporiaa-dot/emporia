-- AlterTable
ALTER TABLE "CrawlPage" ADD COLUMN     "textContent" TEXT;

-- AlterTable
ALTER TABLE "CrawlRun" ADD COLUMN     "suggestionCount" INTEGER;

-- CreateTable
CREATE TABLE "InternalLinkSuggestion" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "targetPageId" TEXT NOT NULL,
    "sourcePageId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "impressions" INTEGER NOT NULL,
    "sourceClicks" INTEGER NOT NULL,

    CONSTRAINT "InternalLinkSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalLinkSuggestion_runId_impressions_idx" ON "InternalLinkSuggestion"("runId", "impressions");

-- CreateIndex
CREATE INDEX "InternalLinkSuggestion_targetPageId_idx" ON "InternalLinkSuggestion"("targetPageId");

-- CreateIndex
CREATE INDEX "InternalLinkSuggestion_sourcePageId_idx" ON "InternalLinkSuggestion"("sourcePageId");

-- AddForeignKey
ALTER TABLE "InternalLinkSuggestion" ADD CONSTRAINT "InternalLinkSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLinkSuggestion" ADD CONSTRAINT "InternalLinkSuggestion_targetPageId_fkey" FOREIGN KEY ("targetPageId") REFERENCES "CrawlPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLinkSuggestion" ADD CONSTRAINT "InternalLinkSuggestion_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "CrawlPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
