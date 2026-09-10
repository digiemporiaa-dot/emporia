-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "PageTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sections" JSONB NOT NULL,
    "allowedBlocks" JSONB NOT NULL,
    "defaultSchemaType" "SchemaType" NOT NULL DEFAULT 'NONE',
    "defaultRobotsIndex" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageTemplate_key_key" ON "PageTemplate"("key");

-- CreateIndex
CREATE INDEX "PageTemplate_isActive_order_idx" ON "PageTemplate"("isActive", "order");

-- CreateIndex
CREATE INDEX "Page_templateId_idx" ON "Page"("templateId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
