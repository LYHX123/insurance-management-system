-- CreateEnum
CREATE TYPE "QuotationDocumentType" AS ENUM ('AWARD_LETTER', 'TENDER_DOCUMENT', 'BOQ', 'CONTRACT_DOCUMENT', 'EMPLOYEE_SCHEDULE', 'VEHICLE_SCHEDULE', 'EQUIPMENT_SCHEDULE', 'ASSET_SCHEDULE', 'STOCK_SCHEDULE', 'GOODS_SCHEDULE', 'MEDICAL_CENSUS', 'CLAIMS_HISTORY', 'PREVIOUS_POLICY', 'INSURER_QUOTATION', 'PIN_CERTIFICATE', 'REGISTRATION_CERTIFICATE', 'CR12', 'ID_DOCUMENT', 'APPLICATION_FORM', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStorageProvider" AS ENUM ('LOCAL', 'DROPBOX');

-- CreateEnum
CREATE TYPE "DocumentSyncStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "QuotationDocument" (
    "id" TEXT NOT NULL,
    "quotationCaseId" TEXT NOT NULL,
    "documentType" "QuotationDocumentType" NOT NULL,
    "customTypeName" TEXT,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileExtension" TEXT,
    "fileSize" INTEGER NOT NULL,
    "description" TEXT,
    "documentDate" TIMESTAMP(3),
    "storageProvider" "DocumentStorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storagePath" TEXT NOT NULL,
    "checksum" TEXT,
    "dropboxPath" TEXT,
    "dropboxFileId" TEXT,
    "syncStatus" "DocumentSyncStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "syncError" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "QuotationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotationDocument_quotationCaseId_idx" ON "QuotationDocument"("quotationCaseId");

-- CreateIndex
CREATE INDEX "QuotationDocument_documentType_idx" ON "QuotationDocument"("documentType");

-- CreateIndex
CREATE INDEX "QuotationDocument_uploadedAt_idx" ON "QuotationDocument"("uploadedAt");

-- CreateIndex
CREATE INDEX "QuotationDocument_deletedAt_idx" ON "QuotationDocument"("deletedAt");

-- CreateIndex
CREATE INDEX "QuotationDocument_syncStatus_idx" ON "QuotationDocument"("syncStatus");

-- AddForeignKey
ALTER TABLE "QuotationDocument" ADD CONSTRAINT "QuotationDocument_quotationCaseId_fkey" FOREIGN KEY ("quotationCaseId") REFERENCES "QuotationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
