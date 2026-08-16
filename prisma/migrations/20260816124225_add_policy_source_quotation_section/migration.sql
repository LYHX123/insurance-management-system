-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "sourceQuotationSectionId" TEXT;

-- CreateIndex
CREATE INDEX "PolicyRecord_sourceQuotationSectionId_idx" ON "PolicyRecord"("sourceQuotationSectionId");

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_sourceQuotationSectionId_fkey" FOREIGN KEY ("sourceQuotationSectionId") REFERENCES "QuotationInsuranceSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
