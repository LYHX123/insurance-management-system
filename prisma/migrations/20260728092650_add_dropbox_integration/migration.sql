-- CreateEnum
CREATE TYPE "DropboxConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "DropboxIntegration" (
    "id" TEXT NOT NULL,
    "status" "DropboxConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "encryptedRefreshToken" TEXT,
    "dropboxAccountId" TEXT,
    "accountEmail" TEXT,
    "accountDisplayName" TEXT,
    "rootFolder" TEXT NOT NULL DEFAULT '/Insurance Management System',
    "rootFolderVerifiedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropboxIntegration_pkey" PRIMARY KEY ("id")
);
