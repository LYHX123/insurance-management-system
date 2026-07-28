-- CreateEnum
CREATE TYPE "DropboxDocumentSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'ERROR', 'CONFLICT', 'DISABLED');

-- CreateTable
CREATE TABLE "CustomerDocumentDropboxSync" (
    "id" TEXT NOT NULL,
    "customerDocumentId" TEXT NOT NULL,
    "dropboxFileId" TEXT,
    "dropboxRevision" TEXT,
    "dropboxDisplayPath" TEXT,
    "dropboxPathLower" TEXT,
    "standardizedFileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "syncStatus" "DropboxDocumentSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "contentHash" TEXT,
    "uploadedSize" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDocumentDropboxSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocumentDropboxSync_customerDocumentId_key" ON "CustomerDocumentDropboxSync"("customerDocumentId");

-- CreateIndex
CREATE INDEX "CustomerDocumentDropboxSync_syncStatus_idx" ON "CustomerDocumentDropboxSync"("syncStatus");

-- AddForeignKey
ALTER TABLE "CustomerDocumentDropboxSync" ADD CONSTRAINT "CustomerDocumentDropboxSync_customerDocumentId_fkey" FOREIGN KEY ("customerDocumentId") REFERENCES "CustomerDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
