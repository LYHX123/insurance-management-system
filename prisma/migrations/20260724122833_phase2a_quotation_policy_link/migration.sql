-- CreateEnum
CREATE TYPE "QuotationCaseActivityActionType" AS ENUM ('POLICY_CREATED');

-- AlterTable
ALTER TABLE "PolicyRecord" ADD COLUMN     "sourceQuotationId" TEXT;

-- CreateTable
CREATE TABLE "QuotationCaseActivity" (
    "id" TEXT NOT NULL,
    "quotationCaseId" TEXT NOT NULL,
    "actionType" "QuotationCaseActivityActionType" NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationCaseActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotationCaseActivity_quotationCaseId_idx" ON "QuotationCaseActivity"("quotationCaseId");

-- CreateIndex
CREATE INDEX "QuotationCaseActivity_createdAt_idx" ON "QuotationCaseActivity"("createdAt");

-- CreateIndex
CREATE INDEX "PolicyRecord_sourceQuotationId_idx" ON "PolicyRecord"("sourceQuotationId");

-- AddForeignKey
ALTER TABLE "QuotationCaseActivity" ADD CONSTRAINT "QuotationCaseActivity_quotationCaseId_fkey" FOREIGN KEY ("quotationCaseId") REFERENCES "QuotationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRecord" ADD CONSTRAINT "PolicyRecord_sourceQuotationId_fkey" FOREIGN KEY ("sourceQuotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
