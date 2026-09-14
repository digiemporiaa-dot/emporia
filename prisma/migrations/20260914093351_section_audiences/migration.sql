-- CreateTable
CREATE TABLE "SectionAudience" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "visitorType" "VisitorType" NOT NULL DEFAULT 'ANY',
    "device" "DeviceType" NOT NULL DEFAULT 'ANY',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "referrerContains" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionAudience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionAudience_sectionId_idx" ON "SectionAudience"("sectionId");

-- AddForeignKey
ALTER TABLE "SectionAudience" ADD CONSTRAINT "SectionAudience_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "PageSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
