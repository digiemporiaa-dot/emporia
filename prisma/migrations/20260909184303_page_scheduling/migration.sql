-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "unpublishAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Page_publishAt_idx" ON "Page"("publishAt");

-- CreateIndex
CREATE INDEX "Page_unpublishAt_idx" ON "Page"("unpublishAt");
