-- AlterTable
ALTER TABLE "ContentCalendarItem" ADD COLUMN     "pillarId" TEXT;

-- CreateTable
CREATE TABLE "SocialBrandProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "brandName" TEXT,
    "tone" TEXT,
    "industry" TEXT,
    "targetAudience" TEXT,
    "preferredLanguage" TEXT,
    "ctaStyle" TEXT,
    "brandColors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbiddenWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredEmojis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "postingRules" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialBrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPillar" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPillar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialStrategy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "objectives" TEXT,
    "platforms" "SocialProvider"[] DEFAULT ARRAY[]::"SocialProvider"[],
    "postingFrequency" JSONB NOT NULL DEFAULT '{}',
    "campaignGoals" TEXT,
    "kpiTargets" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialBrandProfile_clientId_key" ON "SocialBrandProfile"("clientId");

-- CreateIndex
CREATE INDEX "SocialBrandProfile_updatedById_idx" ON "SocialBrandProfile"("updatedById");

-- CreateIndex
CREATE INDEX "ContentPillar_clientId_archivedAt_idx" ON "ContentPillar"("clientId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPillar_clientId_name_key" ON "ContentPillar"("clientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SocialStrategy_clientId_key" ON "SocialStrategy"("clientId");

-- CreateIndex
CREATE INDEX "SocialStrategy_updatedById_idx" ON "SocialStrategy"("updatedById");

-- CreateIndex
CREATE INDEX "ContentCalendarItem_pillarId_idx" ON "ContentCalendarItem"("pillarId");

-- AddForeignKey
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "ContentPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialBrandProfile" ADD CONSTRAINT "SocialBrandProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialBrandProfile" ADD CONSTRAINT "SocialBrandProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPillar" ADD CONSTRAINT "ContentPillar_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialStrategy" ADD CONSTRAINT "SocialStrategy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialStrategy" ADD CONSTRAINT "SocialStrategy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
