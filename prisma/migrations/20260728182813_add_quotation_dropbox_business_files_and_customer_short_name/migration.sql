-- CreateEnum
CREATE TYPE "DropboxBusinessFileSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'ERROR', 'CONFLICT', 'DISABLED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "shortName" TEXT;

-- CreateTable
CREATE TABLE "QuotationDropboxBusinessFile" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
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
    "quotationId" TEXT NOT NULL,
    "businessFileId" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "QuotationDropboxBusinessFile_quotationId_key" ON "QuotationDropboxBusinessFile"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationDropboxBusinessFile_syncStatus_idx" ON "QuotationDropboxBusinessFile"("syncStatus");

-- CreateIndex
CREATE INDEX "QuotationDropboxVersion_businessFileId_idx" ON "QuotationDropboxVersion"("businessFileId");

-- CreateIndex
CREATE INDEX "QuotationDropboxVersion_quotationId_idx" ON "QuotationDropboxVersion"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationDropboxVersion_quotationId_versionNumber_key" ON "QuotationDropboxVersion"("quotationId", "versionNumber");

-- CreateIndex
CREATE INDEX "Customer_shortName_idx" ON "Customer"("shortName");

-- AddForeignKey
ALTER TABLE "QuotationDropboxBusinessFile" ADD CONSTRAINT "QuotationDropboxBusinessFile_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDropboxVersion" ADD CONSTRAINT "QuotationDropboxVersion_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
