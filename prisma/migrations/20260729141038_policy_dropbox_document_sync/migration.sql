-- CreateEnum
CREATE TYPE "PolicyDropboxBusinessFileSource" AS ENUM ('QUOTATION_CASE', 'POLICY_FALLBACK');

-- CreateTable
CREATE TABLE "PolicyDropboxBusinessFile" (
    "id" TEXT NOT NULL,
    "policyRecordId" TEXT NOT NULL,
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

    CONSTRAINT "PolicyDropboxBusinessFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDocumentDropboxSync" (
    "id" TEXT NOT NULL,
    "policyDocumentId" TEXT NOT NULL,
    "businessFileId" TEXT,
    "businessFileSource" "PolicyDropboxBusinessFileSource",
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

    CONSTRAINT "PolicyDocumentDropboxSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDropboxBusinessFile_policyRecordId_key" ON "PolicyDropboxBusinessFile"("policyRecordId");

-- CreateIndex
CREATE INDEX "PolicyDropboxBusinessFile_syncStatus_idx" ON "PolicyDropboxBusinessFile"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDocumentDropboxSync_policyDocumentId_key" ON "PolicyDocumentDropboxSync"("policyDocumentId");

-- CreateIndex
CREATE INDEX "PolicyDocumentDropboxSync_syncStatus_idx" ON "PolicyDocumentDropboxSync"("syncStatus");

-- CreateIndex
CREATE INDEX "PolicyDocumentDropboxSync_businessFileId_idx" ON "PolicyDocumentDropboxSync"("businessFileId");

-- AddForeignKey
ALTER TABLE "PolicyDropboxBusinessFile" ADD CONSTRAINT "PolicyDropboxBusinessFile_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDocumentDropboxSync" ADD CONSTRAINT "PolicyDocumentDropboxSync_policyDocumentId_fkey" FOREIGN KEY ("policyDocumentId") REFERENCES "PolicyDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
