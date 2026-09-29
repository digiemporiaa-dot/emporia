-- CreateEnum
CREATE TYPE "InternalReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "SocialInternalReview" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "status" "InternalReviewStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "feedback" TEXT,
    "snapshot" JSONB NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "SocialInternalReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialInternalReview_clientId_status_idx" ON "SocialInternalReview"("clientId", "status");

-- CreateIndex
CREATE INDEX "SocialInternalReview_submittedById_idx" ON "SocialInternalReview"("submittedById");

-- CreateIndex
CREATE INDEX "SocialInternalReview_reviewerId_idx" ON "SocialInternalReview"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialInternalReview_contentItemId_round_key" ON "SocialInternalReview"("contentItemId", "round");

-- AddForeignKey
ALTER TABLE "SocialInternalReview" ADD CONSTRAINT "SocialInternalReview_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentCalendarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialInternalReview" ADD CONSTRAINT "SocialInternalReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialInternalReview" ADD CONSTRAINT "SocialInternalReview_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialInternalReview" ADD CONSTRAINT "SocialInternalReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
