-- CreateEnum
CREATE TYPE "DropboxNamespaceMode" AS ENUM ('HOME', 'TEAM_FOLDER_NAMESPACE');

-- CreateEnum
CREATE TYPE "DropboxMigrationStatus" AS ENUM ('NOT_STARTED', 'DIAGNOSTIC_COMPLETE', 'WRITE_TEST_REQUIRED', 'WRITE_TEST_PASSED', 'PREVIEW_READY', 'READY_FOR_COPY', 'COPYING', 'COPY_PAUSED', 'COPY_FAILED', 'COPY_COMPLETE', 'VERIFYING', 'VERIFICATION_FAILED', 'VERIFIED', 'READY_TO_ACTIVATE', 'ACTIVATING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DropboxMigrationPreviewResult" AS ENUM ('SAFE_TO_CONTINUE', 'BLOCKED_BY_CONFLICT', 'BLOCKED_BY_PERMISSION', 'BLOCKED_BY_STRUCTURE', 'MANUAL_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "DropboxMigrationObjectKind" AS ENUM ('ROOT', 'CUSTOMER_FOLDER', 'CUSTOMER_STANDARD_SUBFOLDER', 'CUSTOMER_DOCUMENT', 'QUOTATION_BUSINESS_FOLDER', 'QUOTATION_VERSION_FILE', 'POLICY_BUSINESS_FOLDER', 'POLICY_DOCUMENT', 'INVOICE_BUSINESS_FOLDER', 'INVOICE_DOCUMENT', 'MOTOR_CLAIM_BUSINESS_FOLDER', 'MOTOR_CLAIM_DOCUMENT', 'NON_MOTOR_CLAIM_BUSINESS_FOLDER', 'NON_MOTOR_CLAIM_DOCUMENT', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "DropboxMigrationObjectType" AS ENUM ('FILE', 'FOLDER');

-- CreateEnum
CREATE TYPE "DropboxMigrationObjectStatus" AS ENUM ('DISCOVERED', 'PENDING', 'COPYING', 'COPIED', 'VERIFYING', 'VERIFIED', 'SKIPPED_IDENTICAL', 'CONFLICT', 'MISSING_SOURCE', 'FAILED');

-- CreateTable
CREATE TABLE "DropboxNamespaceConfig" (
    "id" TEXT NOT NULL,
    "activeNamespaceMode" "DropboxNamespaceMode" NOT NULL DEFAULT 'HOME',
    "activeRootFolder" TEXT NOT NULL DEFAULT '/Insurance Management System',
    "encryptedDestinationNamespaceId" TEXT,
    "destinationNamespaceDisplayName" TEXT,
    "destinationRootFolder" TEXT NOT NULL DEFAULT '/Insurance Management System',
    "destinationResolvedAt" TIMESTAMP(3),
    "migrationLocked" BOOLEAN NOT NULL DEFAULT false,
    "migrationLockedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropboxNamespaceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DropboxMigrationJob" (
    "id" TEXT NOT NULL,
    "status" "DropboxMigrationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentPhase" TEXT,
    "sourceNamespaceMode" "DropboxNamespaceMode" NOT NULL DEFAULT 'HOME',
    "destinationNamespaceMode" "DropboxNamespaceMode" NOT NULL DEFAULT 'TEAM_FOLDER_NAMESPACE',
    "sourceRootPath" TEXT NOT NULL,
    "destinationRootPath" TEXT NOT NULL,
    "sourceRootFolderId" TEXT,
    "destinationRootFolderId" TEXT,
    "previewResult" "DropboxMigrationPreviewResult",
    "previewSummary" TEXT,
    "previewTotalFolders" INTEGER,
    "previewTotalFiles" INTEGER,
    "previewTotalBytes" BIGINT,
    "previewCustomerFolders" INTEGER,
    "previewCustomerDocuments" INTEGER,
    "previewQuotationFolders" INTEGER,
    "previewQuotationFiles" INTEGER,
    "previewPolicyFolders" INTEGER,
    "previewPolicyFiles" INTEGER,
    "previewInvoiceFolders" INTEGER,
    "previewInvoiceFiles" INTEGER,
    "previewMotorClaimFolders" INTEGER,
    "previewMotorClaimFiles" INTEGER,
    "previewNonMotorClaimFolders" INTEGER,
    "previewNonMotorClaimFiles" INTEGER,
    "previewUnexpectedObjects" INTEGER,
    "previewIdenticalDestinationObjects" INTEGER,
    "previewConflictObjects" INTEGER,
    "previewedAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "safeErrorMessage" TEXT,
    "initiatedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "copiedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropboxMigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DropboxMigrationObjectLedger" (
    "id" TEXT NOT NULL,
    "migrationJobId" TEXT NOT NULL,
    "objectKind" "DropboxMigrationObjectKind" NOT NULL,
    "objectType" "DropboxMigrationObjectType" NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceRevision" TEXT,
    "destinationPath" TEXT NOT NULL,
    "destinationId" TEXT,
    "expectedContentHash" TEXT,
    "expectedFileSize" BIGINT,
    "status" "DropboxMigrationObjectStatus" NOT NULL DEFAULT 'DISCOVERED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "copiedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "safeErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropboxMigrationObjectLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DropboxMigrationJob_status_idx" ON "DropboxMigrationJob"("status");

-- CreateIndex
CREATE INDEX "DropboxMigrationObjectLedger_migrationJobId_status_idx" ON "DropboxMigrationObjectLedger"("migrationJobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DropboxMigrationObjectLedger_migrationJobId_sourcePath_key" ON "DropboxMigrationObjectLedger"("migrationJobId", "sourcePath");

-- AddForeignKey
ALTER TABLE "DropboxMigrationObjectLedger" ADD CONSTRAINT "DropboxMigrationObjectLedger_migrationJobId_fkey" FOREIGN KEY ("migrationJobId") REFERENCES "DropboxMigrationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
