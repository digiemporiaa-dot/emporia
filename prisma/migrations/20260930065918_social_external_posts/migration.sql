-- CreateTable
CREATE TABLE "SocialExternalPost" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "caption" TEXT,
    "format" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "reach" INTEGER,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "videoViews" INTEGER,
    "watchTimeSeconds" INTEGER,
    "profileVisits" INTEGER,
    "followersGained" INTEGER,
    "metricsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialExternalPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialExternalPost_clientId_publishedAt_idx" ON "SocialExternalPost"("clientId", "publishedAt");

-- CreateIndex
CREATE INDEX "SocialExternalPost_accountId_publishedAt_idx" ON "SocialExternalPost"("accountId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialExternalPost_provider_externalPostId_key" ON "SocialExternalPost"("provider", "externalPostId");

-- AddForeignKey
ALTER TABLE "SocialExternalPost" ADD CONSTRAINT "SocialExternalPost_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialExternalPost" ADD CONSTRAINT "SocialExternalPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
