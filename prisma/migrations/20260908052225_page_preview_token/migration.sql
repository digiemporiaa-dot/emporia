-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "previewToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Page_previewToken_key" ON "Page"("previewToken");
