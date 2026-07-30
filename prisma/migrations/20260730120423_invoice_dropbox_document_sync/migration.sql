-- CreateEnum
CREATE TYPE "InvoiceDropboxBusinessFileSource" AS ENUM ('QUOTATION_CASE', 'POLICY_FALLBACK', 'INVOICE_FALLBACK');

-- CreateTable
CREATE TABLE "InvoiceDropboxBusinessFile" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
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

    CONSTRAINT "InvoiceDropboxBusinessFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDocumentDropboxSync" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "businessFileId" TEXT,
    "businessFileSource" "InvoiceDropboxBusinessFileSource",
    "standardizedFileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "dropboxFileId" TEXT,
    "dropboxRevision" TEXT,
    "dropboxDisplayPath" TEXT,
    "dropboxPathLower" TEXT,
    "dropboxContentHash" TEXT,
    "dropboxSize" BIGINT,
    "syncStatus" "DropboxDocumentSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceDocumentDropboxSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceDropboxBusinessFile_invoiceId_key" ON "InvoiceDropboxBusinessFile"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceDropboxBusinessFile_syncStatus_idx" ON "InvoiceDropboxBusinessFile"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceDocumentDropboxSync_invoiceId_key" ON "InvoiceDocumentDropboxSync"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceDocumentDropboxSync_syncStatus_idx" ON "InvoiceDocumentDropboxSync"("syncStatus");

-- CreateIndex
CREATE INDEX "InvoiceDocumentDropboxSync_businessFileId_idx" ON "InvoiceDocumentDropboxSync"("businessFileId");

-- AddForeignKey
ALTER TABLE "InvoiceDropboxBusinessFile" ADD CONSTRAINT "InvoiceDropboxBusinessFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDocumentDropboxSync" ADD CONSTRAINT "InvoiceDocumentDropboxSync_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
