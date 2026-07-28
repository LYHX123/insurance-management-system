-- Correction 1: the Dropbox business folder represents the permanent
-- QuotationCase (enquiry/business), not any single revision. This
-- migration replaces the two Phase 4 tables (never committed/deployed,
-- created only in this local dev session) with the corrected shape:
-- QuotationDropboxBusinessFile now belongs to QuotationCase (unique),
-- and QuotationDropboxVersion belongs to that shared business file plus
-- records which specific revision (sourceQuotationId) produced it.
--
-- The one real row each table currently holds (for QT202607-114 /
-- CUST-0003) is preserved and relinked by a follow-up script immediately
-- after this migration is applied — not lost, not recreated from scratch.

-- DropTable
DROP TABLE "QuotationDropboxVersion";

-- DropTable
DROP TABLE "QuotationDropboxBusinessFile";

-- CreateTable
CREATE TABLE "QuotationDropboxBusinessFile" (
    "id" TEXT NOT NULL,
    "quotationCaseId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "insuranceTypeCode" TEXT NOT NULL,
    "customerShortName" TEXT NOT NULL,
    "businessTitle" TEXT NOT NULL,
    "businessFolderName" TEXT NOT NULL,
    "dropboxFolderId" TEXT,
    "dropboxDisplayPath" TEXT,
    "dropboxPathLower" TEXT,
    "syncStatus" "DropboxBusinessFileSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationDropboxBusinessFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationDropboxVersion" (
    "id" TEXT NOT NULL,
    "businessFileId" TEXT NOT NULL,
    "quotationCaseId" TEXT NOT NULL,
    "sourceQuotationId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "baseFileName" TEXT NOT NULL,
    "excelLocalStorageKey" TEXT,
    "pdfLocalStorageKey" TEXT,
    "excelDropboxFileId" TEXT,
    "excelDropboxRevision" TEXT,
    "excelDropboxPath" TEXT,
    "excelSyncStatus" "DropboxBusinessFileSyncStatus" NOT NULL DEFAULT 'PENDING',
    "pdfDropboxFileId" TEXT,
    "pdfDropboxRevision" TEXT,
    "pdfDropboxPath" TEXT,
    "pdfSyncStatus" "DropboxBusinessFileSyncStatus",
    "contentFingerprint" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationDropboxVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotationDropboxBusinessFile_quotationCaseId_key" ON "QuotationDropboxBusinessFile"("quotationCaseId");

-- CreateIndex
CREATE INDEX "QuotationDropboxBusinessFile_syncStatus_idx" ON "QuotationDropboxBusinessFile"("syncStatus");

-- CreateIndex
CREATE INDEX "QuotationDropboxVersion_businessFileId_idx" ON "QuotationDropboxVersion"("businessFileId");

-- CreateIndex
CREATE INDEX "QuotationDropboxVersion_quotationCaseId_idx" ON "QuotationDropboxVersion"("quotationCaseId");

-- CreateIndex
CREATE INDEX "QuotationDropboxVersion_sourceQuotationId_idx" ON "QuotationDropboxVersion"("sourceQuotationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationDropboxVersion_businessFileId_versionNumber_key" ON "QuotationDropboxVersion"("businessFileId", "versionNumber");

-- AddForeignKey
ALTER TABLE "QuotationDropboxBusinessFile" ADD CONSTRAINT "QuotationDropboxBusinessFile_quotationCaseId_fkey" FOREIGN KEY ("quotationCaseId") REFERENCES "QuotationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDropboxVersion" ADD CONSTRAINT "QuotationDropboxVersion_businessFileId_fkey" FOREIGN KEY ("businessFileId") REFERENCES "QuotationDropboxBusinessFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDropboxVersion" ADD CONSTRAINT "QuotationDropboxVersion_quotationCaseId_fkey" FOREIGN KEY ("quotationCaseId") REFERENCES "QuotationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDropboxVersion" ADD CONSTRAINT "QuotationDropboxVersion_sourceQuotationId_fkey" FOREIGN KEY ("sourceQuotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
