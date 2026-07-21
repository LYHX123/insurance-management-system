-- Phase 1: Quotation revision history (QuotationCase + revision fields on
-- Quotation). Purely additive — no existing column is dropped, renamed, or
-- retyped, and every new Quotation column is nullable. Existing rows are
-- backfilled into their own QuotationCase (R01) by a separate script
-- (scripts/backfill-quotation-revisions.ts), run once after this migration
-- applies — see that script for the transaction-safe, repeat-safe backfill
-- logic and the old-status -> new-status mapping.

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED', 'ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationCaseStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'QUOTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED_TO_POLICY');

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "isCurrentRevision" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "quotationCaseId" TEXT,
ADD COLUMN     "revisionCode" TEXT,
ADD COLUMN     "revisionNumber" INTEGER,
ADD COLUMN     "revisionReason" TEXT,
ADD COLUMN     "revisionStatus" "RevisionStatus",
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuotationCase" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT,
    "status" "QuotationCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" TEXT,
    "acceptedRevisionId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotationCase_quotationNumber_key" ON "QuotationCase"("quotationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationCase_currentRevisionId_key" ON "QuotationCase"("currentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationCase_acceptedRevisionId_key" ON "QuotationCase"("acceptedRevisionId");

-- CreateIndex
CREATE INDEX "QuotationCase_customerId_idx" ON "QuotationCase"("customerId");

-- CreateIndex
CREATE INDEX "QuotationCase_projectId_idx" ON "QuotationCase"("projectId");

-- CreateIndex
CREATE INDEX "QuotationCase_status_idx" ON "QuotationCase"("status");

-- CreateIndex
CREATE INDEX "QuotationCase_updatedAt_idx" ON "QuotationCase"("updatedAt");

-- CreateIndex
CREATE INDEX "Quotation_quotationCaseId_idx" ON "Quotation"("quotationCaseId");

-- CreateIndex
CREATE INDEX "Quotation_isCurrentRevision_idx" ON "Quotation"("isCurrentRevision");

-- CreateIndex
CREATE INDEX "Quotation_revisionStatus_idx" ON "Quotation"("revisionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationCaseId_revisionNumber_key" ON "Quotation"("quotationCaseId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "QuotationCase" ADD CONSTRAINT "QuotationCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationCase" ADD CONSTRAINT "QuotationCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CustomerProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_quotationCaseId_fkey" FOREIGN KEY ("quotationCaseId") REFERENCES "QuotationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

