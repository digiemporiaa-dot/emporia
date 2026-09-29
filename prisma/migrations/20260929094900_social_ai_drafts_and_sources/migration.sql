-- AlterTable
ALTER TABLE "ContentCalendarItem" ADD COLUMN     "sourceBlogPostId" TEXT;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "aiDraftedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ContentCalendarItem_sourceBlogPostId_idx" ON "ContentCalendarItem"("sourceBlogPostId");

-- AddForeignKey
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_sourceBlogPostId_fkey" FOREIGN KEY ("sourceBlogPostId") REFERENCES "BlogPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
