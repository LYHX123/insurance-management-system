-- CreateEnum
CREATE TYPE "DropboxFolderSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'ERROR', 'CONFLICT', 'DISABLED');

-- CreateTable
CREATE TABLE "CustomerDropboxFolder" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "dropboxFolderId" TEXT,
    "folderName" TEXT NOT NULL,
    "displayPath" TEXT,
    "pathLower" TEXT,
    "syncStatus" "DropboxFolderSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAttemptAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDropboxFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDropboxFolder_customerId_key" ON "CustomerDropboxFolder"("customerId");

-- CreateIndex
CREATE INDEX "CustomerDropboxFolder_syncStatus_idx" ON "CustomerDropboxFolder"("syncStatus");

-- AddForeignKey
ALTER TABLE "CustomerDropboxFolder" ADD CONSTRAINT "CustomerDropboxFolder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
