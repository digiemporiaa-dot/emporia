-- AlterEnum
ALTER TYPE "SeoOpportunitySource" ADD VALUE 'ANALYTICS';

-- AlterTable
ALTER TABLE "SeoProperty" ADD COLUMN     "ga4Currency" TEXT,
ADD COLUMN     "ga4TimeZone" TEXT;

-- CreateTable
CREATE TABLE "Ga4LandingDaily" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "landingPage" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "engagedSessions" INTEGER NOT NULL,
    "keyEvents" DOUBLE PRECISION NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Ga4LandingDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ga4DailyTotal" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "sessions" INTEGER NOT NULL,
    "engagedSessions" INTEGER NOT NULL,
    "keyEvents" DOUBLE PRECISION NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Ga4DailyTotal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ga4LandingDaily_propertyId_date_idx" ON "Ga4LandingDaily"("propertyId", "date");

-- CreateIndex
CREATE INDEX "Ga4LandingDaily_propertyId_landingPage_idx" ON "Ga4LandingDaily"("propertyId", "landingPage");

-- CreateIndex
CREATE INDEX "Ga4DailyTotal_propertyId_date_idx" ON "Ga4DailyTotal"("propertyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Ga4DailyTotal_propertyId_date_channel_country_device_key" ON "Ga4DailyTotal"("propertyId", "date", "channel", "country", "device");

-- AddForeignKey
ALTER TABLE "Ga4LandingDaily" ADD CONSTRAINT "Ga4LandingDaily_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ga4DailyTotal" ADD CONSTRAINT "Ga4DailyTotal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SeoProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
