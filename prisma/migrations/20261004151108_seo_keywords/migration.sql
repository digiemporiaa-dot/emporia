-- CreateEnum
CREATE TYPE "SeoKeywordSource" AS ENUM ('MANUAL', 'SEARCH_CONSOLE');

-- CreateTable
CREATE TABLE "GscQueryPageDaily" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscQueryPageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoKeyword" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "SeoKeywordSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GscQueryPageDaily_propertyId_date_idx" ON "GscQueryPageDaily"("propertyId", "date");

-- CreateIndex
CREATE INDEX "GscQueryPageDaily_propertyId_query_idx" ON "GscQueryPageDaily"("propertyId", "query");

-- CreateIndex
CREATE INDEX "SeoKeyword_propertyId_createdAt_idx" ON "SeoKeyword"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "SeoKeyword_createdById_idx" ON "SeoKeyword"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "SeoKeyword_propertyId_keyword_key" ON "SeoKeyword"("propertyId", "keyword");

-- AddForeignKey
ALTER TABLE "GscQueryPageDaily" ADD CONSTRAINT "GscQueryPageDaily_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoKeyword" ADD CONSTRAINT "SeoKeyword_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoKeyword" ADD CONSTRAINT "SeoKeyword_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
