-- CreateEnum
CREATE TYPE "MotorClaimDocumentType" AS ENUM ('CLAIM_FORM', 'POLICE_ABSTRACT', 'DRIVER_LICENSE', 'LOGBOOK', 'INSURANCE_CERTIFICATE', 'ASSESSMENT_REPORT', 'REPAIR_ESTIMATE', 'REPAIR_INVOICE', 'REINSPECTION_REPORT', 'DISCHARGE_VOUCHER', 'RELEASE_LETTER', 'PHOTOS', 'OTHER');

-- CreateEnum
CREATE TYPE "NonMotorClaimDocumentType" AS ENUM ('CLAIM_FORM', 'INCIDENT_REPORT', 'SURVEY_REPORT', 'ASSESSMENT_REPORT', 'SUPPORTING_DOCUMENT', 'REPAIR_ESTIMATE', 'REPAIR_INVOICE', 'SETTLEMENT_OFFER', 'DISCHARGE_VOUCHER', 'SETTLEMENT_LETTER', 'PHOTOS', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimDropboxBusinessFileSource" AS ENUM ('QUOTATION_CASE', 'POLICY_FALLBACK', 'CLAIM_FALLBACK');

-- AlterTable
ALTER TABLE "MotorClaim" ADD COLUMN     "policyRecordId" TEXT;

-- AlterTable
ALTER TABLE "NonMotorClaim" ADD COLUMN     "policyRecordId" TEXT;

-- CreateTable
CREATE TABLE "MotorClaimDocument" (
    "id" TEXT NOT NULL,
    "motorClaimId" TEXT NOT NULL,
    "documentType" "MotorClaimDocumentType" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotorClaimDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonMotorClaimDocument" (
    "id" TEXT NOT NULL,
    "nonMotorClaimId" TEXT NOT NULL,
    "documentType" "NonMotorClaimDocumentType" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NonMotorClaimDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorClaimDropboxBusinessFile" (
    "id" TEXT NOT NULL,
    "motorClaimId" TEXT NOT NULL,
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

    CONSTRAINT "MotorClaimDropboxBusinessFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonMotorClaimDropboxBusinessFile" (
    "id" TEXT NOT NULL,
    "nonMotorClaimId" TEXT NOT NULL,
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

    CONSTRAINT "NonMotorClaimDropboxBusinessFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotorClaimDocumentDropboxSync" (
    "id" TEXT NOT NULL,
    "motorClaimDocumentId" TEXT NOT NULL,
    "businessFileId" TEXT,
    "businessFileSource" "ClaimDropboxBusinessFileSource",
    "claimFolderName" TEXT,
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

    CONSTRAINT "MotorClaimDocumentDropboxSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonMotorClaimDocumentDropboxSync" (
    "id" TEXT NOT NULL,
    "nonMotorClaimDocumentId" TEXT NOT NULL,
    "businessFileId" TEXT,
    "businessFileSource" "ClaimDropboxBusinessFileSource",
    "claimFolderName" TEXT,
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

    CONSTRAINT "NonMotorClaimDocumentDropboxSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MotorClaimDocument_motorClaimId_idx" ON "MotorClaimDocument"("motorClaimId");

-- CreateIndex
CREATE INDEX "MotorClaimDocument_documentType_idx" ON "MotorClaimDocument"("documentType");

-- CreateIndex
CREATE INDEX "MotorClaimDocument_createdAt_idx" ON "MotorClaimDocument"("createdAt");

-- CreateIndex
CREATE INDEX "NonMotorClaimDocument_nonMotorClaimId_idx" ON "NonMotorClaimDocument"("nonMotorClaimId");

-- CreateIndex
CREATE INDEX "NonMotorClaimDocument_documentType_idx" ON "NonMotorClaimDocument"("documentType");

-- CreateIndex
CREATE INDEX "NonMotorClaimDocument_createdAt_idx" ON "NonMotorClaimDocument"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MotorClaimDropboxBusinessFile_motorClaimId_key" ON "MotorClaimDropboxBusinessFile"("motorClaimId");

-- CreateIndex
CREATE INDEX "MotorClaimDropboxBusinessFile_syncStatus_idx" ON "MotorClaimDropboxBusinessFile"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "NonMotorClaimDropboxBusinessFile_nonMotorClaimId_key" ON "NonMotorClaimDropboxBusinessFile"("nonMotorClaimId");

-- CreateIndex
CREATE INDEX "NonMotorClaimDropboxBusinessFile_syncStatus_idx" ON "NonMotorClaimDropboxBusinessFile"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "MotorClaimDocumentDropboxSync_motorClaimDocumentId_key" ON "MotorClaimDocumentDropboxSync"("motorClaimDocumentId");

-- CreateIndex
CREATE INDEX "MotorClaimDocumentDropboxSync_syncStatus_idx" ON "MotorClaimDocumentDropboxSync"("syncStatus");

-- CreateIndex
CREATE INDEX "MotorClaimDocumentDropboxSync_businessFileId_idx" ON "MotorClaimDocumentDropboxSync"("businessFileId");

-- CreateIndex
CREATE UNIQUE INDEX "NonMotorClaimDocumentDropboxSync_nonMotorClaimDocumentId_key" ON "NonMotorClaimDocumentDropboxSync"("nonMotorClaimDocumentId");

-- CreateIndex
CREATE INDEX "NonMotorClaimDocumentDropboxSync_syncStatus_idx" ON "NonMotorClaimDocumentDropboxSync"("syncStatus");

-- CreateIndex
CREATE INDEX "NonMotorClaimDocumentDropboxSync_businessFileId_idx" ON "NonMotorClaimDocumentDropboxSync"("businessFileId");

-- CreateIndex
CREATE INDEX "MotorClaim_policyRecordId_idx" ON "MotorClaim"("policyRecordId");

-- CreateIndex
CREATE INDEX "NonMotorClaim_policyRecordId_idx" ON "NonMotorClaim"("policyRecordId");

-- AddForeignKey
ALTER TABLE "MotorClaim" ADD CONSTRAINT "MotorClaim_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaim" ADD CONSTRAINT "NonMotorClaim_policyRecordId_fkey" FOREIGN KEY ("policyRecordId") REFERENCES "PolicyRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorClaimDocument" ADD CONSTRAINT "MotorClaimDocument_motorClaimId_fkey" FOREIGN KEY ("motorClaimId") REFERENCES "MotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaimDocument" ADD CONSTRAINT "NonMotorClaimDocument_nonMotorClaimId_fkey" FOREIGN KEY ("nonMotorClaimId") REFERENCES "NonMotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorClaimDropboxBusinessFile" ADD CONSTRAINT "MotorClaimDropboxBusinessFile_motorClaimId_fkey" FOREIGN KEY ("motorClaimId") REFERENCES "MotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaimDropboxBusinessFile" ADD CONSTRAINT "NonMotorClaimDropboxBusinessFile_nonMotorClaimId_fkey" FOREIGN KEY ("nonMotorClaimId") REFERENCES "NonMotorClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotorClaimDocumentDropboxSync" ADD CONSTRAINT "MotorClaimDocumentDropboxSync_motorClaimDocumentId_fkey" FOREIGN KEY ("motorClaimDocumentId") REFERENCES "MotorClaimDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonMotorClaimDocumentDropboxSync" ADD CONSTRAINT "NonMotorClaimDocumentDropboxSync_nonMotorClaimDocumentId_fkey" FOREIGN KEY ("nonMotorClaimDocumentId") REFERENCES "NonMotorClaimDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
