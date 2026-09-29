-- CreateEnum
CREATE TYPE "OccasionCategory" AS ENUM ('FESTIVAL', 'NATIONAL_DAY', 'AWARENESS_DAY', 'INDUSTRY_EVENT', 'BRAND');

-- CreateTable
CREATE TABLE "ContentOccasion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "OccasionCategory" NOT NULL,
    "description" TEXT,
    "fixedMonth" INTEGER,
    "fixedDay" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentOccasion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentOccasionDate" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentOccasionDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOccasion" (
    "clientId" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOccasion_pkey" PRIMARY KEY ("clientId","occasionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentOccasion_slug_key" ON "ContentOccasion"("slug");

-- CreateIndex
CREATE INDEX "ContentOccasion_clientId_archivedAt_idx" ON "ContentOccasion"("clientId", "archivedAt");

-- CreateIndex
CREATE INDEX "ContentOccasionDate_date_idx" ON "ContentOccasionDate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ContentOccasionDate_occasionId_date_key" ON "ContentOccasionDate"("occasionId", "date");

-- CreateIndex
CREATE INDEX "ClientOccasion_occasionId_idx" ON "ClientOccasion"("occasionId");

-- AddForeignKey
ALTER TABLE "ContentOccasion" ADD CONSTRAINT "ContentOccasion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentOccasionDate" ADD CONSTRAINT "ContentOccasionDate_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "ContentOccasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOccasion" ADD CONSTRAINT "ClientOccasion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOccasion" ADD CONSTRAINT "ClientOccasion_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "ContentOccasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
