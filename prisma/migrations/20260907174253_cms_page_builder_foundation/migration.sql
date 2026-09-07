-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "internalName" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PageSection" ADD COLUMN     "isVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "reusableSectionId" TEXT;

-- CreateTable
CREATE TABLE "ReusableSection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReusableSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReusableSection_key_key" ON "ReusableSection"("key");

-- CreateIndex
CREATE INDEX "ReusableSection_status_idx" ON "ReusableSection"("status");

-- CreateIndex
CREATE INDEX "ReusableSection_isGlobal_idx" ON "ReusableSection"("isGlobal");

-- CreateIndex
CREATE INDEX "ReusableSection_deletedAt_idx" ON "ReusableSection"("deletedAt");

-- CreateIndex
CREATE INDEX "Page_deletedAt_idx" ON "Page"("deletedAt");

-- CreateIndex
CREATE INDEX "Page_updatedAt_idx" ON "Page"("updatedAt");

-- CreateIndex
CREATE INDEX "PageSection_reusableSectionId_idx" ON "PageSection"("reusableSectionId");

-- AddForeignKey
ALTER TABLE "PageSection" ADD CONSTRAINT "PageSection_reusableSectionId_fkey" FOREIGN KEY ("reusableSectionId") REFERENCES "ReusableSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: a page that is already PUBLISHED has been published, whatever the
-- new column says. `createdAt` is the closest honest value available — these
-- rows predate the column, so there is no real publish timestamp to recover.
UPDATE "Page"
SET "publishedAt" = "createdAt"
WHERE "status" = 'PUBLISHED' AND "publishedAt" IS NULL;
